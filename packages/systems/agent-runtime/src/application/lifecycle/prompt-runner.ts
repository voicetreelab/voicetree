/**
 * Prompt-detection runner — ties the headless emulator to the pure
 * detector, gates emissions on quiescence + state-change, and notifies
 * a callback when prompt state transitions.
 *
 * One runner per active PTY terminal. Started on terminal spawn,
 * stopped on terminal exit.
 *
 * Quiescence gate: after each byte arrival we mark `dirty` and stamp
 * `lastWriteAt`. The poll loop only runs the detector if no bytes have
 * arrived for >= QUIESCENCE_MS — this rules out false positives from
 * narrative output that briefly resembles a prompt.
 *
 * Edge module — owns timers and Map state. The actual classification is
 * pure (prompts.ts).
 */

import { createEmulator, type Emulator } from './emulator';
import { detectPromptShape, DEFAULT_PROMPT_PATTERNS, type PromptDetectionResult, type PromptPattern } from './prompts';

export type PromptStateChange =
    | { readonly kind: 'detected'; readonly patternId: string; readonly confidence: 'high' | 'medium' }
    | { readonly kind: 'cleared' };

export type PromptRunnerCallbacks = {
    /** Called whenever the prompt state changes (detected ↔ cleared). */
    readonly onStateChange: (terminalId: string, change: PromptStateChange) => void;
};

export type PromptRunnerOptions = {
    /** Min ms of no output before the detector runs. Default 800. */
    readonly quiescenceMs?: number;
    /** How often the runner ticks. Default 250ms. */
    readonly pollIntervalMs?: number;
    /** Override the pattern catalog. Default: built-in. */
    readonly patterns?: readonly PromptPattern[];
    /** Runtime effects. Defaults wire to the system clock, timers, and emulator. */
    readonly dependencies?: PromptRunnerDependencies;
};

type PollTimer = ReturnType<typeof setInterval>;

export type PromptRunnerDependencies = {
    readonly now: () => number;
    readonly createEmulator: () => Emulator;
    readonly startPolling: (callback: () => void, intervalMs: number) => PollTimer;
    readonly stopPolling: (timer: PollTimer) => void;
};

type PromptAwaitingState = {
    readonly awaitingActive: boolean;
    readonly lastAwaitingPatternId: string | null;
};

type PromptAwaitingTransition = PromptAwaitingState & {
    readonly change: PromptStateChange | null;
};

const DEFAULT_QUIESCENCE_MS: number = 800;
const DEFAULT_POLL_INTERVAL_MS: number = 250;

type RunnerState = {
    readonly terminalId: string;
    readonly emulator: Emulator;
    readonly callbacks: PromptRunnerCallbacks;
    readonly quiescenceMs: number;
    readonly patterns: readonly PromptPattern[];
    readonly dependencies: PromptRunnerDependencies;
    readonly pollTimer: PollTimer;
    /** Timestamp of the most recent byte arrival. */
    lastWriteAt: number;
    /** Was the previous tick's classification 'awaiting'? */
    awaitingActive: boolean;
    /** Pattern id of the last detected awaiting state. */
    lastAwaitingPatternId: string | null;
    /** Whether at least one byte has been written since spawn. */
    bytesEverWritten: boolean;
};

const runners: Map<string, RunnerState> = new Map();

function readSystemNow(): number {
    return Date.now();
}

function startSystemPolling(callback: () => void, intervalMs: number): PollTimer {
    return setInterval(callback, intervalMs);
}

function stopSystemPolling(timer: PollTimer): void {
    clearInterval(timer);
}

const DEFAULT_PROMPT_RUNNER_DEPENDENCIES: PromptRunnerDependencies = {
    now: readSystemNow,
    createEmulator,
    startPolling: startSystemPolling,
    stopPolling: stopSystemPolling,
};

// Single source of truth for runtime effects. Exposed for tests via `__setNowForTests`.
let promptRunnerDependencies: PromptRunnerDependencies = DEFAULT_PROMPT_RUNNER_DEPENDENCIES;

export function startPromptDetection(
    terminalId: string,
    callbacks: PromptRunnerCallbacks,
    options: PromptRunnerOptions = {},
): () => void {
    if (runners.has(terminalId)) {
        // Idempotent — second start is a no-op.
        return () => stopPromptDetection(terminalId);
    }

    const dependencies: PromptRunnerDependencies = options.dependencies ?? promptRunnerDependencies;
    const emulator: Emulator = dependencies.createEmulator();
    const quiescenceMs: number = options.quiescenceMs ?? DEFAULT_QUIESCENCE_MS;
    const pollIntervalMs: number = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const patterns: readonly PromptPattern[] = options.patterns ?? DEFAULT_PROMPT_PATTERNS;

    const state: RunnerState = {
        terminalId,
        emulator,
        callbacks,
        quiescenceMs,
        patterns,
        dependencies,
        pollTimer: dependencies.startPolling(() => { void poll(terminalId); }, pollIntervalMs),
        lastWriteAt: dependencies.now(),
        awaitingActive: false,
        lastAwaitingPatternId: null,
        bytesEverWritten: false,
    };
    runners.set(terminalId, state);
    return () => stopPromptDetection(terminalId);
}

/**
 * Feed PTY bytes into the runner. Awaitable for tests; production callers
 * may fire-and-forget. Bytes arriving while `awaitingActive` immediately
 * fire `cleared` — output means the agent is no longer blocked.
 */
export async function feedPromptDetector(terminalId: string, bytes: string | Uint8Array): Promise<void> {
    const state: RunnerState | undefined = runners.get(terminalId);
    if (!state) return;
    state.lastWriteAt = state.dependencies.now();
    state.bytesEverWritten = true;
    await state.emulator.write(bytes);

    // Optimistic eager-clear: if a prompt was previously detected and new bytes
    // arrived, the agent is producing output again. Don't wait for the next tick.
    if (state.awaitingActive) {
        state.awaitingActive = false;
        state.lastAwaitingPatternId = null;
        state.callbacks.onStateChange(terminalId, { kind: 'cleared' });
    }
}

export function stopPromptDetection(terminalId: string): void {
    const state: RunnerState | undefined = runners.get(terminalId);
    if (!state) return;
    state.dependencies.stopPolling(state.pollTimer);
    state.emulator.dispose();
    runners.delete(terminalId);
}

export function isPromptDetectionActive(terminalId: string): boolean {
    return runners.has(terminalId);
}

/** Test-only escape hatch for clean teardown between tests. */
export function __resetAllRunnersForTests(): void {
    for (const [id] of runners) stopPromptDetection(id);
}

/** Test-only clock injection. */
export function __setNowForTests(fn: () => number): void {
    promptRunnerDependencies = {
        ...promptRunnerDependencies,
        now: fn,
    };
}

/** Test-only synchronous tick. */
export async function __tickForTests(terminalId: string): Promise<void> {
    await poll(terminalId);
}

// =============================================================================
// Internal: polling
// =============================================================================

async function poll(terminalId: string): Promise<void> {
    const state: RunnerState | undefined = runners.get(terminalId);
    if (!state) return;
    if (!state.bytesEverWritten) return; // Don't fire detection before first byte.

    const elapsed: number = state.dependencies.now() - state.lastWriteAt;
    if (elapsed < state.quiescenceMs) return; // Still in flux — wait.

    const result: PromptDetectionResult = detectPromptShape(state.emulator.getSnapshot(), state.patterns);

    // Medium-confidence Tier-3 matches (the generic question-mark fallback) are
    // inherently ambiguous between a real prompt and narrative output that
    // happens to end in "?" (Claude Code / Codex do this constantly). Treat
    // them as not-awaiting for state-propagation purposes — only high-confidence
    // patterns (Y/N, password, numbered choice, alt-screen TUI) are reliable
    // enough to drive the UI's awaiting_input lifecycle.
    const transition: PromptAwaitingTransition = derivePromptAwaitingTransition(
        {
            awaitingActive: state.awaitingActive,
            lastAwaitingPatternId: state.lastAwaitingPatternId,
        },
        result,
    );
    state.awaitingActive = transition.awaitingActive;
    state.lastAwaitingPatternId = transition.lastAwaitingPatternId;

    if (transition.change) {
        state.callbacks.onStateChange(terminalId, transition.change);
    }
}

function isHighConfidenceAwaiting(result: PromptDetectionResult): boolean {
    return result.type === 'awaiting' && result.confidence === 'high';
}

function derivePromptAwaitingTransition(
    previous: PromptAwaitingState,
    result: PromptDetectionResult,
): PromptAwaitingTransition {
    const isAwaiting: boolean = isHighConfidenceAwaiting(result);

    if (isAwaiting && !previous.awaitingActive && result.type === 'awaiting') {
        return {
            awaitingActive: true,
            lastAwaitingPatternId: result.patternId,
            change: {
                kind: 'detected',
                patternId: result.patternId,
                confidence: result.confidence,
            },
        };
    }

    if (!isAwaiting && previous.awaitingActive) {
        return {
            awaitingActive: false,
            lastAwaitingPatternId: null,
            change: { kind: 'cleared' },
        };
    }

    if (isAwaiting && previous.awaitingActive && result.type === 'awaiting'
        && result.patternId !== previous.lastAwaitingPatternId) {
        return {
            awaitingActive: true,
            lastAwaitingPatternId: result.patternId,
            change: null,
        };
    }

    return {
        awaitingActive: previous.awaitingActive,
        lastAwaitingPatternId: previous.lastAwaitingPatternId,
        change: null,
    };
}
