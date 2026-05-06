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
};

const DEFAULT_QUIESCENCE_MS: number = 800;
const DEFAULT_POLL_INTERVAL_MS: number = 250;

type RunnerState = {
    readonly terminalId: string;
    readonly emulator: Emulator;
    readonly callbacks: PromptRunnerCallbacks;
    readonly quiescenceMs: number;
    readonly patterns: readonly PromptPattern[];
    readonly pollTimer: ReturnType<typeof setInterval>;
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

// Single source of truth for `Date.now`. Exposed for tests via `__setNowForTests`.
let nowFn: () => number = Date.now;

export function startPromptDetection(
    terminalId: string,
    callbacks: PromptRunnerCallbacks,
    options: PromptRunnerOptions = {},
): () => void {
    if (runners.has(terminalId)) {
        // Idempotent — second start is a no-op.
        return () => stopPromptDetection(terminalId);
    }

    const emulator: Emulator = createEmulator();
    const quiescenceMs: number = options.quiescenceMs ?? DEFAULT_QUIESCENCE_MS;
    const pollIntervalMs: number = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const patterns: readonly PromptPattern[] = options.patterns ?? DEFAULT_PROMPT_PATTERNS;

    const state: RunnerState = {
        terminalId,
        emulator,
        callbacks,
        quiescenceMs,
        patterns,
        pollTimer: setInterval(() => { void poll(terminalId); }, pollIntervalMs),
        lastWriteAt: nowFn(),
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
    state.lastWriteAt = nowFn();
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
    clearInterval(state.pollTimer);
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
    nowFn = fn;
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

    const elapsed: number = nowFn() - state.lastWriteAt;
    if (elapsed < state.quiescenceMs) return; // Still in flux — wait.

    const result: PromptDetectionResult = detectPromptShape(state.emulator.getSnapshot(), state.patterns);

    const isAwaiting: boolean = result.type === 'awaiting';

    // State transition logic — only emit on changes.
    if (isAwaiting && !state.awaitingActive) {
        // Detected → fire 'detected'.
        state.awaitingActive = true;
        state.lastAwaitingPatternId = result.type === 'awaiting' ? result.patternId : null;
        state.callbacks.onStateChange(terminalId, {
            kind: 'detected',
            patternId: result.type === 'awaiting' ? result.patternId : 'unknown',
            confidence: result.type === 'awaiting' ? result.confidence : 'medium',
        });
    } else if (!isAwaiting && state.awaitingActive) {
        // Cleared (e.g. quiescent but the prompt has scrolled off or cursor moved).
        state.awaitingActive = false;
        state.lastAwaitingPatternId = null;
        state.callbacks.onStateChange(terminalId, { kind: 'cleared' });
    } else if (isAwaiting && state.awaitingActive && result.type === 'awaiting'
               && result.patternId !== state.lastAwaitingPatternId) {
        // Same awaiting state, different pattern matched (e.g. shifted from generic-? to Y/N).
        // Update the recorded pattern but don't re-fire.
        state.lastAwaitingPatternId = result.patternId;
    }
}
