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
 * Agent lifecycle events emitted by hooks (Claude Code
 * Notification/Stop/UserPromptSubmit, Codex Stop/PermissionRequest/
 * UserPromptSubmit) or the SDK (`markAwaiting` / `markDone`). The sole
 * source of `awaiting_input`.
 */
export type AgentEventKind = 'awaiting' | 'done' | 'working';

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
