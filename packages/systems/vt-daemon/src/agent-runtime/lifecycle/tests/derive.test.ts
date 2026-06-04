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

describe('derive — agent status presets', () => {
    it('agent_event awaiting_input → awaiting_input', () => {
        expect(lifecycleAfter([
            { type: 'output', at: T0 + 100 },
            { type: 'agent_event', at: T0 + 200, kind: 'awaiting_input' },
        ])).toBe('awaiting_input');
    });

    it('agent_event done → completed', () => {
        expect(lifecycleAfter([
            { type: 'output', at: T0 + 100 },
            { type: 'agent_event', at: T0 + 200, kind: 'done' },
        ])).toBe('completed');
    });

    it('agent_event failed → errored', () => {
        expect(lifecycleAfter([
            { type: 'output', at: T0 + 100 },
            { type: 'agent_event', at: T0 + 200, kind: 'failed' },
        ])).toBe('errored');
    });

    it('agent_event working clears awaiting state', () => {
        expect(lifecycleAfter([
            { type: 'output', at: T0 + 100 },
            { type: 'agent_event', at: T0 + 200, kind: 'awaiting_input' },
            { type: 'agent_event', at: T0 + 300, kind: 'working' },
        ])).toBe('active');
    });

    it('agent_event awaiting_input works even from spawning state', () => {
        // Status reported before any output — accept it.
        expect(lifecycleAfter([
            { type: 'agent_event', at: T0 + 100, kind: 'awaiting_input' },
        ])).toBe('awaiting_input');
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
            { type: 'agent_event', at: T0 + 300, kind: 'awaiting_input' },
            { type: 'tick', at: T0 + 9_999_999 },
        ], cfg);
        expect(result.lifecycle).toBe('completed');
    });

    it('errored state ignores subsequent events', () => {
        const result: TerminalSignalState = deriveAll(init(), [
            { type: 'exit', at: T0 + 100, code: 1, signal: null },
            { type: 'output', at: T0 + 200 },
            { type: 'agent_event', at: T0 + 300, kind: 'done' },
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

    it('input does not advance lastOutputTime', () => {
        const result: TerminalSignalState = deriveAll(init(), [
            { type: 'output', at: T0 + 100 },
            { type: 'input', at: T0 + 500 },
        ], cfg);
        expect(result.lastOutputTime).toBe(T0 + 100);
    });

    it('tick alone never produces awaiting_input', () => {
        // No prompt detected → tick can only produce active or idle.
        const result: TerminalSignalState = deriveAll(init(), [
            { type: 'output', at: T0 + 100 },
            { type: 'tick', at: T0 + 200 },
            { type: 'tick', at: T0 + 99_999 },
        ], cfg);
        expect(result.lifecycle).not.toBe('awaiting_input');
    });

    it('full cycle: spawn → active → awaiting → respond → working → idle → completed', () => {
        const events: readonly TerminalEvent[] = [
            { type: 'output', at: T0 + 100 },                    // → active
            { type: 'agent_event', at: T0 + 500, kind: 'awaiting_input' }, // → awaiting_input
            { type: 'input', at: T0 + 1000 },                    // → active
            { type: 'output', at: T0 + 1100 },                   // → active (refresh)
            { type: 'tick', at: T0 + 1100 + cfg.inactivityThresholdMs }, // → idle
            { type: 'exit', at: T0 + 9000, code: 0, signal: null }, // → completed
        ];
        const final: TerminalSignalState = deriveAll(init(), events, cfg);
        expect(final.lifecycle).toBe('completed');
    });
});
