/**
 * Per-project binding to the standalone VTD (vt-daemon) controller.
 *
 * Post-Phase-2 (BF-375): the unified HTTP daemon is no longer in-process.
 * Electron Main is a CLIENT of a per-project VTD child spawned via the
 * `@vt/vt-daemon-client` ensure path. This module owns the small piece
 * of impurity that is "the currently-bound project" — `bindVtDaemonForProject`
 * on project-open, `unbindVtDaemon` on app quit, and the
 * `getDaemonUrl` / `getAuthToken` accessors the renderer reaches via IPC.
 *
 * Invariants (per BF-346 + BF-375):
 *   - One VTD per project per machine; multiple Electron windows / CLI
 *     peers converge on the same child via the ensure path's BF-348
 *     single-flight + cross-process spawn lock.
 *   - Main does NOT own the VTD child's lifetime — `unbindVtDaemon`
 *     clears Main's cached handle but is observably a no-op on the
 *     spawned child. Project-switch leaks a child on purpose; the bounded
 *     cleanup is VTD's `VOICETREE_PARENT_PID` watchdog.
 *   - `getDaemonUrl` / `getAuthToken` re-call `ensureVtDaemonForProject`
 *     on every access so a VTD respawn (crash → new pid → new token)
 *     surfaces fresh credentials, not a stale cached snapshot. The
 *     ensure call is cheap (in-process single-flight) when the cache
 *     is warm.
 *   - `$VOICETREE_DAEMON_URL` is an external-daemon override and bypasses
 *     both the cache and the ensure path entirely — tests and dev
 *     overrides redirect to a daemon spawned out-of-band.
 *
 * Serialisation: `bindVtDaemonForProject` / `unbindVtDaemon` queue through
 * a single promise chain — `openProject` may be invoked in parallel and a
 * rebind must not race a teardown of the prior `active` snapshot.
 */

import {randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {mkdir} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {resolve} from 'node:path'
import {
    bindVtDaemonClient,
    type EnsureVtDaemonResult,
    type VtDaemonClient,
    type VtDaemonClientFacade,
} from '@vt/vt-daemon-client'
import {
    ensureNodeVtDaemonForProject,
    type NodeEnsureVtDaemonRuntime,
} from '@vt/vt-daemon-client/nodeEnsureVtDaemonForProject'

const requireFromHere = createRequire(import.meta.url)

function createNodeEnsureRuntime(): NodeEnsureVtDaemonRuntime {
    return {
        env: {...process.env},
        mkdir,
        newAttemptId: randomUUID,
        now: Date.now,
        readTextFileSync: readFileSync,
        resolveModule: (specifier: string): string => requireFromHere.resolve(specifier),
        resolvePath: resolve,
    }
}

interface ActiveVtDaemon {
    readonly projectPath: string
    readonly url: string
    readonly token: string
    readonly pid: number
    readonly ownerNonce: string
    readonly client: VtDaemonClient
    readonly facade: VtDaemonClientFacade
}

type ActiveEnsureResult = EnsureVtDaemonResult<VtDaemonClient>

let active: ActiveVtDaemon | null = null
let pending: Promise<void> = Promise.resolve()

function chain<T>(work: () => Promise<T>): Promise<T> {
    const next: Promise<T> = pending.then(work, work) as Promise<T>
    pending = next.then((): void => {}, (): void => {})
    return next
}

function snapshotFromEnsure(projectPath: string, result: ActiveEnsureResult): ActiveVtDaemon {
    return {
        projectPath,
        url: result.client.baseUrl,
        token: result.authToken,
        pid: result.pid,
        ownerNonce: result.ownerNonce,
        client: result.client,
        facade: bindVtDaemonClient(result.client),
    }
}

export function bindVtDaemonForProject(projectPath: string): Promise<ActiveVtDaemon> {
    return chain(async (): Promise<ActiveVtDaemon> => {
        if (active?.projectPath === projectPath) {
            // Idempotent rebind. The ensure path's in-process single-flight
            // cache means a fresh `ensureVtDaemonForProject` call here would
            // also return the same handle cheaply, but skipping it
            // preserves observable identity for callers that want to know
            // "did anything change?" without an extra round-trip.
            return active
        }
        // Project-swap: drop the cached handle without killing the prior
        // VTD child. Per BF-346, the VTD is a shared cross-process
        // resource that outlives any single Electron Main; the bounded
        // cleanup is VTD's parent-pid watchdog (BF-369) plus
        // killOrphanVt*Daemons on next startup.
        active = null
        const result: ActiveEnsureResult = await ensureNodeVtDaemonForProject(createNodeEnsureRuntime(), projectPath, 'electron')
        const next: ActiveVtDaemon = snapshotFromEnsure(projectPath, result)
        active = next
        return next
    })
}

export function unbindVtDaemon(): Promise<void> {
    return chain(async (): Promise<void> => {
        // Observably a no-op on the spawned VTD child — Main does not own
        // its lifetime (see header). We only drop the cached handle so
        // subsequent `getDaemonUrl` / `getAuthToken` calls reject with
        // `daemon_unreachable` until the next `bindVtDaemonForProject`.
        active = null
    })
}

export async function getDaemonUrl(): Promise<string> {
    if (process.env.VOICETREE_DAEMON_URL) return process.env.VOICETREE_DAEMON_URL
    const snapshot: ActiveVtDaemon = await refreshActive()
    return snapshot.url
}

export async function getAuthToken(): Promise<string> {
    const snapshot: ActiveVtDaemon = await refreshActive()
    return snapshot.token
}

/**
 * Synchronous read of the currently-bound project path, or `null` if no project
 * is bound yet (or after `unbindVtDaemon`). Used by the agent-events SSE
 * subscriber's project-switch fence — it must be authoritative the instant
 * `bindVtDaemonForProject` resolves, so we expose it as a direct accessor on
 * the cached `active` snapshot rather than re-calling the ensure path.
 *
 * Per main-host-purity §"Project-switch fence drops stale events": this
 * accessor returns the value `bindVtDaemonForProject` last set, before any
 * subsequent project-switch begins. Combined with the `chain<T>` promise
 * serialisation in this file, the SSE subscriber sees a consistent view
 * of "the project Main currently considers active".
 */
export function getActiveProject(): string | null {
    return active?.projectPath ?? null
}

/**
 * Bound RPC facade closed over the active vt-daemon connection. Throws
 * `daemon_unreachable` when no project is bound — callers that fan out the
 * 19 BF-376 RPC routes (mainAPI handlers, polling syncs, lazy-attach IPC)
 * reach this on every invocation, so a respawned VTD surfaces the fresh
 * client without the call site holding a stale reference.
 *
 * Sync accessor (not async). The active snapshot is already on the
 * promise-chained `bindVtDaemonForProject`; the renderer-visible auth-token
 * refresh path (`getAuthToken`) is the only spot that needs the ensure
 * round-trip, and it does so by calling `refreshActive` directly.
 */
export function getVtDaemonFacade(): VtDaemonClientFacade {
    if (!active) throw new Error('daemon_unreachable: no active vt-daemon binding')
    return active.facade
}

/** Raw `VtDaemonClient` for callers that need `.rpc()` / `.health()` directly. */
export function getVtDaemonClient(): VtDaemonClient {
    if (!active) throw new Error('daemon_unreachable: no active vt-daemon binding')
    return active.client
}

/**
 * Test-only: stamp a synthetic active-binding entry without spawning a real
 * VTD child. Lets unit tests exercise consumers of `getActiveProject()` (e.g.
 * the Main-side live-state RPC client) without going through
 * `ensureVtDaemonForProject`. The client/facade fields are left as no-op stubs
 * because tests using this path point `createRpcClientForProject` at a local
 * HTTP listener via the on-disk discovery files (`rpc.port` + `auth-token`)
 * rather than reusing the cached snapshot.
 */
export function __setBoundProjectForTests(projectPath: string | null): void {
    if (projectPath === null) {
        active = null
        return
    }
    active = {
        projectPath,
        url: '',
        token: '',
        pid: 0,
        ownerNonce: '',
        client: {} as VtDaemonClient,
        facade: {} as VtDaemonClientFacade,
    }
}

/**
 * Re-call the ensure path for the currently-bound project so a respawned
 * VTD (crash → new pid → new auth token) surfaces fresh credentials.
 * Cheap when the ensure path's in-process single-flight cache is warm.
 * Throws `daemon_unreachable` when no project has been bound yet (or after
 * `unbindVtDaemon`) so callers don't silently fall through to a stale
 * value.
 */
async function refreshActive(): Promise<ActiveVtDaemon> {
    const current: ActiveVtDaemon | null = active
    if (!current) throw new Error('daemon_unreachable: no active vt-daemon binding')
    const result: ActiveEnsureResult = await ensureNodeVtDaemonForProject(createNodeEnsureRuntime(), current.projectPath, 'electron')
    if (result.pid === current.pid && result.ownerNonce === current.ownerNonce) {
        // Hot-path: same owner. Avoid rebuilding the snapshot.
        return current
    }
    // Respawn detected — replace `active` so a parallel caller sees the
    // refreshed values too.
    const next: ActiveVtDaemon = snapshotFromEnsure(current.projectPath, result)
    active = next
    return next
}
