import { SpanStatusCode } from '@opentelemetry/api'

import {
  ensureGraphDaemonForProject,
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

let activeProject: string | null = null
let activeOwner: DaemonHandle | null = null

function pushToRenderer(channel: 'project:lost', payload: unknown): void {
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

  pushToRenderer('project:lost', {
    error: error instanceof Error ? error.message : String(error),
    pid: previous?.pid ?? null,
    project: activeProject,
  })
}

/**
 * Resolve the bound `GraphDbClient` for the currently active project, ensuring
 * the owner via {@link ensureGraphDaemonForProject} when no healthy cached
 * client exists. Throws when no project has been activated yet — `openProject`
 * must run first.
 *
 * BF-347: when the cached client is lost (connection failure), recovery
 * goes through {@link attemptOwnerMediatedRecovery}: SSE + watch-sync loops
 * are stopped BEFORE the ensure call, and fork-storm protection remains in
 * the shared owner ensure path. The first-time ensure path (no cached client
 * yet) calls `ensureGraphDaemonForProject` directly — it is the user-driven
 * open, not a recovery.
 */
export async function ensureDaemonForActiveProject(): Promise<DaemonHandle> {
  return await daemonTracer().startActiveSpan('daemon.ensure-for-active-project', async (span) => {
    try {
      if (activeProject === null) {
        span.setAttribute('outcome', 'no-active-project')
        throw new Error('Cannot ensure graph daemon: no project is currently open')
      }
      span.setAttribute('project', activeProject)
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
      const owner = await ensureGraphDaemonForProject(activeProject, 'electron-main')
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
 * Set the active project and ensure its owner-bound daemon. Called by
 * {@link openProject} before any project-routed RPC. Switching projects drops the
 * previous client cache; the underlying vt-graphd process is left untouched
 * (it is a project-scoped shared resource, not Electron-owned).
 */
export async function setActiveProjectAndEnsureDaemon(project: string): Promise<DaemonHandle> {
  if (activeProject !== project) {
    activeOwner = null
    activeProject = project
  }
  return await ensureDaemonForActiveProject()
}

export function getActiveDaemonClient(): GraphDbClient | null {
  return activeOwner?.client ?? null
}

async function recoverActiveDaemonAfterConnectionFailure(error: unknown): Promise<DaemonHandle> {
  if (activeProject === null) {
    throw error
  }

  markDaemonLost(error)
  const recovered = await attemptOwnerMediatedRecovery(
    activeProject,
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
      const owner = await ensureDaemonForActiveProject()
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
 * Drop Electron's cached client/project state. Electron is not the daemon
 * supervisor (per OpenSpec D7/D8): vt-graphd is a project-scoped, cross-caller
 * shared resource. Stale daemons are cleaned up by `killOrphanVtGraphdDaemons`
 * at the next launch and by the owner protocol's stale-reclaim path.
 */
export async function shutdownActiveDaemonConnection(): Promise<void> {
  activeOwner = null
  activeProject = null
}

export function clearDaemonClientCache(): void {
  activeOwner = null
  activeProject = null
}
