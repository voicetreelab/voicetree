/**
 * Terminal lifecycle types — the state machine that replaces the boolean `isDone`.
 *
 * See plan: terminalstatusimplementationplan.md
 *
 * Pure types only. No I/O, no runtime logic.
 */

/**
 * Six mutually-exclusive lifecycle states. Drives the icon shown in the sidebar.
 *
 * Transitions live in `derive.ts`.
 */
export type TerminalLifecycle =
    | 'spawning'         // created, no output yet
    | 'active'           // output observed within INACTIVITY_THRESHOLD_MS
    | 'idle'             // alive, quiet, no completion signal (the old `isDone === true`)
    | 'awaiting_input'   // agent hook says it is waiting on user
    | 'completed'        // exit code 0, agent self-reported done, or VoiceTree-initiated kill
    | 'errored';         // crash, non-zero exit, or external kill

/**
 * Why a terminal was killed. Set by VoiceTree when it issues the kill signal;
 * consumed by `classifyExit` to distinguish user-initiated termination
 * (COMPLETED) from external termination (ERRORED).
 */
export type TerminalKillReason = 'user' | 'external';

/**
 * Agent lifecycle events emitted by hooks (Claude Code Notification/Stop/
 * UserPromptSubmit, Codex Stop/PermissionRequest/UserPromptSubmit) or the
 * SDK (`markAwaiting`/`markDone`). The sole source of awaiting_input.
 */
export type AgentEventKind = 'awaiting' | 'done' | 'working';

/**
 * Discriminated union of every signal the lifecycle reducer can consume.
 * All sources (PTY, hook server, OS poller) push events onto a single
 * stream; `derive` is agnostic to who produced what.
 */
export type TerminalEvent =
    | { readonly type: 'output'; readonly at: number }
    | { readonly type: 'input'; readonly at: number }
    | { readonly type: 'exit'; readonly at: number; readonly code: number | null; readonly signal: string | null }
    | { readonly type: 'tick'; readonly at: number }
    | { readonly type: 'agent_event'; readonly at: number; readonly kind: AgentEventKind };

/**
 * Per-terminal carry state for the reducer. The `lifecycle` field is what
 * downstream consumers render; the rest is bookkeeping needed to compute
 * the next transition.
 */
export type TerminalSignalState = {
    readonly lifecycle: TerminalLifecycle;
    readonly lastOutputTime: number;
    readonly killReason: TerminalKillReason | null;
};

export type DeriveConfig = {
    readonly inactivityThresholdMs: number;
};

export const DEFAULT_DERIVE_CONFIG: DeriveConfig = {
    inactivityThresholdMs: 5000,
};

/**
 * Initial state for a freshly-spawned terminal. `lastOutputTime` is set to the
 * spawn time so a `tick` immediately after spawn does not flip to idle.
 */
export function initialSignalState(spawnTime: number): TerminalSignalState {
    return {
        lifecycle: 'spawning',
        lastOutputTime: spawnTime,
        killReason: null,
    };
}

/**
 * Terminal lifecycle states for which no further events are accepted.
 * Once a terminal enters one of these, it stays there until the user
 * spawns a new terminal.
 */
export function isTerminalLifecycle(state: TerminalLifecycle): boolean {
    return state === 'completed' || state === 'errored';
}
