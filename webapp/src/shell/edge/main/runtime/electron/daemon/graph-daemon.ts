import {
  GraphDbClient,
  spawnVaultlessDaemon,
  type VaultlessDaemonHandle,
} from '@vt/graph-db-client'

import { getAppSupportPath, getMainWindow } from '@/shell/edge/main/runtime/state/app-electron-state'

export type DaemonHandle = VaultlessDaemonHandle & { launched: true }

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

async function spawnDaemonForWebapp(): Promise<DaemonHandle> {
  const handle = await spawnVaultlessDaemon({ appSupportPath: getAppSupportPath() })

  handle.process.on('exit', (code, signal) => {
    if (activeDaemon?.process === handle.process) {
      markDaemonLost(new Error(`vt-graphd exited code=${code ?? 'null'} signal=${signal ?? 'null'}`))
    }
  })

  handle.process.on('error', (error) => {
    if (activeDaemon?.process === handle.process || inflightDaemon !== null) {
      markDaemonLost(error)
    }
  })

  return {
    ...handle,
    launched: true,
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

  const pending = spawnDaemonForWebapp()
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
