import {describe, it, expect} from 'vitest'
import {
    advanceTerminalInputLine,
    deriveTerminalInputStarted,
    EMPTY_TERMINAL_INPUT_LINE_BUFFER,
    statusPhraseFromTerminalInput,
    STATUS_PHRASE_OVERRIDE_STALENESS_MS,
    type TerminalInputLineBuffer,
} from './handleTerminalInputStarted.ts'
import {createTerminalData} from '../terminal-registry/types.ts'
import type {TerminalId} from '../terminal-registry/types.ts'
import type {TerminalRecord} from '../domain/session.ts'
import type {NodeIdAndFilePath} from '@vt/graph-model/graph'

function makeRecord(overrides: Partial<TerminalRecord['terminalData']> = {}): TerminalRecord {
    const terminalData = {
        ...createTerminalData({
            terminalId: 't1' as TerminalId,
            attachedToNodeId: '/tmp/ctx.md' as NodeIdAndFilePath,
            terminalCount: 1,
            title: 'test',
            agentName: 'Agent',
        }),
        lifecycle: 'idle' as const,
        ...overrides,
    }
    return {
        terminalId: 't1',
        terminalData,
        status: 'running',
        exitCode: null,
        exitSignal: null,
        killReason: null,
        auditRetryCount: 0,
        spawnedAt: 0,
    }
}

// Feed each character as its own frame, mirroring how a relay forwards raw
// per-keystroke input.
function typeCharByChar(text: string): {buffer: TerminalInputLineBuffer; submissions: string[]} {
    let buffer: TerminalInputLineBuffer = EMPTY_TERMINAL_INPUT_LINE_BUFFER
    const submissions: string[] = []
    for (const ch of text) {
        const step = advanceTerminalInputLine(buffer, ch)
        buffer = step.buffer
        if (step.submitted !== null) submissions.push(step.submitted)
    }
    return {buffer, submissions}
}

describe('advanceTerminalInputLine', () => {
    it('accumulates keystrokes and only submits on Enter (CR)', () => {
        const {buffer, submissions} = typeCharByChar('review the PR\r')
        expect(submissions).toEqual(['review the PR'])
        expect(buffer.pending).toBe('')
    })

    it('treats LF as Enter too', () => {
        expect(advanceTerminalInputLine(EMPTY_TERMINAL_INPUT_LINE_BUFFER, 'hi\n')).toEqual({
            buffer: {pending: ''},
            submitted: 'hi',
        })
    })

    it('does not submit while a line is still being typed', () => {
        const {buffer, submissions} = typeCharByChar('half typed')
        expect(submissions).toEqual([])
        expect(buffer.pending).toBe('half typed')
    })

    it('handles backspace (DEL/BS) as an edit of the pending line', () => {
        const {submissions} = typeCharByChar('helxx\x7f\x7flo\r')
        expect(submissions).toEqual(['hello'])
    })

    it('carries text typed after Enter into the next buffer', () => {
        const step = advanceTerminalInputLine({pending: 'first'}, ' line\rnext')
        expect(step.submitted).toBe('first line')
        expect(step.buffer.pending).toBe('next')
    })

    it('joins multiple submitted lines in a single frame (paste)', () => {
        const step = advanceTerminalInputLine(EMPTY_TERMINAL_INPUT_LINE_BUFFER, 'one\rtwo\r')
        expect(step.submitted).toBe('one two')
        expect(step.buffer.pending).toBe('')
    })

    it('a bare Enter is a submission of empty string, not null', () => {
        expect(advanceTerminalInputLine(EMPTY_TERMINAL_INPUT_LINE_BUFFER, '\r').submitted).toBe('')
    })
})

describe('statusPhraseFromTerminalInput', () => {
    it('keeps only letters, collapsing the rest to single spaces', () => {
        expect(statusPhraseFromTerminalInput('[From: Bob] ship fix/x? 123')).toBe('From Bob ship fix x')
    })
})

describe('deriveTerminalInputStarted — phrase staleness', () => {
    it('overrides an empty phrase immediately', () => {
        const record = makeRecord({statusPhrase: '', statusPhraseUpdatedAt: 0})
        const result = deriveTerminalInputStarted(record, 'fix the bug', 1_000)
        expect(result.record.terminalData.statusPhrase).toBe('fix the bug')
        expect(result.record.terminalData.statusPhraseUpdatedAt).toBe(1_000)
    })

    it('protects a phrase younger than the staleness window', () => {
        const record = makeRecord({statusPhrase: 'opened PR', statusPhraseUpdatedAt: 1_000})
        const result = deriveTerminalInputStarted(
            record,
            'something new',
            1_000 + STATUS_PHRASE_OVERRIDE_STALENESS_MS - 1,
        )
        expect(result.record.terminalData.statusPhrase).toBe('opened PR')
        // Turn state still resets even when the phrase is preserved.
        expect(result.record.terminalData.lifecycle).toBe('active')
        expect(result.record.terminalData.isDone).toBe(false)
    })

    it('overrides a phrase at/after the staleness window', () => {
        const record = makeRecord({statusPhrase: 'opened PR', statusPhraseUpdatedAt: 1_000})
        const result = deriveTerminalInputStarted(
            record,
            'review feedback',
            1_000 + STATUS_PHRASE_OVERRIDE_STALENESS_MS,
        )
        expect(result.record.terminalData.statusPhrase).toBe('review feedback')
    })

    it('never overrides a phrase with letter-free input', () => {
        const record = makeRecord({statusPhrase: 'opened PR', statusPhraseUpdatedAt: 0})
        const result = deriveTerminalInputStarted(record, '123 !!!', 10 * 60_000)
        expect(result.record.terminalData.statusPhrase).toBe('opened PR')
    })

    it('is a no-op for an exited terminal', () => {
        const record = {...makeRecord(), status: 'exited' as const}
        const result = deriveTerminalInputStarted(record, 'too late', 10 * 60_000)
        expect(result.changed).toBe(false)
        expect(result.record).toBe(record)
    })
})
