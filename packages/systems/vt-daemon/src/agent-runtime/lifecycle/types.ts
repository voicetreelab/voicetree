/**
 * Terminal lifecycle types — the state machine that replaces the boolean `isDone`.
 *
 * Pure types only. No I/O, no runtime logic.
 *
 * `TerminalLifecycle` and `TerminalKillReason` are canonically owned by
 * `@vt/vt-daemon-protocol` (BF-376 outbound) so the VTD wire contract can
 * describe them without back-importing agent-runtime. Re-exported here to keep
 * the in-package `lifecycle` deep path stable.
 *
 * The lifecycle is pure *liveness*, derived from raw PTY activity and process
 * exit only. The semantic "what is the agent doing" signal is a separate,
 * agent-declared concern (`AgentStatusPreset`, set via `create_graph`) and
 * never flows through this reducer.
 */

import type {
    TerminalLifecycle,
    TerminalKillReason,
} from '@vt/vt-daemon-protocol'

export type {TerminalLifecycle, TerminalKillReason}

/**
 * Discriminated union of every signal the lifecycle reducer can consume.
 * All sources (PTY, OS poller) push events onto a single stream; `derive` is
 * agnostic to who produced what.
 */
export type TerminalEvent =
    | { readonly type: 'output'; readonly at: number }
    | { readonly type: 'exit'; readonly at: number; readonly code: number | null; readonly signal: string | null }
    | { readonly type: 'tick'; readonly at: number };

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
 * The two finished lifecycle states. Once a terminal enters one of these it is
 * sticky — no further event moves it — until the user spawns a new terminal.
 */
export function isFinishedLifecycle(state: TerminalLifecycle): boolean {
    return state === 'completed' || state === 'errored';
}

