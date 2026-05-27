import {describe, expect, it} from 'vitest';
import {detectCompletions, type CompletionEvent} from './agent-completion-notifier';
import type {TerminalLifecycle, TerminalRecord} from '@vt/vt-daemon-client';

function makeRecord(terminalId: string, lifecycle: TerminalLifecycle, agentName: string = 'Ren'): TerminalRecord {
    return {
        terminalId,
        terminalData: { lifecycle, agentName } as TerminalRecord['terminalData'],
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
        const prev: TerminalRecord[] = [makeRecord('t1', 'active', 'Aki')];
        const next: TerminalRecord[] = [makeRecord('t1', 'completed', 'Aki')];
        const result: readonly CompletionEvent[] = detectCompletions(prev, next);
        expect(result).toEqual([{ terminalId: 't1', agentName: 'Aki', lifecycle: 'completed' }]);
    });

    it('detects active → errored transition', () => {
        const prev: TerminalRecord[] = [makeRecord('t1', 'active', 'Ben')];
        const next: TerminalRecord[] = [makeRecord('t1', 'errored', 'Ben')];
        const result: readonly CompletionEvent[] = detectCompletions(prev, next);
        expect(result).toEqual([{ terminalId: 't1', agentName: 'Ben', lifecycle: 'errored' }]);
    });

    it('detects active → awaiting_input transition', () => {
        const prev: TerminalRecord[] = [makeRecord('t1', 'active', 'Cho')];
        const next: TerminalRecord[] = [makeRecord('t1', 'awaiting_input', 'Cho')];
        const result: readonly CompletionEvent[] = detectCompletions(prev, next);
        expect(result).toEqual([{ terminalId: 't1', agentName: 'Cho', lifecycle: 'awaiting_input' }]);
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
            makeRecord('t1', 'active', 'Aki'),
            makeRecord('t2', 'idle', 'Ben'),
            makeRecord('t3', 'completed', 'Cho'),
        ];
        const next: TerminalRecord[] = [
            makeRecord('t1', 'completed', 'Aki'),
            makeRecord('t2', 'errored', 'Ben'),
            makeRecord('t3', 'completed', 'Cho'),
        ];
        const result: readonly CompletionEvent[] = detectCompletions(prev, next);
        expect(result).toEqual([
            { terminalId: 't1', agentName: 'Aki', lifecycle: 'completed' },
            { terminalId: 't2', agentName: 'Ben', lifecycle: 'errored' },
        ]);
    });

    it('detects new terminal that appears already completed', () => {
        const prev: TerminalRecord[] = [];
        const next: TerminalRecord[] = [makeRecord('t1', 'completed', 'Eve')];
        const result: readonly CompletionEvent[] = detectCompletions(prev, next);
        expect(result).toEqual([{ terminalId: 't1', agentName: 'Eve', lifecycle: 'completed' }]);
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
