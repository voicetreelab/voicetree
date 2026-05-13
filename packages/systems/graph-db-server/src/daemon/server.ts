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
import { getVaultPaths, resolveWritePath, setVaultPath, setWritePath } from '../state/vaultAllowlist.ts'
import { getVaultConfigForDirectory } from '@vt/app-config/vault-config'
import { setGraph } from '../state/graph-store.ts'
import { loadGraphFromDisk } from '../data/graph/loading/loadGraphFromDisk.ts'
import { getDirectoryTree } from '../data/graph/loading/folderScanner.ts'
import { clearWatchFolderState, onReadPathsChanged } from '../state/watch-folder-store.ts'
import { ensureDefaultFolderVisibilityView } from '../data/views/viewsRepository.ts'
import { CONTRACT_VERSION, type HealthResponse } from './contract.ts'
import { createDaemonApp } from '../routes/daemonApp.ts'
import { acquireLock } from './lock.ts'
import { writePortFile, readPortFile, deletePortFile } from './portFile.ts'
import { SessionRegistry } from '../application/session/registry.ts'
import { mountWatcher, type Watcher } from '../data/graph/watching/daemonWatcher.ts'

export type DaemonHandle = {
  port: number
  stop(): Promise<void>
  alreadyRunning?: { pid: number }
}

export type StartDaemonOptions = {
  vault: string
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

const LOOPBACK_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

const tracer = trace.getTracer('vt-graphd')

type DaemonLogger = {
  error(message?: unknown, ...optionalParams: unknown[]): void
  writeStderr(message: string): void
}

function defaultClock(): number {
  return Date.now()
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

function resolveConfiguredWritePath(vault: string, configuredWritePath: string | undefined): string {
  return configuredWritePath
    ? resolveWritePath(vault, configuredWritePath)
    : vault
}

function formatAlreadyRunningMessage(vault: string, pid: number): string {
  return `vt-graphd: already running for ${vault} (pid ${pid})\n`
}

function shouldRejectRemoteAddress(remoteAddress: string | undefined): boolean {
  return !remoteAddress || !LOOPBACK_ADDRS.has(remoteAddress)
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
  const vault = resolve(opts.vault)
  startSpan.setAttribute('vault', vault)
  const dotDir = join(vault, '.voicetree')
  await mkdir(dotDir, { recursive: true })

  // --- acquire lock ---
  const lockSpan = tracer.startSpan('daemon.acquire-lock')
  const lockResult = await acquireLock(vault)
  if ('kind' in lockResult) {
    lockSpan.setAttribute('alreadyRunning', true)
    lockSpan.end()
    startSpan.end()
    const existingPort = (await readPortFile(vault)) ?? 0
    logger.writeStderr(formatAlreadyRunningMessage(vault, lockResult.pid))
    return {
      port: existingPort,
      alreadyRunning: { pid: lockResult.pid },
      stop: async () => {},
    }
  }
  lockSpan.end()

  const lockHandle = lockResult
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
    await lockHandle.release()
    startSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
    startSpan.end()
    throw err
  }

  // --- set write path ---
  const loadWritePathResult = await tracer.startActiveSpan(
    'daemon.set-write-path',
    async (writePathSpan) => {
      try {
        setVaultPath(vault)
        const savedConfig = await getVaultConfigForDirectory(vault)
        const resolvedWritePath = resolveConfiguredWritePath(vault, savedConfig?.writePath)
        const result = await setWritePath(resolvedWritePath, {
          createStarterIfEmpty: opts.createStarterIfEmpty,
        })
        if (!result.success) {
          writePathSpan.setStatus({
            code: SpanStatusCode.ERROR,
            message: result.error ?? `Failed to load vault ${vault}`,
          })
        }
        writePathSpan.setAttribute('writePath', resolvedWritePath)
        return result
      } catch (err) {
        writePathSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
        throw err
      } finally {
        writePathSpan.end()
      }
    },
  )
  if (!loadWritePathResult.success) {
    const msg = loadWritePathResult.error ?? `Failed to load vault ${vault}`
    await lockHandle.release()
    startSpan.setStatus({ code: SpanStatusCode.ERROR, message: msg })
    startSpan.end()
    throw new Error(msg)
  }

  // --- folder visibility db ---
  const fvSpan = tracer.startSpan('daemon.folder-visibility-db')
  try {
    ensureDefaultFolderVisibilityView(vault)
    fvSpan.end()
  } catch (err) {
    fvSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
    fvSpan.end()
    await lockHandle.release()
    startSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
    startSpan.end()
    throw err
  }

  const registry = new SessionRegistry()
  const idleTimeoutMs = opts.idleTimeoutMs ?? 24 * 60 * 60 * 1000

  // --- mount watcher ---
  const watchSpan = tracer.startSpan('daemon.mount-watcher')
  let watcher: Watcher
  try {
    watcher = mountWatcher(await getVaultPaths(), vault)
    try {
      await watcher.ready
    } catch (err) {
      await watcher.unmount().catch(() => {})
      throw err
    }
    watchSpan.end()
  } catch (err) {
    watchSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
    watchSpan.end()
    await lockHandle.release()
    startSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
    startSpan.end()
    throw err
  }
  let watcherStopped = false
  let remountChain: Promise<void> = Promise.resolve()
  let shuttingDown = false

  const queueWatcherRemount = (watchPaths: readonly string[]): void => {
    remountChain = remountChain
      .then(async () => {
        if (watcherStopped) {
          return
        }
        await watcher.unmount()
        if (!watcherStopped) {
          const nextWatcher = mountWatcher(watchPaths, vault)
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

  const unsubscribeReadPaths = onReadPathsChanged((watchPaths) => {
    queueWatcherRemount(watchPaths)
  })

  const stopWatcher = async (): Promise<void> => {
    if (watcherStopped) {
      return
    }
    watcherStopped = true
    unsubscribeReadPaths()
    await remountChain
    await watcher.unmount()
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

  const app = createDaemonApp({
    registry,
    readHealth: () => buildHealthResponse(CONTRACT_VERSION, vault, startMs, clock(), registry.size()),
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
            await lockHandle.release()
            await deletePortFile(vault)
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
    await lockHandle.release()
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
    await lockHandle.release()
    startSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
    startSpan.end()
    throw err
  }
  serveSpan.setAttribute('port', assignedPort)
  serveSpan.end()

  // --- write port file ---
  const portFileSpan = tracer.startSpan('daemon.write-port-file')
  await writePortFile(vault, assignedPort)
  portFileSpan.setAttribute('port', assignedPort)
  portFileSpan.end()

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
      await lockHandle.release()
      await deletePortFile(vault)
      clearWatchFolderState()
      setGraph(createEmptyGraph())
    }
  }

  return { port: assignedPort, stop }
  }) // end startActiveSpan
}
