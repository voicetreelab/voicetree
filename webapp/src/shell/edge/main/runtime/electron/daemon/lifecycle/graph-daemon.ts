import { SpanStatusCode } from '@opentelemetry/api'

import {
  ensureGraphDaemonForVault,
  GraphDbClient,
  type EnsureGraphDaemonResult,
} from '@vt/graph-db-client'

import { getMainWindow } from '@/shell/edge/main/runtime/state/app-electron-state'
import { attemptOwnerMediatedRecovery } from './graph-daemon-recovery'
import { unsubscribeFromDaemonSSE } from '@/shell/edge/main/runtime/electron/daemon/sync/daemon-sse-subscription'
import { stopDaemonGraphSync } from '@/shell/edge/main/runtime/electron/daemon/sync/daemon-watch-sync'
import { daemonTracer } from '@/shell/edge/main/observability/tracing/daemon-tracing'

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
 * goes through {@link attemptOwnerMediatedRecovery}: SSE + watch-sync loops
 * are stopped BEFORE the ensure call, and fork-storm protection remains in
 * the shared owner ensure path. The first-time ensure path (no cached client
 * yet) calls `ensureGraphDaemonForVault` directly — it is the user-driven
 * open, not a recovery.
 */
export async function ensureDaemonForActiveVault(): Promise<DaemonHandle> {
  return await daemonTracer().startActiveSpan('daemon.ensure-for-active-vault', async (span) => {
    try {
      if (activeVault === null) {
        span.setAttribute('outcome', 'no-active-vault')
        throw new Error('Cannot ensure graph daemon: no vault is currently open')
      }
      span.setAttribute('vault', activeVault)
      if (activeOwner !== null) {
        // Capture locally: the module-scope `activeOwner` can be cleared during
        // a concurrent `shutdownActiveDaemonConnection()`. Without the capture,
        // `return activeOwner` could resolve to `null` and callers would
        // dereference `null.client`.
        const current: DaemonHandle = activeOwner
        span.setAttribute('cachedOwnerPid', current.pid)
        span.setAttribute('outcome', 'cached-owner')
        return current
      }
      span.setAttribute('outcome', 'first-time-ensure')
      const owner = await ensureGraphDaemonForVault(activeVault, 'electron-main')
      activeOwner = owner
      span.setAttribute('ownerPid', owner.pid)
      span.setAttribute('launched', owner.launched)
      return owner
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
      throw error
    } finally {
      span.end()
    }
  })
}

/**
 * Set the active vault and ensure its owner-bound daemon. Called by
 * {@link openVault} before any vault-routed RPC. Switching vaults drops the
 * previous client cache; the underlying vt-graphd process is left untouched
 * (it is a vault-scoped shared resource, not Electron-owned).
 */
export async function setActiveVaultAndEnsureDaemon(vault: string): Promise<DaemonHandle> {
  if (activeVault !== vault) {
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

async function recoverActiveDaemonAfterConnectionFailure(error: unknown): Promise<DaemonHandle> {
  if (activeVault === null) {
    throw error
  }

  markDaemonLost(error)
  const recovered = await attemptOwnerMediatedRecovery(
    activeVault,
    'electron-main',
    { stopLoops: stopOwnerRecoveryLoops },
  )
  activeOwner = recovered
  return recovered
}

export async function callDaemon<T>(
  fn: (client: GraphDbClient) => Promise<T>,
): Promise<T> {
  return await daemonTracer().startActiveSpan('daemon.call', async (span) => {
    try {
      const owner = await ensureDaemonForActiveVault()
      try {
        return await fn(owner.client)
      } catch (error) {
        if (!isConnectionFailure(error)) {
          throw error
        }
        span.setAttribute('connectionFailure', true)
        span.addEvent('daemon.call.recover-retry.start')
        const recovered = await recoverActiveDaemonAfterConnectionFailure(error)
        span.setAttribute('recoveredOwnerPid', recovered.pid)
        const result = await fn(recovered.client)
        span.addEvent('daemon.call.recover-retry.complete')
        return result
      }
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
      throw error
    } finally {
      span.end()
    }
  })
}

/**
 * Drop Electron's cached client/vault state. Electron is not the daemon
 * supervisor (per OpenSpec D7/D8): vt-graphd is a vault-scoped, cross-caller
 * shared resource. Stale daemons are cleaned up by `killOrphanVtGraphdDaemons`
 * at the next launch and by the owner protocol's stale-reclaim path.
 */
export async function shutdownActiveDaemonConnection(): Promise<void> {
  activeOwner = null
  activeVault = null
}

export function clearDaemonClientCache(): void {
  activeOwner = null
  activeVault = null
}
