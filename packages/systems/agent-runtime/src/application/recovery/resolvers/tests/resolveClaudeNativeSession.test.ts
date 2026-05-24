import {describe, expect, it} from 'vitest'
import {resolveClaudeNativeSession, type ResolveClaudeDeps} from '../resolveClaudeNativeSession'
import type {ClaudeTranscriptRecord} from '../claude-transcript-matcher'

const TERMINAL = 'Ari'
const VAULT = '/vault'
const TASK = '/vault/task.md'
const NOW = 1779424330000

function markerRecord(sessionId: string): ClaudeTranscriptRecord {
    return {
        sessionId,
        type: 'user',
        message: {
            role: 'user',
            content: `prompt body\nVOICETREE_TERMINAL_ID = ${TERMINAL}\nVOICETREE_VAULT_PATH = ${VAULT}\nTASK_NODE_PATH = ${TASK}`,
        },
    }
}

function makeDeps(overrides: Partial<ResolveClaudeDeps> = {}): ResolveClaudeDeps {
    return {
        listProjectTranscripts: () => [],
        fileModifiedAt: () => NOW,
        readJsonlLines: () => [],
        now: () => NOW,
        ...overrides,
    }
}

describe('resolveClaudeNativeSession', () => {
    it('returns the sessionId from the most recently modified matching transcript', () => {
        const result = resolveClaudeNativeSession(
            {terminalId: TERMINAL, projectRoot: VAULT, taskNodePath: TASK},
            makeDeps({
                listProjectTranscripts: () => ['/x/old.jsonl', '/x/new.jsonl'],
                fileModifiedAt: (p) => (p === '/x/new.jsonl' ? NOW - 60_000 : NOW - 3_600_000),
                readJsonlLines: (p) => (p === '/x/new.jsonl' ? [markerRecord('sess-new')] : [markerRecord('sess-old')]),
            }),
        )
        expect(result).toEqual({kind: 'found', sessionId: 'sess-new', providerStorePath: '/x/new.jsonl'})
    })

    it('falls through to older transcripts when newest does not match', () => {
        const result = resolveClaudeNativeSession(
            {terminalId: TERMINAL, projectRoot: VAULT, taskNodePath: TASK},
            makeDeps({
                listProjectTranscripts: () => ['/x/old.jsonl', '/x/new.jsonl'],
                fileModifiedAt: (p) => (p === '/x/new.jsonl' ? NOW - 60_000 : NOW - 3_600_000),
                readJsonlLines: (p) => (p === '/x/new.jsonl' ? [] : [markerRecord('sess-old')]),
            }),
        )
        expect(result).toEqual({kind: 'found', sessionId: 'sess-old', providerStorePath: '/x/old.jsonl'})
    })

    it('skips transcripts older than the recency window', () => {
        const result = resolveClaudeNativeSession(
            {terminalId: TERMINAL, projectRoot: VAULT, taskNodePath: TASK, recencyWindowMs: 60_000},
            makeDeps({
                listProjectTranscripts: () => ['/x/stale.jsonl'],
                fileModifiedAt: () => NOW - 3_600_000,  // 1 hour ago, outside 1-minute window
                readJsonlLines: () => {
                    throw new Error('should not read files outside window')
                },
            }),
        )
        expect(result).toEqual({kind: 'not-found'})
    })

    it('returns not-found when no candidate transcripts exist', () => {
        const result = resolveClaudeNativeSession(
            {terminalId: TERMINAL, projectRoot: VAULT, taskNodePath: TASK},
            makeDeps({listProjectTranscripts: () => []}),
        )
        expect(result).toEqual({kind: 'not-found'})
    })

    it('returns not-found when no record in the recent transcripts matches the markers', () => {
        const result = resolveClaudeNativeSession(
            {terminalId: TERMINAL, projectRoot: VAULT, taskNodePath: TASK},
            makeDeps({
                listProjectTranscripts: () => ['/x/recent.jsonl'],
                fileModifiedAt: () => NOW - 60_000,
                readJsonlLines: () => [
                    {sessionId: 'unrelated', message: {role: 'user', content: 'no markers here'}} as ClaudeTranscriptRecord,
                ],
            }),
        )
        expect(result).toEqual({kind: 'not-found'})
    })
})
