import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {getProjectDotVoicetreePath} from '@vt/paths'
import { SpanStatusCode, trace, type Span } from '@opentelemetry/api'
import { SessionRegistry } from '../application/session/registry.ts'
import { CONTRACT_VERSION } from '../contract.ts'
import { createDaemonApp } from '../routes/daemonApp.ts'
import type { BoundDaemonHttpServer } from './daemonHttpServer.ts'
import type { DaemonWatcherController } from './lifecycle/daemonWatcherLifecycle.ts'
import {
  type DaemonHandle,
  type StartDaemonOptions,
  buildHealthResponse,
  resolveDaemonVoicetreeHomePath,
  resolveDaemonClock,
  resolveDaemonLogger,
} from './daemonTypes.ts'
import {
  claimDaemonOwner,
  type DaemonOwnerHandle,
} from './lifecycle/daemonOwnerLifecycle.ts'
import {
  initDaemonGraphModel,
  resetDaemonGraphState,
} from './lifecycle/daemonGraphLifecycle.ts'
import { startParentWatch, type ParentWatchHandle } from '@vt/daemon-lifecycle'
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
import { getProjectRoot } from '../state/watch-folder-store.ts'
import {
  installFolderTreeReadModel,
  getFolderTreeReadModel,
  resetFolderTreeReadModel,
} from '../state/folder-tree-read-model-store.ts'

const tracer = trace.getTracer('vt-graphd')
const DEFAULT_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000

type OwnedDaemonResources = {
  clearIdleSessionTimer: () => void
  httpServer: BoundDaemonHttpServer | null
  parentWatch: ParentWatchHandle | null
  stopHeartbeat: () => void
}

type CleanupOptions = {
  readonly resetGraphState: boolean
  readonly onShutdownComplete?: () => void | Promise<void>
}

async function cleanupOwnedDaemon(
  ownerHandle: DaemonOwnerHandle | null,
  resources: OwnedDaemonResources,
  options: CleanupOptions,
): Promise<void> {
  try {
    resources.stopHeartbeat()
    resources.parentWatch?.stop()
    resources.clearIdleSessionTimer()
    // Drop the owner record + legacy lock sidecar BEFORE tearing down HTTP
    // so a client that observes /health failing immediately afterwards no
    // longer sees the discovery artifacts that say "wait for the port".
    // Without this ordering, graph-db-client's portDiscovery would block
    // for its full timeout on stale `graphd.lock` between HTTP close and
    // release. The brief in-window where HTTP is up but owner is gone is
    // harmless for graceful shutdown — no client should be issuing fresh
    // RPCs in that window.
    await ownerHandle?.release()
    await resources.httpServer?.close()
    await closeVaultWorkflow()
  } finally {
    if (options.resetGraphState) {
      resetDaemonGraphState()
    }
    resetVaultLifecycle()
    resetFolderTreeReadModel()
    await options.onShutdownComplete?.()
  }
}

async function startOwnedDaemon(
  opts: StartDaemonOptions,
  startupVault: string | null,
  startSpan: Span,
  ownerHandle: DaemonOwnerHandle | null,
): Promise<DaemonHandle> {
  const clock = resolveDaemonClock(opts)
  const logger = resolveDaemonLogger(opts)
  const resources: OwnedDaemonResources = {
    clearIdleSessionTimer: () => {},
    httpServer: null,
    parentWatch: null,
    stopHeartbeat: () => {},
  }
  let watcher: DaemonWatcherController | null = null
  let portFileVault: string | null = null
  let assignedPort = 0
  let shuttingDown = false
  let stopped = false

  try {
    resetDaemonGraphState()
    resetVaultLifecycle()
    resetFolderTreeReadModel()
    installFolderTreeReadModel(opts.folderTreeScanner)
    // Normalize VOICETREE_HOME_PATH so every leaf in this process reads
    // the same resolved path via resolveVoicetreeHomePath(). Tests pass an
    // explicit opts.voicetreeHomePath; production reads from the env var that
    // the launching CLI/Electron set.
    process.env.VOICETREE_HOME_PATH = resolveDaemonVoicetreeHomePath(opts)
    initDaemonGraphModel()

    const startMs = clock()
    const registry = new SessionRegistry()
    resources.clearIdleSessionTimer = createIdleSessionTimer(
      registry,
      opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    )
    configureVaultLifecycle({ registry })
    registerVaultResource({
      openForVault: openFolderVisibilityForVault,
      closeForVault: closeFolderVisibilityForVault,
    })
    registerVaultResource({
      async openForVault(): Promise<void> {
        // A fresh vault means previously cached roots are now irrelevant; clear
        // everything rather than try to scope by old vs new root.
        getFolderTreeReadModel().invalidate({ kind: 'all' })
      },
      async closeForVault(): Promise<void> {
        getFolderTreeReadModel().invalidate({ kind: 'all' })
      },
    })
    registerVaultResource({
      async openForVault(projectRoot: string): Promise<void> {
        await watcher?.stop()
        watcher = await startDaemonWatcher(projectRoot, logger)
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
      async openForVault(projectRoot: string): Promise<void> {
        if (portFileVault && portFileVault !== projectRoot) {
          await deleteDaemonPortFile(portFileVault).catch(() => {})
        }
        await writeDaemonPortFile(projectRoot, assignedPort)
        portFileVault = projectRoot
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
          getProjectRoot(),
          startMs,
          clock(),
          registry.size(),
          ownerHandle?.health() ?? null,
        ),
      onShutdown: () => {
        if (shuttingDown) {
          return
        }
        shuttingDown = true
        queueMicrotask(() => {
          void cleanupOwnedDaemon(ownerHandle, resources, {
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
    if (ownerHandle) {
      await ownerHandle.bindPort(assignedPort)
      resources.stopHeartbeat = ownerHandle.startHeartbeat()
    }

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
                await cleanupOwnedDaemon(ownerHandle, resources, {
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
        await cleanupOwnedDaemon(ownerHandle, resources, {
          resetGraphState: true,
        })
      },
    }
  } catch (err) {
    await cleanupOwnedDaemon(ownerHandle, resources, {
      resetGraphState: false,
    }).catch(() => {})
    throw err
  }
}

function commandFingerprintForProcess() {
  return {
    executable: process.execPath,
    args: process.argv.slice(1),
  }
}

export async function startDaemon(
  opts: StartDaemonOptions,
): Promise<DaemonHandle> {
  return tracer.startActiveSpan('daemon.start', async (startSpan) => {
    try {
      const logger = resolveDaemonLogger(opts)
      const clock = resolveDaemonClock(opts)
      const startupVault = opts.vault ? resolve(opts.vault) : null
      if (startupVault) {
        startSpan.setAttribute('vault', startupVault)
        await mkdir(getProjectDotVoicetreePath(startupVault), { recursive: true })
      }

      const ownerHandle = startupVault
        ? await claimDaemonOwner({
            canonicalVault: startupVault,
            callerKind: 'cli',
            contractVersion: CONTRACT_VERSION,
            commandFingerprint: commandFingerprintForProcess(),
            clock,
          })
        : null

      try {
        return await startOwnedDaemon(opts, startupVault, startSpan, ownerHandle)
      } catch (err) {
        await ownerHandle?.release().catch(() => {})
        // Surface conflict errors so the bin / orchestrator can fail loudly
        // without silently overwriting a live owner; `logger` is used so the
        // CLI also has a human-readable line.
        logger.writeStderr(
          `vt-graphd: startup failed for ${startupVault ?? '(vaultless)'}: ${(err as Error).message}\n`,
        )
        throw err
      }
    } catch (err) {
      startSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
      throw err
    } finally {
      startSpan.end()
    }
  })
}
