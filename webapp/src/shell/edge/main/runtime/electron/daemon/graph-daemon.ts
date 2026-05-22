import {
  ensureGraphDaemonForVault,
  GraphDbClient,
  type EnsureGraphDaemonResult,
} from '@vt/graph-db-client'

import { getMainWindow } from '@/shell/edge/main/runtime/state/app-electron-state'
import {
  attemptBoundedRecovery,
  resetRecoveryHistory,
} from './graph-daemon-recovery'
import { unsubscribeFromDaemonSSE } from './daemon-sse-subscription'
import { stopDaemonGraphSync } from './daemon-watch-sync'

export type DaemonHandle = EnsureGraphDaemonResult

async function stopOwnerRecoveryLoops(): Promise<void> {
  unsubscribeFromDaemonSSE()
  await stopDaemonGraphSync()
}

let activeVault: string | null = null
let activeOwner: DaemonHandle | null = null

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
  const previous = activeOwner
  activeOwner = null

  pushToRenderer('vault:lost', {
    error: error instanceof Error ? error.message : String(error),
    pid: previous?.pid ?? null,
    vault: activeVault,
  })
}

/**
 * Resolve the bound `GraphDbClient` for the currently active vault, ensuring
 * the owner via {@link ensureGraphDaemonForVault} when no healthy cached
 * client exists. Throws when no vault has been activated yet — `openVault`
 * must run first.
 *
 * BF-347: when the cached client is lost (connection failure), recovery
 * goes through {@link attemptBoundedRecovery}: SSE + watch-sync loops are
 * stopped BEFORE the ensure call, and the recovery is bounded
 * (3 attempts in any 30s window per vault). The first-time ensure path
 * (no cached client yet) calls `ensureGraphDaemonForVault` directly — it
 * is the user-driven open, not a recovery.
 */
export async function ensureDaemonForActiveVault(): Promise<DaemonHandle> {
  if (activeVault === null) {
    throw new Error('Cannot ensure graph daemon: no vault is currently open')
  }
  if (activeOwner !== null) {
    try {
      await activeOwner.client.health()
      return activeOwner
    } catch (error) {
      if (!isConnectionFailure(error)) throw error
      markDaemonLost(error)
      const recovered = await attemptBoundedRecovery(activeVault, 'electron-main', {
        stopLoops: stopOwnerRecoveryLoops,
      })
      activeOwner = recovered
      return recovered
    }
  }
  const owner = await ensureGraphDaemonForVault(activeVault, 'electron-main')
  activeOwner = owner
  return owner
}

/**
 * Set the active vault and ensure its owner-bound daemon. Called by
 * {@link openVault} before any vault-routed RPC. Switching vaults drops the
 * previous client cache; the underlying vt-graphd process is left untouched
 * (it is a vault-scoped shared resource, not Electron-owned).
 */
export async function setActiveVaultAndEnsureDaemon(vault: string): Promise<DaemonHandle> {
  if (activeVault !== vault) {
    if (activeVault !== null) resetRecoveryHistory(activeVault)
    activeOwner = null
    activeVault = vault
  }
  return await ensureDaemonForActiveVault()
}

export function getDaemonClient(): GraphDbClient {
  if (activeOwner === null) {
    throw new Error('Graph daemon client is not connected. Open a vault first.')
  }
  return activeOwner.client
}

export function getActiveDaemonClient(): GraphDbClient | null {
  return activeOwner?.client ?? null
}

export async function callDaemon<T>(
  fn: (client: GraphDbClient) => Promise<T>,
): Promise<T> {
  const owner = await ensureDaemonForActiveVault()
  try {
    return await fn(owner.client)
  } catch (error) {
    if (isConnectionFailure(error)) {
      markDaemonLost(error)
    }
    throw error
  }
}

/**
 * Drop Electron's cached client/vault state. Electron is not the daemon
 * supervisor (per OpenSpec D7/D8): vt-graphd is a vault-scoped, cross-caller
 * shared resource. Stale daemons are cleaned up by `killOrphanVtGraphdDaemons`
 * at the next launch and by the owner protocol's stale-reclaim path.
 */
export async function shutdownActiveDaemonConnection(): Promise<void> {
  if (activeVault !== null) resetRecoveryHistory(activeVault)
  activeOwner = null
  activeVault = null
}

export function clearDaemonClientCache(): void {
  if (activeVault !== null) resetRecoveryHistory(activeVault)
  activeOwner = null
  activeVault = null
}
