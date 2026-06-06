import {describe, expect, it} from 'vitest';
import {detectCompletions, type CompletionEvent} from './agent-completion-notifier';
import type {TerminalLifecycle, TerminalRecord} from '@vt/vt-daemon-client';

function makeRecord(terminalId: string, lifecycle: TerminalLifecycle): TerminalRecord {
    return {
        terminalId,
        terminalData: { lifecycle } as TerminalRecord['terminalData'],
        status: lifecycle === 'completed' || lifecycle === 'errored' ? 'exited' : 'running',
        exitCode: null,
        exitSignal: null,
        killReason: null,
        auditRetryCount: 0,
        spawnedAt: Date.now(),
    };
}

describe('detectCompletions', () => {
    it('returns empty when no terminals changed', () => {
        const records: TerminalRecord[] = [makeRecord('t1', 'active')];
        expect(detectCompletions(records, records)).toEqual([]);
    });

    it('detects active → completed transition', () => {
        const prev: TerminalRecord[] = [makeRecord('t1', 'active')];
        const next: TerminalRecord[] = [makeRecord('t1', 'completed')];
        const result: readonly CompletionEvent[] = detectCompletions(prev, next);
        expect(result).toEqual([{ terminalId: 't1', lifecycle: 'completed' }]);
    });

    it('detects active → errored transition', () => {
        const prev: TerminalRecord[] = [makeRecord('t1', 'active')];
        const next: TerminalRecord[] = [makeRecord('t1', 'errored')];
        const result: readonly CompletionEvent[] = detectCompletions(prev, next);
        expect(result).toEqual([{ terminalId: 't1', lifecycle: 'errored' }]);
    });

    it('detects active → awaiting_input transition', () => {
        const prev: TerminalRecord[] = [makeRecord('t1', 'active')];
        const next: TerminalRecord[] = [makeRecord('t1', 'awaiting_input')];
        const result: readonly CompletionEvent[] = detectCompletions(prev, next);
        expect(result).toEqual([{ terminalId: 't1', lifecycle: 'awaiting_input' }]);
    });

    it('ignores terminals already in notify state', () => {
        const prev: TerminalRecord[] = [makeRecord('t1', 'completed')];
        const next: TerminalRecord[] = [makeRecord('t1', 'completed')];
        expect(detectCompletions(prev, next)).toEqual([]);
    });

    it('ignores awaiting_input → awaiting_input', () => {
        const prev: TerminalRecord[] = [makeRecord('t1', 'awaiting_input')];
        const next: TerminalRecord[] = [makeRecord('t1', 'awaiting_input')];
        expect(detectCompletions(prev, next)).toEqual([]);
    });

    it('detects multiple transitions in one update', () => {
        const prev: TerminalRecord[] = [
            makeRecord('t1', 'active'),
            makeRecord('t2', 'idle'),
            makeRecord('t3', 'completed'),
        ];
        const next: TerminalRecord[] = [
            makeRecord('t1', 'completed'),
            makeRecord('t2', 'errored'),
            makeRecord('t3', 'completed'),
        ];
        const result: readonly CompletionEvent[] = detectCompletions(prev, next);
        expect(result).toEqual([
            { terminalId: 't1', lifecycle: 'completed' },
            { terminalId: 't2', lifecycle: 'errored' },
        ]);
    });

    it('detects new terminal that appears already completed', () => {
        const prev: TerminalRecord[] = [];
        const next: TerminalRecord[] = [makeRecord('t1', 'completed')];
        const result: readonly CompletionEvent[] = detectCompletions(prev, next);
        expect(result).toEqual([{ terminalId: 't1', lifecycle: 'completed' }]);
    });

    it('ignores terminals that remain non-terminal', () => {
        const prev: TerminalRecord[] = [makeRecord('t1', 'spawning')];
        const next: TerminalRecord[] = [makeRecord('t1', 'active')];
        expect(detectCompletions(prev, next)).toEqual([]);
    });

    it('ignores terminals removed from next snapshot', () => {
        const prev: TerminalRecord[] = [makeRecord('t1', 'active')];
        const next: TerminalRecord[] = [];
        expect(detectCompletions(prev, next)).toEqual([]);
    });
});
