/**
 * RPC contract shapes for the 20 BF-376 outbound routes (19 in the original
 * design + `removePersistedAgentRecord`, added to give the renderer's
 * Surviving Agents picker an on-disk delete path that `removeTerminalFromRegistry`
 * — live-registry only — does not cover).
 *
 * Each route has a Request and Response interface (`Foo.Request`,
 * `Foo.Response`) so generated JSON-RPC dispatchers, the typed client
 * wrappers, and tests can all bind against one shape. Responses that
 * carry domain objects (`TerminalRecord`, `TerminalRecordPatch`, …)
 * import them from `./terminal-types`; responses that carry shapes the
 * old in-process surface returned (`RecoverableAgentSession`,
 * `AttachUnclaimedTmuxResult`, etc.) are declared here so the wire
 * contract owns its own vocabulary.
 *
 * Route ordering and route count are pinned by
 * `bf376-rpc-route-justification.md`: 19 routes from the original design + 1
 * post-merge addition (`removePersistedAgentRecord`) — kept because each one
 * has a real Main call site post-cutover. The spawn family is kept as
 * three separate routes (not collapsed) because the parameter shapes
 * are genuinely different (`spawnPlainTerminal` operates on an existing
 * node, `spawnPlainTerminalWithNode` creates a fresh orphan node first,
 * `spawnTerminalWithContextNode` runs an agent command and returns a
 * `{terminalId, contextNodeId}` pair). See the design doc for the
 * spawn-family collapse decision.
 *
 * Wire dialect: JSON-RPC 2.0 over POST /rpc (existing VTD pipeline,
 * `transport/rpcDispatch.ts`). Branded strings (`TerminalId`) round-trip
 * cleanly as JSON strings. fp-ts `Option<X>` round-trips as
 * `{_tag:'None'} | {_tag:'Some', value: X}` — the existing in-process
 * `TerminalData.anchoredToNodeId` serializer already produces that
 * shape, so receivers reconstruct the Option at the boundary.
 */

import type {
    Position,
    GraphDelta,
} from '@vt/graph-model/graph'
import type {NodeIdAndFilePath} from './core-types.ts'
import type {UnseenNode} from '@vt/graph-db-protocol'
import type {
    TerminalId,
    TerminalData,
    TerminalRecord,
    TerminalRecordPatch,
    TerminalSpawnResult,
    TerminalOperationResult,
} from './terminal-types.ts'

// ---------------------------------------------------------------------------
// Wire-shape helpers
// ---------------------------------------------------------------------------

/**
 * `void` over the wire is `null` in JSON-RPC `result`. Use this alias on
 * routes whose in-process counterpart returns `void` so the contract is
 * explicit at the call site.
 */
export type VoidResponse = null

// ---------------------------------------------------------------------------
// Domain types carried over the wire
// ---------------------------------------------------------------------------

/**
 * Unseen-node row returned by `getUnseenNodesForTerminal`. The full graph
 * node sits in the registry the receiver already has — this is the
 * minimal projection the receiver needs to render the unseen-nodes
 * sidebar.
 */
export interface UnseenNodeInfo {
    readonly nodeId: NodeIdAndFilePath
    readonly title: string
    readonly contentPreview: string
}

/**
 * Capability flags for a discovered recovery candidate. `attach` means the
 * tmux session is still alive; `resume` means the underlying CLI (Claude
 * or Codex) stored a resumable session and we can spawn a new tmux pane
 * that picks up where the prior one left off.
 */
export interface AttachCapability {
    readonly sessionName: string
}
export interface ResumeCapability {
    readonly cliType: 'claude' | 'codex'
}

/**
 * One row returned by `discoverRecoverableAgentSessions`. Mirrors the
 * in-process `RecoverableAgentSession` shape used today.
 */
export interface RecoverableAgentSession {
    readonly terminalId: TerminalId
    readonly agentName: string
    readonly metadataPath: string
    readonly terminalData: TerminalData
    readonly isClaimed: boolean
    readonly attach?: AttachCapability
    readonly resume?: ResumeCapability
}

export type ResumePersistedResult =
    | {readonly kind: 'spawned'; readonly pid: number; readonly command: string}
    | {readonly kind: 'stale'; readonly reason: 'not-in-discovery' | 'already-claimed' | 'no-resume-handle'}
    | {readonly kind: 'no-native-session'; readonly cliType: 'claude' | 'codex'}
    | {readonly kind: 'unsupported'; readonly reason: 'gemini-not-supported' | 'custom-cli-not-supported' | 'empty-session-id' | 'missing-initial-command' | 'no-cli-detected' | 'missing-project-root'}
    | {readonly kind: 'spawn-failed'; readonly error: string}

export type ForkAgentSessionResult =
    | {readonly kind: 'spawned'; readonly forkedTerminalId: TerminalId; readonly pid: number; readonly command: string}
    | {readonly kind: 'stale'; readonly reason: 'not-in-discovery' | 'no-resume-handle'}
    | {readonly kind: 'no-native-session'; readonly cliType: 'claude' | 'codex'}
    | {readonly kind: 'unsupported'; readonly reason: 'gemini-not-supported' | 'custom-cli-not-supported' | 'empty-session-id' | 'missing-initial-command' | 'no-cli-detected' | 'missing-project-root'}
    | {readonly kind: 'spawn-failed'; readonly error: string}

/**
 * One tmux session classified as unclaimed (no live registry row points at
 * it). Returned by `listUnclaimedTmuxSessions`; consumed by Main to render
 * the recovery picker.
 */
export type UnclaimedTmuxClassification = 'this-vault' | 'foreign-vault'

export interface UnclaimedTmuxSession {
    readonly sessionName: string
    readonly terminalId: string
    readonly hash: string
    readonly classification: UnclaimedTmuxClassification
    readonly attachable: boolean
    readonly createdAt: number
    readonly panePid: number
    readonly agentName: string
    readonly projectRoot?: string
    readonly contextNodePath?: string
    readonly taskNodePath?: string
}

export interface AttachUnclaimedTmuxResult {
    readonly success: boolean
    readonly terminalId?: string
    readonly terminalData?: TerminalData
    readonly error?: string
}

export interface KillUnclaimedTmuxResult {
    readonly success: boolean
    readonly error?: string
}

/**
 * `closeHeadlessAgent` discriminated response — `closed: true` covers both
 * "was running, killed it" and "found a record but it had already
 * exited", with `wasRunning` flagging which case occurred.
 */
export type CloseHeadlessAgentResponse =
    | {readonly closed: true; readonly wasRunning: boolean}
    | {readonly closed: false}

// ---------------------------------------------------------------------------
// Route catalogue — 20 routes, grouped by domain
// ---------------------------------------------------------------------------

// --- Spawn family (3) ------------------------------------------------------

/** Spawn an interactive shell terminal attached to an existing node. */
export namespace SpawnPlainTerminal {
    export interface Request {
        readonly nodeId: NodeIdAndFilePath
        readonly terminalCount: number
    }
    export type Response = VoidResponse
}

/** Create a fresh orphan node at a viewport position, then spawn a plain terminal on it. */
export namespace SpawnPlainTerminalWithNode {
    export interface Request {
        readonly position: Position
        readonly terminalCount: number
    }
    export type Response = VoidResponse
}

/**
 * Run an agent command in a new tmux-backed terminal whose context node is
 * either reused (if `taskNodeId` is already a context node) or created
 * fresh. Returns synchronously with the eager `terminalId` (`agentName`)
 * and resolved `contextNodeId` — the heavy prep + tmux launch runs in the
 * background after this RPC completes.
 */
export namespace SpawnTerminalWithContextNode {
    export interface Request {
        readonly taskNodeId: NodeIdAndFilePath
        readonly agentCommand?: string
        readonly terminalCount?: number
        readonly skipFitAnimation?: boolean
        readonly startUnpinned?: boolean
        readonly selectedNodeIds?: readonly NodeIdAndFilePath[]
        readonly spawnDirectory?: string
        readonly parentTerminalId?: string
        readonly promptTemplate?: string
        readonly headless?: boolean
        readonly inheritTerminalId?: string
        readonly envOverrides?: Record<string, string>
    }
    export interface Response {
        readonly terminalId: string
        readonly contextNodeId: NodeIdAndFilePath
    }
}

// --- Inject / send (2) -----------------------------------------------------

/** Write text into a terminal's PTY via the tmux send-keys ceremony. */
export namespace SendTextToTerminal {
    export interface Request {
        readonly terminalId: string
        readonly text: string
    }
    export type Response = TerminalOperationResult
}

/** Push the title + filepath of unseen nodes into an agent terminal and mark them as seen. */
export namespace InjectNodesIntoTerminal {
    export interface Request {
        readonly terminalId: string
        readonly nodeIds: readonly string[]
    }
    export interface Response {
        readonly success: boolean
        readonly injectedCount: number
    }
}

// --- Read state (3) -------------------------------------------------------

/** Whole-registry snapshot. Streamed deltas come from the `terminal-registry` SSE topic. */
export namespace GetTerminalRecords {
    export type Request = Record<string, never>
    export type Response = readonly TerminalRecord[]
}

/** Compute the unseen-nodes payload a terminal would inject. */
export namespace GetUnseenNodesForTerminal {
    export interface Request {
        readonly terminalId: string
    }
    export type Response = readonly UnseenNodeInfo[]
    /** Re-exported for the legacy `UnseenNode` consumers — same shape. */
    export type RawUnseenNode = UnseenNode
}

/**
 * Set of agent names currently in use. Wire shape is `readonly string[]`
 * (Set is not JSON-serialisable); the client wrapper reconstructs the
 * Set on the receiver side.
 */
export namespace GetExistingAgentNames {
    export type Request = Record<string, never>
    export type Response = readonly string[]
}

// --- Tmux unclaimed (3) ---------------------------------------------------

/** Adopt an unclaimed tmux session back into the registry. */
export namespace AttachUnclaimedTmuxSession {
    export interface Request {
        readonly sessionName: string
    }
    export type Response = AttachUnclaimedTmuxResult
}

/** Discover live tmux sessions that no live registry row points at. */
export namespace ListUnclaimedTmuxSessions {
    export type Request = Record<string, never>
    export type Response = readonly UnclaimedTmuxSession[]
}

/** Tear down an unclaimed tmux session by name. */
export namespace KillUnclaimedTmuxSession {
    export interface Request {
        readonly sessionName: string
    }
    export type Response = KillUnclaimedTmuxResult
}

// --- Headless agents (2) --------------------------------------------------

/** Stop a headless agent and remove its registry row. */
export namespace CloseHeadlessAgent {
    export interface Request {
        readonly terminalId: TerminalId
    }
    export type Response = CloseHeadlessAgentResponse
}

/** Captured stdout for a headless agent (running or exited). */
export namespace GetHeadlessAgentOutput {
    export interface Request {
        readonly terminalId: string
    }
    export type Response = string
}

// --- Recovery (4) ---------------------------------------------------------

/**
 * Result shape for `removePersistedAgentRecord`. Mirrors the in-process
 * discriminated result so the renderer can show a targeted error string
 * (e.g. "still running — close it first") without re-classifying.
 */
export type RemovePersistedAgentRecordResult =
    | {readonly kind: 'removed'}
    | {readonly kind: 'refused'; readonly reason: 'live-registry-entry' | 'no-project-root'}
    | {readonly kind: 'invalid-id'}

/**
 * List every recoverable agent session on disk + their attach/resume capability.
 *
 * `horizonMs` controls the recency cutoff for closed records: omitted ⇒ use
 * the daemon's default horizon; `null` ⇒ no cutoff (renderer's "show older"
 * link); a positive number ⇒ override the horizon for this call. The daemon
 * passes it through to the in-process `discoverRecoverableAgentSessions(deps, opts)`.
 */
export namespace DiscoverRecoverableAgentSessions {
    export interface Request {
        readonly horizonMs?: number | null
    }
    export type Response = readonly RecoverableAgentSession[]
}

/**
 * Resume a recoverable session by spawning a fresh tmux pane that
 * re-attaches the CLI's persisted session. Folds in `resetAuditRetryCount`
 * (the audit retry counter is part of resume bookkeeping; no separate
 * route).
 */
export namespace ResumePersistedAgentSession {
    export interface Request {
        readonly terminalId: TerminalId
    }
    export type Response = ResumePersistedResult
}

/** Spawn a new terminal that forks an existing session's resume handle. */
export namespace ForkAgentSession {
    export interface Request {
        readonly sourceTerminalId: TerminalId
    }
    export type Response = ForkAgentSessionResult
}

/**
 * Permanently delete a persisted recovery record from disk. Refuses when
 * the terminal is still live in the registry (would orphan a running
 * agent's view of its own metadata) and returns `invalid-id` for path-
 * traversal attempts. Idempotent: a missing JSON returns `removed`.
 */
export namespace RemovePersistedAgentRecord {
    export interface Request {
        readonly terminalId: string
    }
    export type Response = RemovePersistedAgentRecordResult
}

// --- Registry management (2) ----------------------------------------------

/** Drop a terminal row from the registry (called when the UI closes a terminal). */
export namespace RemoveTerminalFromRegistry {
    export interface Request {
        readonly terminalId: string
    }
    export type Response = VoidResponse
}

/**
 * Polymorphic state mutator — absorbs `updateTerminalPinned`,
 * `updateTerminalMinimized`, `updateTerminalActivityState`, and
 * `updateTerminalIsDone` into one RPC. The `patch` discriminator selects
 * the field; consumers exhaustively destructure on `patch.kind` per the
 * design lock's "deep and narrow: share shape → one route".
 */
export namespace PatchTerminalRecord {
    export interface Request {
        readonly terminalId: string
        readonly patch: TerminalRecordPatch
    }
    export type Response = VoidResponse
}

// --- Hook dispatch (1, Phase-2-only) --------------------------------------

/**
 * Fire on-new-node hooks for genuinely new nodes in a graph delta.
 *
 * Phase-2 leak: the FS watcher lives in Main today, so Main posts the
 * delta to VTD for hook fan-out. When Phase 3 lands the watcher in VTD
 * this route disappears and the route count drops to 18. We keep it
 * named in the contract today (rather than deferred to a phantom future
 * BF) to honour the non-deferral mandate.
 *
 * The in-process function also takes a `logHookResult` callback —
 * intentionally not on the wire. VTD wires its own logger at handler
 * registration time.
 */
export namespace DispatchOnNewNodeHooks {
    export interface Request {
        readonly delta: GraphDelta
        readonly hookCommand: string
    }
    export type Response = VoidResponse
}

// ---------------------------------------------------------------------------
// Catalogue index — single source of truth for route names
// ---------------------------------------------------------------------------

/**
 * Canonical wire method names for the 20 routes. Generated dispatchers
 * and tests can iterate this to assert "every method has a handler" or
 * "every method has a client wrapper" without listing the strings
 * twice.
 */
export const TERMINAL_RPC_METHODS = [
    // Spawn
    'spawnPlainTerminal',
    'spawnPlainTerminalWithNode',
    'spawnTerminalWithContextNode',
    // Inject / send
    'sendTextToTerminal',
    'injectNodesIntoTerminal',
    // Read state
    'getTerminalRecords',
    'getUnseenNodesForTerminal',
    'getExistingAgentNames',
    // Tmux unclaimed
    'attachUnclaimedTmuxSession',
    'listUnclaimedTmuxSessions',
    'killUnclaimedTmuxSession',
    // Headless
    'closeHeadlessAgent',
    'getHeadlessAgentOutput',
    // Recovery
    'discoverRecoverableAgentSessions',
    'resumePersistedAgentSession',
    'forkAgentSession',
    'removePersistedAgentRecord',
    // Registry management
    'removeTerminalFromRegistry',
    'patchTerminalRecord',
    // Hook dispatch (Phase-2-only)
    'dispatchOnNewNodeHooks',
] as const

export type TerminalRpcMethod = (typeof TERMINAL_RPC_METHODS)[number]

// Re-export for callers that just want one symbol — kept implicit so
// `TerminalSpawnResult` does not need an extra named re-export here.
export type {
    TerminalSpawnResult,
}
