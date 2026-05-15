import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createRequire } from 'node:module'
import { GraphDbClient, resolveDaemonRuntimeCommand } from '@vt/graph-db-client'

import { getAppSupportPath, getMainWindow } from '@/shell/edge/main/runtime/state/app-electron-state'

export interface DaemonHandle {
  client: GraphDbClient
  launched: boolean
  pid: number | null
  port: number
  process: ChildProcessWithoutNullStreams | null
}

const requireFromHere = createRequire(import.meta.url)

const DAEMON_READY_TIMEOUT_MS = 15_000
const DAEMON_EXIT_GRACE_MS = 1000
const DAEMON_SIGTERM_GRACE_MS = 500

let activeDaemon: DaemonHandle | null = null
let inflightDaemon: Promise<DaemonHandle> | null = null
let shuttingDown = false

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

async function terminateDaemonPidIfAlive(pid: number | null): Promise<void> {
  if (pid === null) return

  await sleep(DAEMON_EXIT_GRACE_MS)
  if (!isProcessAlive(pid)) return

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }

  await sleep(DAEMON_SIGTERM_GRACE_MS)
  if (!isProcessAlive(pid)) return

  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // Process already exited or cannot be signalled.
  }
}

function pushToRenderer(channel: 'vault:lost', payload: unknown): void {
  const mainWindow: Electron.BrowserWindow | null = getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(channel, payload)
}

function isConnectionFailure(error: unknown): boolean {
  const err = error as { cause?: unknown; code?: string; message?: string }
  const cause = err.cause as { code?: string; message?: string } | undefined
  const message = err.message ?? cause?.message ?? String(error)
  return (
    err.code === 'ECONNREFUSED'
    || cause?.code === 'ECONNREFUSED'
    || message.includes('ECONNREFUSED')
    || message.includes('fetch failed')
  )
}

function markDaemonLost(error: unknown): void {
  const previous = activeDaemon
  activeDaemon = null
  inflightDaemon = null

  if (shuttingDown) return
  pushToRenderer('vault:lost', {
    error: error instanceof Error ? error.message : String(error),
    pid: previous?.pid ?? null,
  })
}

const VAULTLESS_DAEMON_SCRIPT = `
import { startDaemon } from '@vt/graph-db-server/server'

const swallowEpipe = (stream) => {
  stream.on('error', (err) => {
    if (err.code !== 'EPIPE') throw err
  })
}
swallowEpipe(process.stdout)
swallowEpipe(process.stderr)

let handle
try {
  handle = await startDaemon({
    appSupportPath: process.env.VOICETREE_APP_SUPPORT,
    onShutdownComplete: () => process.exit(0),
  })
} catch (err) {
  process.stderr.write('vt-graphd: fatal: ' + (err instanceof Error ? err.message : String(err)) + '\\n')
  process.exit(1)
}

process.stdout.write(JSON.stringify({ type: 'ready', port: handle.port }) + '\\n')

let shuttingDown = false
const shutdown = async (signal) => {
  if (shuttingDown) return
  shuttingDown = true
  process.stderr.write('vt-graphd: ' + signal + ' received, shutting down\\n')
  try {
    await handle.stop()
    process.exit(0)
  } catch (err) {
    process.stderr.write('vt-graphd: shutdown error: ' + (err instanceof Error ? err.message : String(err)) + '\\n')
    process.exit(1)
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
`

function parseReadyLine(line: string): { port: number } | null {
  try {
    const parsed = JSON.parse(line) as { type?: unknown; port?: unknown }
    return parsed.type === 'ready' && typeof parsed.port === 'number'
      ? { port: parsed.port }
      : null
  } catch {
    return null
  }
}

async function spawnVaultlessDaemon(): Promise<DaemonHandle> {
  const runtimeCommand = resolveDaemonRuntimeCommand()
  const tsxLoader = requireFromHere.resolve('tsx')
  const child = spawn(runtimeCommand, ['--import', tsxLoader, '--eval', VAULTLESS_DAEMON_SCRIPT], {
    env: {
      ...process.env,
      VOICETREE_APP_SUPPORT: getAppSupportPath(),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const stderrChunks: string[] = []
  child.stderr.on('data', (chunk: Buffer | string) => {
    const text = String(chunk)
    stderrChunks.push(text)
    process.stderr.write(text)
  })

  child.on('exit', (code, signal) => {
    if (activeDaemon?.process === child) {
      markDaemonLost(new Error(`vt-graphd exited code=${code ?? 'null'} signal=${signal ?? 'null'}`))
    }
  })

  child.on('error', (error) => {
    if (activeDaemon?.process === child || inflightDaemon !== null) {
      markDaemonLost(error)
    }
  })

  const port = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for vt-graphd readiness. ${stderrChunks.join('').trim()}`))
    }, DAEMON_READY_TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer | string) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (!line.trim()) continue
        const ready = parseReadyLine(line)
        if (!ready) {
          process.stdout.write(`${line}\n`)
          continue
        }
        clearTimeout(timeout)
        resolve(ready.port)
      }
    })

    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      reject(new Error(`vt-graphd exited before readiness code=${code ?? 'null'} signal=${signal ?? 'null'}. ${stderrChunks.join('').trim()}`))
    })
  })

  const client = new GraphDbClient({ baseUrl: `http://127.0.0.1:${port}` })
  await client.health()
  return {
    client,
    launched: true,
    pid: child.pid ?? null,
    port,
    process: child,
  }
}

export async function ensureDaemonProcess(): Promise<DaemonHandle> {
  if (activeDaemon) {
    try {
      await activeDaemon.client.health()
      return activeDaemon
    } catch (error) {
      if (isConnectionFailure(error)) {
        markDaemonLost(error)
      } else {
        throw error
      }
    }
  }

  if (inflightDaemon) {
    return await inflightDaemon
  }

  const pending = spawnVaultlessDaemon()
  inflightDaemon = pending
  try {
    const handle = await pending
    activeDaemon = handle
    return handle
  } finally {
    if (inflightDaemon === pending) {
      inflightDaemon = null
    }
  }
}

export function getDaemonClient(): GraphDbClient {
  if (!activeDaemon) {
    throw new Error('Graph daemon process is not running')
  }
  return activeDaemon.client
}

export function getActiveDaemonClient(): GraphDbClient | null {
  return activeDaemon?.client ?? null
}

export async function callDaemon<T>(
  fn: (client: GraphDbClient) => Promise<T>,
): Promise<T> {
  await ensureDaemonProcess()
  try {
    return await fn(getDaemonClient())
  } catch (error) {
    if (isConnectionFailure(error)) {
      markDaemonLost(error)
    }
    throw error
  }
}

export async function shutdownActiveDaemonConnection(): Promise<void> {
  shuttingDown = true
  const daemon = activeDaemon ?? (inflightDaemon ? await inflightDaemon.catch(() => null) : null)
  clearDaemonClientCache()

  if (!daemon) {
    shuttingDown = false
    return
  }

  await daemon.client.shutdown().catch(() => undefined)
  await terminateDaemonPidIfAlive(daemon.pid)
  shuttingDown = false
}

export function clearDaemonClientCache(): void {
  activeDaemon = null
  inflightDaemon = null
}
