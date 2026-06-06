/**
 * Canonical terminal types — single source of truth for the VTD wire
 * contract and the in-process agent-runtime.
 *
 * Both daemons (`@vt/vt-daemon`, the standalone controller) and clients
 * (`@vt/vt-daemon-client`, Main, CLI) import these shapes from here.
 * `@vt/agent-runtime` re-exports them within its own boundary so existing
 * deep imports (`@vt/agent-runtime/types`) keep resolving without forcing
 * a giant rename in this commit; the canonical definitions live here, and
 * runtime helpers (`createTerminalData`, `computeTerminalId`,
 * `getTerminalId`) remain in agent-runtime where they belong.
 *
 * `Option<NodeIdAndFilePath>` on `TerminalData.anchoredToNodeId` and
 * `NodeIdAndFilePath` itself come from the in-process graph model. fp-ts
 * is encoded as `{ _tag: 'None' } | { _tag: 'Some', value }` on the wire,
 * which is a stable JSON shape — receivers can reconstruct the Option
 * value at the boundary without a separate wire schema.
 */

import type { Option } from 'fp-ts/lib/Option.js';
import type { NodeIdAndFilePath } from './core-types.ts';

// ---------------------------------------------------------------------------
// Lifecycle vocabulary
//
// Moved here from `@vt/agent-runtime/lifecycle` so the protocol can describe
// the in-flight states a terminal can occupy without taking a runtime
// dependency on agent-runtime. Helper predicates over these (e.g.
// `isFinishedLifecycle`) stay in agent-runtime.
// ---------------------------------------------------------------------------

/**
 * Six mutually-exclusive lifecycle states. Drives the icon shown in the
 * sidebar.
 */
export type TerminalLifecycle =
    | 'spawning'         // created, no output yet
    | 'active'           // output observed within INACTIVITY_THRESHOLD_MS
    | 'idle'             // alive, quiet, no completion signal
    | 'awaiting_input'   // agent hook says it is waiting on user
    | 'completed'        // exit code 0, agent self-reported done, or VoiceTree-initiated kill
    | 'errored';         // crash, non-zero exit, or external kill

/**
 * Why a terminal was killed. Set by VoiceTree when it issues the kill
 * signal; consumed by lifecycle classification to distinguish
 * user-initiated termination (COMPLETED) from external termination (ERRORED).
 */
export type TerminalKillReason = 'user' | 'external';

/**
 * Agent-authored status preset. An agent picks one of these when it creates a
 * progress node (`create_graph`'s `agentStatus`); it is the sole driver of the
 * non-output-derived lifecycle states. Maps to `TerminalLifecycle`:
 *   working → active · awaiting_input → awaiting_input · done → completed ·
 *   failed → errored  (an orchestrator with active children downgrades
 *   awaiting_input/done to idle — it is waiting on its children, not the user).
 */
export const AGENT_STATUSES = ['working', 'awaiting_input', 'done', 'failed'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/**
 * Max length of the free-text live status phrase an agent attaches to a progress
 * node (`create_graph`'s `statusPhrase`). Rendered next to the model name in the
 * terminal tree, so it is clamped to keep the row readable. Over-long phrases
 * are truncated to this length at the registry boundary.
 */
export const MAX_STATUS_PHRASE_LENGTH = 80;

// ---------------------------------------------------------------------------
// Terminal identity & data
// ---------------------------------------------------------------------------

/**
 * Branded string identifying a single terminal. Computed from
 * `${attachedToNodeId}-terminal-${terminalCount}` (or, post-BF-N, the
 * agent name). Brand is type-level only and round-trips cleanly through
 * JSON.
 */
export type TerminalId = string & { readonly __brand: 'TerminalId' };

/**
 * Full terminal description. Carried in `TerminalRecord.terminalData` and
 * over every spawn / patch wire shape.
 */
export type TerminalData = {
    readonly type: 'Terminal';
    readonly terminalId: TerminalId;
    readonly attachedToContextNodeId: NodeIdAndFilePath;
    readonly terminalCount: number;

    readonly anchoredToNodeId: Option<NodeIdAndFilePath>;
    readonly title: string;
    readonly resizable: boolean;
    readonly shadowNodeDimensions: { readonly width: number; readonly height: number };

    readonly initialEnvVars?: Record<string, string>;
    readonly initialSpawnDirectory?: string;
    readonly initialCommand?: string;
    readonly executeCommand?: boolean;

    readonly isPinned: boolean;
    readonly isDone: boolean;
    readonly lifecycle: TerminalLifecycle;
    /**
     * Agent-authored free-text live status (≤ MAX_STATUS_PHRASE_LENGTH chars),
     * shown next to the model name in the terminal tree. Empty string until the
     * agent reports one via `create_graph`'s `statusPhrase`.
     */
    readonly statusPhrase: string;
    /**
     * Epoch-ms timestamp of the most recent `statusPhrase` write, or `0` while
     * the phrase is still its initial empty string. Used to protect a freshly
     * authored status from being clobbered by typed terminal input: input only
     * overrides the phrase once the existing one is older than
     * `STATUS_PHRASE_OVERRIDE_STALENESS_MS` (see `deriveTerminalInputStarted`).
     */
    readonly statusPhraseUpdatedAt: number;
    /**
     * The last status preset the agent *itself* declared this turn (via
     * `create_graph`'s `agentStatus` or `vt agent status`), or `null` if it has
     * not declared one. Distinct from `lifecycle`, which is lossy: an
     * orchestrator with active children has its declared `done`/`awaiting_input`
     * rendered as `idle`, so `lifecycle` alone cannot tell "idle because the
     * agent reported done" from "idle because output merely stopped". The finish
     * gate (`requireDeclaredStatus`) reads this to decide whether an idle agent
     * has actually closed itself out. Reset to `null` when the terminal
     * re-enters `active` (a new turn), so a prior turn's declaration cannot
     * satisfy a later finish.
     */
    readonly lastReportedStatus: AgentStatus | null;
    readonly lastOutputTime: number;
    readonly activityCount: number;

    readonly parentTerminalId: TerminalId | null;

    readonly agentName: string;
    readonly worktreeName: string | undefined;
    readonly isHeadless: boolean;
    readonly isMinimized: boolean;
    readonly contextContent: string;
    readonly agentTypeName: string;
};

/**
 * Constructor input for `createTerminalData` (the helper itself stays in
 * agent-runtime so the protocol package remains type-only at runtime).
 */
export type CreateTerminalDataParams = {
    readonly terminalId: TerminalId;
    readonly attachedToNodeId: NodeIdAndFilePath;
    readonly terminalCount: number;
    readonly title: string;
    readonly anchoredToNodeId?: NodeIdAndFilePath;
    readonly initialEnvVars?: Record<string, string>;
    readonly initialSpawnDirectory?: string;
    readonly initialCommand?: string;
    readonly executeCommand?: boolean;
    readonly resizable?: boolean;
    readonly shadowNodeDimensions?: { width: number; height: number };
    readonly isPinned?: boolean;
    readonly parentTerminalId?: TerminalId | null;
    readonly agentName: string;
    readonly worktreeName?: string;
    readonly isHeadless?: boolean;
    readonly isMinimized?: boolean;
    readonly contextContent?: string;
    readonly agentTypeName?: string;
};

// ---------------------------------------------------------------------------
// Registry record
// ---------------------------------------------------------------------------

export type TerminalStatus = 'running' | 'exited';

/**
 * Authoritative per-terminal row in the registry. Carried in the
 * `terminal-registered` SSE event (`{ record: TerminalRecord }`) and
 * returned from `getTerminalRecords` RPC.
 *
 * `auditRetryCount` is genuinely stateful — it tracks stop-gate resume
 * attempts across agent restarts (BF-024) — and must not be derived from
 * lifecycle.
 */
export type TerminalRecord = {
    terminalId: string
    terminalData: TerminalData
    status: TerminalStatus
    exitCode: number | null
    exitSignal: string | null
    killReason: TerminalKillReason | null
    auditRetryCount: number
    spawnedAt: number
}

// ---------------------------------------------------------------------------
// Spawn results
// ---------------------------------------------------------------------------

/**
 * Returned by `terminal-manager.spawnTmuxBacked` and surfaced through
 * `spawnPlainTerminal` / `spawnPlainTerminalWithNode`. The async
 * `spawnTerminalWithContextNode` RPC has its own response shape (see
 * `rpc-contracts.ts`) because it returns before tmux is up.
 */
export interface TerminalSpawnResult {
    success: boolean;
    terminalId: string;
    error?: string;
}

export interface TerminalOperationResult {
    success: boolean;
    error?: string;
}

// ---------------------------------------------------------------------------
// Polymorphic record patch
//
// `patchTerminalRecord` collapses four renderer-driven state mutations
// (`updateTerminalPinned`, `updateTerminalMinimized`,
// `updateTerminalActivityState`, `updateTerminalIsDone`) into one
// RPC. The discriminant `kind` selects the field; `value` carries the
// new value with kind-specific shape.
//
// `lifecycle` is the one OUTBOUND-ONLY kind: the daemon computes it
// authoritatively (idle timer, agent hooks, process exit) and broadcasts
// it over the `terminal-registry` SSE topic. The renderer never sends a
// `lifecycle` patch — the inbound `patchTerminalRecord` RPC rejects it —
// so the sidebar icon always reflects daemon-derived state rather than a
// renderer-side re-derivation that lacks those inputs.
// ---------------------------------------------------------------------------

export type TerminalRecordPatch =
    | { readonly kind: 'pinned'; readonly value: boolean }
    | { readonly kind: 'minimized'; readonly value: boolean }
    | {
        readonly kind: 'activity'
        readonly value: {
            readonly lastOutputTime?: number
            readonly activityCount?: number
        }
    }
    | { readonly kind: 'done'; readonly value: boolean }
    | { readonly kind: 'lifecycle'; readonly value: TerminalLifecycle }
    // Outbound-only, like `lifecycle`: the daemon owns the status phrase (set
    // from an agent's `create_graph` call) and broadcasts it; the renderer
    // never sends this patch.
    | { readonly kind: 'statusPhrase'; readonly value: string }
