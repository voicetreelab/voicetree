import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { SpanStatusCode, trace, type Span } from '@opentelemetry/api'
import { SessionRegistry } from '../application/session/registry.ts'
import { CONTRACT_VERSION } from './contract.ts'
import { createDaemonApp } from '../routes/daemonApp.ts'
import type { LockHandle } from './lock.ts'
import type { BoundDaemonHttpServer } from './daemonHttpServer.ts'
import type { DaemonWatcherController } from './daemonWatcherLifecycle.ts'
import {
  type DaemonHandle,
  type StartDaemonOptions,
  buildHealthResponse,
  resolveDaemonAppSupportPath,
  resolveDaemonClock,
  resolveDaemonLogger,
} from './daemonTypes.ts'
import { acquireDaemonLock } from './daemonLockLifecycle.ts'
import {
  ensureDaemonFolderVisibility,
  initDaemonGraphModel,
  loadDaemonWritePath,
  resetDaemonGraphState,
} from './daemonGraphLifecycle.ts'
import { startDaemonWatcher } from './daemonWatcherLifecycle.ts'
import { createIdleSessionTimer } from './daemonIdleSessions.ts'
import { bindDaemonHttpServer } from './daemonHttpServer.ts'
import { deleteDaemonPortFile, writeDaemonPortFile } from './daemonPortLifecycle.ts'

const tracer = trace.getTracer('vt-graphd')
const DEFAULT_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000

type OwnedDaemonResources = {
  clearIdleSessionTimer: () => void
  httpServer: BoundDaemonHttpServer | null
  watcher: DaemonWatcherController | null
}

type CleanupOptions = {
  readonly resetGraphState: boolean
  readonly onShutdownComplete?: () => void | Promise<void>
}

async function cleanupOwnedDaemon(
  vault: string,
  lockHandle: LockHandle,
  resources: OwnedDaemonResources,
  options: CleanupOptions,
): Promise<void> {
  try {
    resources.clearIdleSessionTimer()
    await resources.httpServer?.close()
    await resources.watcher?.stop()
  } finally {
    await lockHandle.release()
    await deleteDaemonPortFile(vault)
    if (options.resetGraphState) {
      resetDaemonGraphState()
    }
    await options.onShutdownComplete?.()
  }
}

async function startOwnedDaemon(
  opts: StartDaemonOptions,
  vault: string,
  startSpan: Span,
  lockHandle: LockHandle,
): Promise<DaemonHandle> {
  const clock = resolveDaemonClock(opts)
  const logger = resolveDaemonLogger(opts)
  const resources: OwnedDaemonResources = {
    clearIdleSessionTimer: () => {},
    httpServer: null,
    watcher: null,
  }
  let shuttingDown = false
  let stopped = false

  try {
    resetDaemonGraphState()
    initDaemonGraphModel(resolveDaemonAppSupportPath(opts))
    await loadDaemonWritePath({
      vault,
      createStarterIfEmpty: opts.createStarterIfEmpty,
    })
    ensureDaemonFolderVisibility(vault)

    const startMs = clock()
    const registry = new SessionRegistry()
    resources.watcher = await startDaemonWatcher(vault, logger)
    resources.clearIdleSessionTimer = createIdleSessionTimer(
      registry,
      opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    )

    const app = createDaemonApp({
      registry,
      readHealth: () =>
        buildHealthResponse(CONTRACT_VERSION, vault, startMs, clock(), registry.size()),
      onShutdown: () => {
        if (shuttingDown) {
          return
        }
        shuttingDown = true
        queueMicrotask(() => {
          void cleanupOwnedDaemon(vault, lockHandle, resources, {
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
    await writeDaemonPortFile(vault, resources.httpServer.port)
    startSpan.setAttribute('port', resources.httpServer.port)

    return {
      port: resources.httpServer.port,
      stop: async () => {
        if (stopped) {
          return
        }
        stopped = true
        shuttingDown = true
        await cleanupOwnedDaemon(vault, lockHandle, resources, {
          resetGraphState: true,
        })
      },
    }
  } catch (err) {
    await cleanupOwnedDaemon(vault, lockHandle, resources, {
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
      const vault = resolve(opts.vault)
      startSpan.setAttribute('vault', vault)
      await mkdir(join(vault, '.voicetree'), { recursive: true })

      const lockResult = await acquireDaemonLock(vault, logger)
      if (lockResult.kind === 'already-running') {
        return lockResult.handle
      }

      return await startOwnedDaemon(opts, vault, startSpan, lockResult.lockHandle)
    } catch (err) {
      startSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
      throw err
    } finally {
      startSpan.end()
    }
  })
}
