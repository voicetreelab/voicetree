/**
 * The bound RPC facade webapp callers reach after Stage 3 cuts over.
 *
 * `bindVtDaemonClient(client)` returns the four per-domain facades — one
 * per design.md §1 grouping — each method closed over the supplied
 * `VtDaemonClient`. Call sites use the dotted form (`vtdClient.terminals.spawnPlainTerminal(...)`)
 * exactly as the design lock anticipates; the client variable is the
 * webapp-side handle to the active vt-daemon connection.
 *
 * The free wrapper functions (`spawnPlainTerminal(client, request)` etc.)
 * are also exported per-domain for tests and any caller that holds a
 * `VtDaemonClient` directly without going through the facade.
 */

import type {VtDaemonClient} from '../VtDaemonClient.ts'

import {bindHooksFacade, type HooksFacade} from './hooks.ts'
import {bindRecoveryFacade, type RecoveryFacade} from './recovery.ts'
import {bindTerminalsFacade, type TerminalsFacade} from './terminals.ts'
import {bindTmuxUnclaimedFacade, type TmuxUnclaimedFacade} from './tmuxUnclaimed.ts'

export type {HooksFacade, RecoveryFacade, TerminalsFacade, TmuxUnclaimedFacade}

/**
 * Aggregate facade. The four sub-objects mirror design.md §1's domain
 * grouping; each method is `(request) => Promise<response>` with the
 * client closed over.
 */
export interface VtDaemonClientFacade {
    readonly terminals: TerminalsFacade
    readonly recovery: RecoveryFacade
    readonly tmuxUnclaimed: TmuxUnclaimedFacade
    readonly hooks: HooksFacade
}

export function bindVtDaemonClient(client: VtDaemonClient): VtDaemonClientFacade {
    return {
        terminals: bindTerminalsFacade(client),
        recovery: bindRecoveryFacade(client),
        tmuxUnclaimed: bindTmuxUnclaimedFacade(client),
        hooks: bindHooksFacade(client),
    }
}

// Free per-route wrappers — re-export so tests / direct callers can skip
// the facade.
export {
    closeHeadlessAgent,
    getExistingAgentNames,
    getHeadlessAgentOutput,
    getTerminalRecords,
    getUnseenNodesForTerminal,
    injectNodesIntoTerminal,
    patchTerminalRecord,
    removeTerminalFromRegistry,
    sendTextToTerminal,
    spawnPlainTerminal,
    spawnPlainTerminalWithNode,
    spawnTerminalWithContextNode,
} from './terminals.ts'
export {
    discoverRecoverableAgentSessions,
    forkAgentSession,
    removePersistedAgentRecord,
    resumePersistedAgentSession,
} from './recovery.ts'
export {
    attachUnclaimedTmuxSession,
    killUnclaimedTmuxSession,
    listUnclaimedTmuxSessions,
} from './tmuxUnclaimed.ts'
export {dispatchOnNewNodeHooks} from './hooks.ts'
