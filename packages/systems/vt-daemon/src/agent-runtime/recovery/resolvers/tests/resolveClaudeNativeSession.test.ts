import {describe, expect, it} from 'vitest'
import {resolveClaudeNativeSession, type ClaudeTranscriptsList, type ResolveClaudeDeps} from '../resolveClaudeNativeSession'
import type {ClaudeTranscriptRecord} from '../claude-transcript-matcher'

const TERMINAL = 'Ari'
const PROJECT = '/project'
const TASK = '/project/task.md'
const NOW = 1779424330000

function markerRecord(sessionId: string): ClaudeTranscriptRecord {
    return {
        sessionId,
        type: 'user',
        message: {
            role: 'user',
            content: `prompt body\nVOICETREE_TERMINAL_ID = ${TERMINAL}\nVOICETREE_PROJECT_PATH = ${PROJECT}\nTASK_NODE_PATH = ${TASK}`,
        },
    }
}

function transcripts(paths: readonly string[]): ClaudeTranscriptsList {
    return {kind: 'transcripts', paths}
}

function makeDeps(overrides: Partial<ResolveClaudeDeps> = {}): ResolveClaudeDeps {
    return {
        listProjectTranscripts: () => transcripts([]),
        fileModifiedAt: () => NOW,
        readJsonlLines: () => [],
        now: () => NOW,
        ...overrides,
    }
}

describe('resolveClaudeNativeSession', () => {
    it('returns the sessionId from the most recently modified matching transcript', async () => {
        const result = await resolveClaudeNativeSession(
            {terminalId: TERMINAL, projectRoot: PROJECT, taskNodePath: TASK},
            makeDeps({
                listProjectTranscripts: () => transcripts(['/x/old.jsonl', '/x/new.jsonl']),
                fileModifiedAt: (p) => (p === '/x/new.jsonl' ? NOW - 60_000 : NOW - 3_600_000),
                readJsonlLines: (p) => (p === '/x/new.jsonl' ? [markerRecord('sess-new')] : [markerRecord('sess-old')]),
            }),
        )
        expect(result).toEqual({kind: 'found', sessionId: 'sess-new', providerStorePath: '/x/new.jsonl'})
    })

    it('falls through to older transcripts when newest does not match', async () => {
        const result = await resolveClaudeNativeSession(
            {terminalId: TERMINAL, projectRoot: PROJECT, taskNodePath: TASK},
            makeDeps({
                listProjectTranscripts: () => transcripts(['/x/old.jsonl', '/x/new.jsonl']),
                fileModifiedAt: (p) => (p === '/x/new.jsonl' ? NOW - 60_000 : NOW - 3_600_000),
                readJsonlLines: (p) => (p === '/x/new.jsonl' ? [] : [markerRecord('sess-old')]),
            }),
        )
        expect(result).toEqual({kind: 'found', sessionId: 'sess-old', providerStorePath: '/x/old.jsonl'})
    })

    it('returns outside-recency-window with diagnosticSessionId when the only match is older than the window', async () => {
        // Mirrors the Codex resolver's unwindowed 2nd pass: when nothing is in
        // the window but an out-of-window transcript carries our markers, surface
        // an actionable `outside-recency-window` miss carrying the session id so
        // the UI can offer a copy-`claude --resume <id>` escape hatch.
        const result = await resolveClaudeNativeSession(
            {terminalId: TERMINAL, projectRoot: PROJECT, taskNodePath: TASK, recencyWindowMs: 60_000},
            makeDeps({
                listProjectTranscripts: () => transcripts(['/x/stale.jsonl']),
                fileModifiedAt: () => NOW - 3_600_000,  // 1 hour ago, outside 1-minute window
                readJsonlLines: () => [markerRecord('sess-stale')],
            }),
        )
        expect(result).toEqual({
            kind: 'not-found',
            reason: 'outside-recency-window',
            diagnosticSessionId: 'sess-stale',
        })
    })

    it('returns no-jsonl-matches when an out-of-window transcript exists but carries no markers', async () => {
        const result = await resolveClaudeNativeSession(
            {terminalId: TERMINAL, projectRoot: PROJECT, taskNodePath: TASK, recencyWindowMs: 60_000},
            makeDeps({
                listProjectTranscripts: () => transcripts(['/x/stale.jsonl']),
                fileModifiedAt: () => NOW - 3_600_000,  // outside the window
                readJsonlLines: () => [
                    {sessionId: 'unrelated', message: {role: 'user', content: 'no markers here'}} as ClaudeTranscriptRecord,
                ],
            }),
        )
        expect(result).toEqual({kind: 'not-found', reason: 'no-jsonl-matches'})
    })

    describe('structured miss reasons', () => {
        it('returns projects-dir-missing when the deps report the projects directory is absent', async () => {
            const result = await resolveClaudeNativeSession(
                {terminalId: TERMINAL, projectRoot: PROJECT, taskNodePath: TASK},
                makeDeps({listProjectTranscripts: () => ({kind: 'projects-dir-missing'})}),
            )
            expect(result).toEqual({kind: 'not-found', reason: 'projects-dir-missing'})
        })

        it('returns no-jsonl-matches when the projects directory has no transcripts at all', async () => {
            const result = await resolveClaudeNativeSession(
                {terminalId: TERMINAL, projectRoot: PROJECT, taskNodePath: TASK},
                makeDeps({listProjectTranscripts: () => transcripts([])}),
            )
            expect(result).toEqual({kind: 'not-found', reason: 'no-jsonl-matches'})
        })

        it('returns marker-mismatch when in-window transcripts exist but none contain the markers', async () => {
            const result = await resolveClaudeNativeSession(
                {terminalId: TERMINAL, projectRoot: PROJECT, taskNodePath: TASK},
                makeDeps({
                    listProjectTranscripts: () => transcripts(['/x/recent.jsonl']),
                    fileModifiedAt: () => NOW - 60_000,
                    readJsonlLines: () => [
                        {sessionId: 'unrelated', message: {role: 'user', content: 'no markers here'}} as ClaudeTranscriptRecord,
                    ],
                }),
            )
            expect(result).toEqual({kind: 'not-found', reason: 'marker-mismatch'})
        })

        it('returns scan-timeout when the deadline elapses before all files are read', async () => {
            // Start `now()` at NOW for the initial deadline computation, then jump past the deadline
            // on the second call so the iteration's deadline check trips before reading any file.
            let callCount = 0
            const result = await resolveClaudeNativeSession(
                {terminalId: TERMINAL, projectRoot: PROJECT, taskNodePath: TASK, scanTimeoutMs: 50},
                makeDeps({
                    listProjectTranscripts: () => transcripts(['/x/a.jsonl', '/x/b.jsonl']),
                    fileModifiedAt: () => NOW - 1_000,  // both in window
                    readJsonlLines: () => {
                        throw new Error('should not be reached after deadline trips')
                    },
                    now: () => {
                        const t = callCount === 0 ? NOW : NOW + 1_000  // 1s elapsed >> 50ms budget
                        callCount += 1
                        return t
                    },
                }),
            )
            expect(result).toEqual({kind: 'not-found', reason: 'scan-timeout'})
        })
    })
})
