import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { SpanStatusCode, trace, type Span } from '@opentelemetry/api'
import { SessionRegistry } from '../application/session/registry.ts'
import { CONTRACT_VERSION } from './contract.ts'
import { createDaemonApp } from '../routes/daemonApp.ts'
import type { LockHandle } from './lock.ts'
import type { BoundDaemonHttpServer } from './daemonHttpServer.ts'
import type { DaemonWatcherController } from './lifecycle/daemonWatcherLifecycle.ts'
import {
  type DaemonHandle,
  type StartDaemonOptions,
  buildHealthResponse,
  resolveDaemonAppSupportPath,
  resolveDaemonClock,
  resolveDaemonLogger,
} from './daemonTypes.ts'
import { acquireDaemonLock } from './lifecycle/daemonLockLifecycle.ts'
import {
  initDaemonGraphModel,
  resetDaemonGraphState,
} from './lifecycle/daemonGraphLifecycle.ts'
import { startParentWatch, type ParentWatchHandle } from './lifecycle/daemonParentWatch.ts'
import { startDaemonWatcher } from './lifecycle/daemonWatcherLifecycle.ts'
import { createIdleSessionTimer } from './daemonIdleSessions.ts'
import { bindDaemonHttpServer } from './daemonHttpServer.ts'
import { deleteDaemonPortFile, writeDaemonPortFile } from './lifecycle/daemonPortLifecycle.ts'
import {
  closeVaultWorkflow,
  configureVaultLifecycle,
  openVaultWorkflow,
  registerVaultResource,
  resetVaultLifecycle,
} from '../application/workflows/vaultLifecycle.ts'
import {
  closeFolderVisibilityForVault,
  openFolderVisibilityForVault,
} from '../data/views/folderVisibilityResource.ts'
import { getProjectRootWatchedDirectory } from '../state/watch-folder-store.ts'

const tracer = trace.getTracer('vt-graphd')
const DEFAULT_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000

type OwnedDaemonResources = {
  clearIdleSessionTimer: () => void
  httpServer: BoundDaemonHttpServer | null
  parentWatch: ParentWatchHandle | null
}

type CleanupOptions = {
  readonly resetGraphState: boolean
  readonly onShutdownComplete?: () => void | Promise<void>
}

async function cleanupOwnedDaemon(
  lockHandle: LockHandle | null,
  resources: OwnedDaemonResources,
  options: CleanupOptions,
): Promise<void> {
  try {
    resources.parentWatch?.stop()
    resources.clearIdleSessionTimer()
    await resources.httpServer?.close()
    await closeVaultWorkflow()
  } finally {
    await lockHandle?.release()
    if (options.resetGraphState) {
      resetDaemonGraphState()
    }
    resetVaultLifecycle()
    await options.onShutdownComplete?.()
  }
}

async function startOwnedDaemon(
  opts: StartDaemonOptions,
  startupVault: string | null,
  startSpan: Span,
  lockHandle: LockHandle | null,
): Promise<DaemonHandle> {
  const clock = resolveDaemonClock(opts)
  const logger = resolveDaemonLogger(opts)
  const resources: OwnedDaemonResources = {
    clearIdleSessionTimer: () => {},
    httpServer: null,
    parentWatch: null,
  }
  let watcher: DaemonWatcherController | null = null
  let portFileVault: string | null = null
  let assignedPort = 0
  let shuttingDown = false
  let stopped = false

  try {
    resetDaemonGraphState()
    resetVaultLifecycle()
    initDaemonGraphModel(resolveDaemonAppSupportPath(opts))

    const startMs = clock()
    const registry = new SessionRegistry()
    resources.clearIdleSessionTimer = createIdleSessionTimer(
      registry,
      opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    )
    configureVaultLifecycle({ activeVaultPath: null, registry })
    registerVaultResource({
      openForVault: openFolderVisibilityForVault,
      closeForVault: closeFolderVisibilityForVault,
    })
    registerVaultResource({
      async openForVault(vaultPath: string): Promise<void> {
        await watcher?.stop()
        watcher = await startDaemonWatcher(vaultPath, logger)
      },
      async closeForVault(): Promise<void> {
        await watcher?.stop()
        watcher = null
      },
    })
    registerVaultResource({
      async openForVault(): Promise<void> {},
      async closeForVault(): Promise<void> {
        registry.clear()
      },
    })
    registerVaultResource({
      async openForVault(vaultPath: string): Promise<void> {
        if (portFileVault && portFileVault !== vaultPath) {
          await deleteDaemonPortFile(portFileVault).catch(() => {})
        }
        await writeDaemonPortFile(vaultPath, assignedPort)
        portFileVault = vaultPath
      },
      async closeForVault(): Promise<void> {
        if (!portFileVault) {
          return
        }
        await deleteDaemonPortFile(portFileVault).catch(() => {})
        portFileVault = null
      },
    })

    const app = createDaemonApp({
      registry,
      readHealth: () =>
        buildHealthResponse(
          CONTRACT_VERSION,
          getProjectRootWatchedDirectory() ?? startupVault ?? '',
          startMs,
          clock(),
          registry.size(),
        ),
      onShutdown: () => {
        if (shuttingDown) {
          return
        }
        shuttingDown = true
        queueMicrotask(() => {
          void cleanupOwnedDaemon(lockHandle, resources, {
            resetGraphState: false,
            onShutdownComplete: opts.onShutdownComplete,
          })
        })
      },
    })

    resources.httpServer = await bindDaemonHttpServer({
      app,
      port: opts.port ?? 0,
      logger,
    })
    assignedPort = resources.httpServer.port
    startSpan.setAttribute('port', assignedPort)

    if (startupVault) {
      await openVaultWorkflow({
        path: startupVault,
        createStarterIfEmpty: opts.createStarterIfEmpty,
      })
      registry.clear()
    }

    if (opts.exitOnParentDeath) {
      resources.parentWatch = startParentWatch({
        onOrphaned: () => {
          logger.writeStderr('vt-graphd: parent process exited, shutting down\n')
          queueMicrotask(() => {
            void (async () => {
              try {
                await cleanupOwnedDaemon(lockHandle, resources, {
                  resetGraphState: true,
                })
              } finally {
                process.exit(0)
              }
            })()
          })
        },
      })
    }

    return {
      port: assignedPort,
      stop: async () => {
        if (stopped) {
          return
        }
        stopped = true
        shuttingDown = true
        await cleanupOwnedDaemon(lockHandle, resources, {
          resetGraphState: true,
        })
      },
    }
  } catch (err) {
    await cleanupOwnedDaemon(lockHandle, resources, {
      resetGraphState: false,
    }).catch(() => {})
    throw err
  }
}

export async function startDaemon(
  opts: StartDaemonOptions,
): Promise<DaemonHandle> {
  return tracer.startActiveSpan('daemon.start', async (startSpan) => {
    try {
      const logger = resolveDaemonLogger(opts)
      const startupVault = opts.vault ? resolve(opts.vault) : null
      if (startupVault) {
        startSpan.setAttribute('vault', startupVault)
        await mkdir(join(startupVault, '.voicetree'), { recursive: true })
      }

      const lockResult = startupVault ? await acquireDaemonLock(startupVault, logger) : null
      if (lockResult?.kind === 'already-running') {
        return lockResult.handle
      }

      return await startOwnedDaemon(
        opts,
        startupVault,
        startSpan,
        lockResult?.lockHandle ?? null,
      )
    } catch (err) {
      startSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
      throw err
    } finally {
      startSpan.end()
    }
  })
}
