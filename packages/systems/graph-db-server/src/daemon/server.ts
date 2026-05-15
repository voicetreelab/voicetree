import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AddressInfo, Socket } from 'node:net'
import type { Server } from 'node:http'
import { trace, SpanStatusCode } from '@opentelemetry/api'
import { serve } from '@hono/node-server'
import { initGraphModel } from '@vt/graph-model'
import { configureRootIO } from '@vt/graph-state'
import { createEmptyGraph } from '@vt/graph-model'
import { getVaultPaths } from '../state/vaultAllowlist.ts'
import { setGraph } from '../state/graph-store.ts'
import { loadGraphFromDisk } from '../data/graph/loading/loadGraphFromDisk.ts'
import { getDirectoryTree } from '../data/graph/loading/folderScanner.ts'
import {
  clearWatchFolderState,
  getProjectRootWatchedDirectory,
  onReadPathsChanged,
} from '../state/watch-folder-store.ts'
import { CONTRACT_VERSION, type HealthResponse } from './contract.ts'
import { createDaemonApp } from '../routes/daemonApp.ts'
import { acquireLock } from './lock.ts'
import { writePortFile, readPortFile, deletePortFile } from './portFile.ts'
import { SessionRegistry } from '../application/session/registry.ts'
import { mountWatcher, type Watcher } from '../data/graph/watching/daemonWatcher.ts'
import {
  configureVaultLifecycle,
  openVaultWorkflow,
  registerVaultResource,
  resetVaultLifecycle,
} from '../application/workflows/vaultLifecycle.ts'
import {
  closeFolderVisibilityForVault,
  openFolderVisibilityForVault,
} from '../data/views/folderVisibilityResource.ts'

export type DaemonHandle = {
  port: number
  stop(): Promise<void>
  alreadyRunning?: { pid: number }
}

export type StartDaemonOptions = {
  vault?: string | null
  port?: number
  logLevel?: 'info' | 'debug'
  appSupportPath?: string
  idleTimeoutMs?: number
  clock?: () => number
  logger?: DaemonLogger
  // Called after /shutdown finishes its teardown (server close, lock release,
  // port-file delete). The bin sets this to process.exit(0); tests leave it
  // unset so vitest workers survive.
  onShutdownComplete?: () => void | Promise<void>
  // When the vault is empty, auto-create a starter node so first-run UI users
  // see a non-empty graph. Defaults to true to preserve shell behavior; tests
  // pass false to keep their world pristine.
  createStarterIfEmpty?: boolean
}

const tracer = trace.getTracer('vt-graphd')

type DaemonLogger = {
  error(message?: unknown, ...optionalParams: unknown[]): void
  writeStderr(message: string): void
}

function defaultClock(): number {
  return Date.now()
}

function isLoopbackAddress(address: string): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function defaultDaemonError(message?: unknown, ...optionalParams: unknown[]): void {
  console.error(message, ...optionalParams)
}

function defaultDaemonWriteStderr(message: string): void {
  process.stderr.write(message)
}

const defaultDaemonLogger: DaemonLogger = {
  error: defaultDaemonError,
  writeStderr: defaultDaemonWriteStderr,
}

function defaultAppSupportPath(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Voicetree')
  }
  if (process.platform === 'win32') {
    return join(
      process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
      'Voicetree',
    )
  }
  return join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
    'Voicetree',
  )
}

function resolveDaemonAppSupportPath(opts: StartDaemonOptions): string {
  return (
    opts.appSupportPath ??
    process.env.VOICETREE_APP_SUPPORT ??
    defaultAppSupportPath()
  )
}

function formatAlreadyRunningMessage(vault: string, pid: number): string {
  return `vt-graphd: already running for ${vault} (pid ${pid})\n`
}

function shouldRejectRemoteAddress(remoteAddress: string | undefined): boolean {
  return !remoteAddress || !isLoopbackAddress(remoteAddress)
}

function formatRejectedConnectionMessage(remoteAddress: string | undefined): string {
  return `vt-graphd: rejected non-loopback connection from ${remoteAddress ?? 'unknown'}\n`
}

function buildHealthResponse(
  version: string,
  vault: string,
  startMs: number,
  nowMs: number,
  sessionCount: number,
): HealthResponse {
  return {
    version,
    vault,
    uptimeSeconds: Math.floor((nowMs - startMs) / 1000),
    sessionCount,
  }
}

export async function startDaemon(
  opts: StartDaemonOptions,
): Promise<DaemonHandle> {
  return tracer.startActiveSpan('daemon.start', async (startSpan) => {
  const clock = opts.clock ?? defaultClock
  const logger = opts.logger ?? defaultDaemonLogger
  const startupVault = opts.vault ? resolve(opts.vault) : null
  if (startupVault) {
    startSpan.setAttribute('vault', startupVault)
    const dotDir = join(startupVault, '.voicetree')
    await mkdir(dotDir, { recursive: true })
  }

  // --- acquire lock ---
  const lockSpan = tracer.startSpan('daemon.acquire-lock')
  const lockResult = startupVault ? await acquireLock(startupVault) : null
  if (startupVault && lockResult && 'kind' in lockResult) {
    lockSpan.setAttribute('alreadyRunning', true)
    lockSpan.end()
    startSpan.end()
    const existingPort = (await readPortFile(startupVault)) ?? 0
    logger.writeStderr(formatAlreadyRunningMessage(startupVault, lockResult.pid))
    return {
      port: existingPort,
      alreadyRunning: { pid: lockResult.pid },
      stop: async () => {},
    }
  }
  lockSpan.end()

  const lockHandle = lockResult && 'release' in lockResult ? lockResult : null
  clearWatchFolderState()
  setGraph(createEmptyGraph())
  const startMs = clock()

  // --- init graph model + set write path ---
  const initSpan = tracer.startSpan('daemon.init-graph-model')
  try {
    initGraphModel({
      appSupportPath: resolveDaemonAppSupportPath(opts),
    })
    configureRootIO({
      getDirectoryTree,
      loadGraphFromDisk,
    })
    initSpan.end()
  } catch (err) {
    initSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
    initSpan.end()
    await lockHandle?.release()
    startSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
    startSpan.end()
    throw err
  }

  const registry = new SessionRegistry()
  resetVaultLifecycle()
  const idleTimeoutMs = opts.idleTimeoutMs ?? 24 * 60 * 60 * 1000

  let watcher: Watcher | null = null
  let watcherStopped = true
  let remountChain: Promise<void> = Promise.resolve()
  let unsubscribeReadPaths: (() => void) | null = null
  let shuttingDown = false

  const queueWatcherRemount = (watchPaths: readonly string[], watchedDir: string): void => {
    remountChain = remountChain
      .then(async () => {
        if (watcherStopped || !watcher) {
          return
        }
        await watcher.unmount()
        if (!watcherStopped) {
          const nextWatcher = mountWatcher(watchPaths, watchedDir)
          try {
            await nextWatcher.ready
          } catch (err) {
            await nextWatcher.unmount().catch(() => {})
            throw err
          }
          if (watcherStopped) {
            await nextWatcher.unmount()
            return
          }
          watcher = nextWatcher
        }
      })
      .catch((error: unknown) => {
        logger.error('graphd watcher remount failed:', error)
      })
  }

  const stopWatcher = async (): Promise<void> => {
    if (watcherStopped && !watcher) {
      return
    }
    watcherStopped = true
    unsubscribeReadPaths?.()
    unsubscribeReadPaths = null
    await remountChain
    await watcher?.unmount()
    watcher = null
  }

  const startWatcher = async (watchedDir: string): Promise<void> => {
    await stopWatcher()
    watcherStopped = false
    const nextWatcher = mountWatcher(await getVaultPaths(), watchedDir)
    try {
      await nextWatcher.ready
    } catch (err) {
      await nextWatcher.unmount().catch(() => {})
      watcherStopped = true
      throw err
    }
    watcher = nextWatcher
    unsubscribeReadPaths = onReadPathsChanged((watchPaths) => {
      queueWatcherRemount(watchPaths, watchedDir)
    })
  }

  let idleSessionTimer: ReturnType<typeof setInterval> | null = setInterval(
    () => {
      registry.purgeIdle(idleTimeoutMs)
    },
    60_000,
  )
  idleSessionTimer.unref()

  const clearIdleSessionTimer = () => {
    if (!idleSessionTimer) {
      return
    }
    clearInterval(idleSessionTimer)
    idleSessionTimer = null
  }

  configureVaultLifecycle({ activeVaultPath: null, registry })
  registerVaultResource({
    openForVault: openFolderVisibilityForVault,
    closeForVault: closeFolderVisibilityForVault,
  })
  registerVaultResource({
    async openForVault(vaultPath: string): Promise<void> {
      await startWatcher(vaultPath)
    },
    async closeForVault(): Promise<void> {
      await stopWatcher()
    },
  })
  registerVaultResource({
    async openForVault(): Promise<void> {},
    async closeForVault(): Promise<void> {
      registry.clear()
    },
  })

  const app = createDaemonApp({
    registry,
    readHealth: () => buildHealthResponse(
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
        void (async () => {
          try {
            clearIdleSessionTimer()
            await closeServer()
            await stopWatcher()
          } finally {
            await lockHandle?.release()
            if (startupVault) {
              await deletePortFile(startupVault)
            }
            await opts.onShutdownComplete?.()
          }
        })()
      })
    },
  })

  // --- http serve ---
  const serveSpan = tracer.startSpan('daemon.http-serve')
  let listenResolve: (port: number) => void
  let listenReject: (err: Error) => void
  const listenPromise = new Promise<number>((res, rej) => {
    listenResolve = res
    listenReject = rej
  })

  let server: Server
  let closeServer: () => Promise<void>
  try {
    server = serve(
      {
        fetch: app.fetch,
        hostname: '127.0.0.1',
        port: opts.port ?? 0,
      },
      (info: AddressInfo) => listenResolve(info.port),
    ) as Server
    closeServer = () =>
      new Promise<void>((res, rej) => {
        server.close((err) => (err ? rej(err) : res()))
        // Drop keep-alive idle sockets so close() resolves promptly.
        ;(server as unknown as { closeIdleConnections?: () => void }).closeIdleConnections?.()
      })
  } catch (err) {
    serveSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
    serveSpan.end()
    clearIdleSessionTimer()
    await stopWatcher().catch(() => {})
    await lockHandle?.release()
    startSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
    startSpan.end()
    throw err
  }

  server.on('error', (err) => {
    listenReject(err as Error)
  })

  server.on('connection', (socket: Socket) => {
    const remote = socket.remoteAddress
    if (shouldRejectRemoteAddress(remote)) {
      logger.writeStderr(formatRejectedConnectionMessage(remote))
      socket.destroy()
    }
  })

  let assignedPort: number
  try {
    assignedPort = await listenPromise
  } catch (err) {
    serveSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
    serveSpan.end()
    clearIdleSessionTimer()
    await stopWatcher().catch(() => {})
    await lockHandle?.release()
    startSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
    startSpan.end()
    throw err
  }
  serveSpan.setAttribute('port', assignedPort)
  serveSpan.end()

  if (startupVault) {
    const openVaultSpan = tracer.startSpan('daemon.open-startup-vault')
    try {
      await openVaultWorkflow({
        path: startupVault,
        createStarterIfEmpty: opts.createStarterIfEmpty,
      })
      // Legacy startup opens should bind the vault without pre-creating a renderer session.
      registry.clear()
      openVaultSpan.end()
    } catch (err) {
      openVaultSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
      openVaultSpan.end()
      clearIdleSessionTimer()
      await closeServer().catch(() => {})
      await stopWatcher().catch(() => {})
      await lockHandle?.release()
      startSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
      startSpan.end()
      throw err
    }

    // --- write port file ---
    const portFileSpan = tracer.startSpan('daemon.write-port-file')
    await writePortFile(startupVault, assignedPort)
    portFileSpan.setAttribute('port', assignedPort)
    portFileSpan.end()
  }

  startSpan.setAttribute('port', assignedPort)
  startSpan.end()

  let stopped = false
  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    shuttingDown = true
    try {
      clearIdleSessionTimer()
      await closeServer()
      await stopWatcher()
    } finally {
      await lockHandle?.release()
      if (startupVault) {
        await deletePortFile(startupVault)
      }
      clearWatchFolderState()
      setGraph(createEmptyGraph())
    }
  }

  return { port: assignedPort, stop }
  }) // end startActiveSpan
}
