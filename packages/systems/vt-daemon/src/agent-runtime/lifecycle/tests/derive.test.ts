import { describe, expect, it } from 'vitest';
import { derive, deriveAll, withKillReason } from '../derive';
import { DEFAULT_DERIVE_CONFIG, initialSignalState } from '../types';
import type { TerminalEvent, TerminalLifecycle, TerminalSignalState } from '../types';

const T0: number = 1_000_000;
const cfg = DEFAULT_DERIVE_CONFIG;

function init(at: number = T0): TerminalSignalState {
    return initialSignalState(at);
}

function lifecycleAfter(events: readonly TerminalEvent[]): TerminalLifecycle {
    return deriveAll(init(), events, cfg).lifecycle;
}

describe('derive — happy path transitions', () => {
    it('starts in spawning', () => {
        expect(init().lifecycle).toBe('spawning');
    });

    it('first output: spawning → active', () => {
        expect(lifecycleAfter([
            { type: 'output', at: T0 + 100 },
        ])).toBe('active');
    });

    it('active → idle after inactivity threshold', () => {
        expect(lifecycleAfter([
            { type: 'output', at: T0 + 100 },
            { type: 'tick', at: T0 + 100 + cfg.inactivityThresholdMs },
        ])).toBe('idle');
    });

    it('does not flip active → idle before threshold', () => {
        expect(lifecycleAfter([
            { type: 'output', at: T0 + 100 },
            { type: 'tick', at: T0 + 100 + cfg.inactivityThresholdMs - 1 },
        ])).toBe('active');
    });

    it('idle → active when output resumes', () => {
        expect(lifecycleAfter([
            { type: 'output', at: T0 + 100 },
            { type: 'tick', at: T0 + 10_000 },
            { type: 'output', at: T0 + 11_000 },
        ])).toBe('active');
    });
});

describe('derive — exit events', () => {
    it('exit code 0 → completed', () => {
        expect(lifecycleAfter([
            { type: 'output', at: T0 + 100 },
            { type: 'exit', at: T0 + 200, code: 0, signal: null },
        ])).toBe('completed');
    });

    it('exit code 1 → errored', () => {
        expect(lifecycleAfter([
            { type: 'output', at: T0 + 100 },
            { type: 'exit', at: T0 + 200, code: 1, signal: null },
        ])).toBe('errored');
    });

    it('SIGSEGV → errored', () => {
        expect(lifecycleAfter([
            { type: 'output', at: T0 + 100 },
            { type: 'exit', at: T0 + 200, code: null, signal: 'SIGSEGV' },
        ])).toBe('errored');
    });

    it('user-initiated SIGTERM → completed', () => {
        const state: TerminalSignalState = withKillReason(
            deriveAll(init(), [{ type: 'output', at: T0 + 100 }], cfg),
            'user',
        );
        const after: TerminalSignalState = derive(
            state,
            { type: 'exit', at: T0 + 200, code: null, signal: 'SIGTERM' },
            cfg,
        );
        expect(after.lifecycle).toBe('completed');
    });
});

describe('derive — terminal-state stickiness', () => {
    it('completed state ignores subsequent events', () => {
        const result: TerminalSignalState = deriveAll(init(), [
            { type: 'exit', at: T0 + 100, code: 0, signal: null },
            { type: 'output', at: T0 + 200 },
            { type: 'tick', at: T0 + 9_999_999 },
        ], cfg);
        expect(result.lifecycle).toBe('completed');
    });

    it('errored state ignores subsequent events', () => {
        const result: TerminalSignalState = deriveAll(init(), [
            { type: 'exit', at: T0 + 100, code: 1, signal: null },
            { type: 'output', at: T0 + 200 },
        ], cfg);
        expect(result.lifecycle).toBe('errored');
    });
});

describe('derive — invariants', () => {
    it('output always sets lastOutputTime to event time', () => {
        const result: TerminalSignalState = deriveAll(init(), [
            { type: 'output', at: T0 + 100 },
            { type: 'output', at: T0 + 250 },
            { type: 'output', at: T0 + 999 },
        ], cfg);
        expect(result.lastOutputTime).toBe(T0 + 999);
    });

    it('full liveness cycle: spawn → active → idle → completed', () => {
        const events: readonly TerminalEvent[] = [
            { type: 'output', at: T0 + 100 },                            // → active
            { type: 'output', at: T0 + 1100 },                           // → active (refresh)
            { type: 'tick', at: T0 + 1100 + cfg.inactivityThresholdMs }, // → idle
            { type: 'exit', at: T0 + 9000, code: 0, signal: null },      // → completed
        ];
        const final: TerminalSignalState = deriveAll(init(), events, cfg);
        expect(final.lifecycle).toBe('completed');
    });
});
