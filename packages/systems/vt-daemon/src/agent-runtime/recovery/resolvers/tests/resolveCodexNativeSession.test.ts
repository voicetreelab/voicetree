import {describe, expect, it} from 'vitest'
import {resolveCodexNativeSession, type CodexQueryResult, type ResolveCodexDeps} from '../resolveCodexNativeSession'
import type {CodexThreadRow} from '../codex-thread-matcher'

const TERMINAL = 'Eva'
const VAULT = '/vault'
const TASK = '/vault/task.md'
const NOW = 1779424330000

function makeRow(overrides: Partial<CodexThreadRow> = {}): CodexThreadRow {
    return {
        id: 'thread-uuid-default',
        first_user_message: `header\nVOICETREE_TERMINAL_ID = ${TERMINAL} VOICETREE_PROJECT_PATH = ${VAULT} TASK_NODE_PATH = ${TASK}`,
        cwd: VAULT,
        created_at_ms: NOW - 120_000,
        updated_at_ms: NOW - 60_000,
        rollout_path: '/Users/x/.codex/sessions/2026/05/22/rollout-default.jsonl',
        ...overrides,
    }
}

function rows(rs: readonly CodexThreadRow[]): CodexQueryResult {
    return {kind: 'rows', rows: rs}
}

function makeDeps(overrides: Partial<ResolveCodexDeps> = {}): ResolveCodexDeps {
    return {
        listRecentThreads: () => rows([]),
        listAnyThreads: () => rows([]),
        now: () => NOW,
        ...overrides,
    }
}

describe('resolveCodexNativeSession', () => {
    it('returns the thread id and rollout_path for a matching row', () => {
        const result = resolveCodexNativeSession(
            {terminalId: TERMINAL, projectRoot: VAULT, taskNodePath: TASK},
            makeDeps({listRecentThreads: () => rows([makeRow({id: 'thread-A', rollout_path: '/rollouts/A.jsonl'})])}),
        )
        expect(result).toEqual({
            kind: 'found',
            sessionId: 'thread-A',
            providerStorePath: '/rollouts/A.jsonl',
        })
    })

    it('returns found without providerStorePath when the matching row has no rollout_path', () => {
        const result = resolveCodexNativeSession(
            {terminalId: TERMINAL, projectRoot: VAULT, taskNodePath: TASK},
            makeDeps({listRecentThreads: () => rows([makeRow({id: 'thread-B', rollout_path: undefined})])}),
        )
        expect(result).toEqual({kind: 'found', sessionId: 'thread-B'})
    })

    it('returns marker-mismatch when recent rows exist but none carry the three VoiceTree markers', () => {
        const result = resolveCodexNativeSession(
            {terminalId: TERMINAL, projectRoot: VAULT, taskNodePath: TASK},
            makeDeps({listRecentThreads: () => rows([makeRow({first_user_message: 'no markers here'})])}),
        )
        expect(result).toEqual({kind: 'not-found', reason: 'marker-mismatch'})
    })

    it('passes the configured recency window and row limit through to the deps', () => {
        let capturedSince: number = -1
        let capturedLimit: number = -1
        resolveCodexNativeSession(
            {terminalId: TERMINAL, projectRoot: VAULT, taskNodePath: TASK, recencyWindowMs: 90_000, rowLimit: 7},
            {
                listRecentThreads: (sinceMs: number, limit: number) => {
                    capturedSince = sinceMs
                    capturedLimit = limit
                    return rows([])
                },
                listAnyThreads: () => rows([]),
                now: () => NOW,
            },
        )
        expect(capturedSince).toBe(NOW - 90_000)
        expect(capturedLimit).toBe(7)
    })

    describe('structured miss reasons', () => {
        it('returns db-missing when the windowed query reports the db cannot be opened', () => {
            const result = resolveCodexNativeSession(
                {terminalId: TERMINAL, projectRoot: VAULT, taskNodePath: TASK},
                makeDeps({listRecentThreads: () => ({kind: 'db-missing'})}),
            )
            expect(result).toEqual({kind: 'not-found', reason: 'db-missing'})
        })

        it('returns db-schema-mismatch when the prepared statement throws (table/columns absent)', () => {
            const result = resolveCodexNativeSession(
                {terminalId: TERMINAL, projectRoot: VAULT, taskNodePath: TASK},
                makeDeps({listRecentThreads: () => ({kind: 'db-schema-mismatch'})}),
            )
            expect(result).toEqual({kind: 'not-found', reason: 'db-schema-mismatch'})
        })

        it('returns no-rows when both the windowed query AND the unwindowed query return zero rows', () => {
            let unwindowedCalls = 0
            const result = resolveCodexNativeSession(
                {terminalId: TERMINAL, projectRoot: VAULT, taskNodePath: TASK},
                makeDeps({
                    listRecentThreads: () => rows([]),
                    listAnyThreads: () => {
                        unwindowedCalls += 1
                        return rows([])
                    },
                }),
            )
            expect(result).toEqual({kind: 'not-found', reason: 'no-rows'})
            expect(unwindowedCalls).toBe(1)
        })

        it('returns outside-recency-window with diagnosticSessionId when the unwindowed query matches our markers', () => {
            const result = resolveCodexNativeSession(
                {terminalId: TERMINAL, projectRoot: VAULT, taskNodePath: TASK},
                makeDeps({
                    listRecentThreads: () => rows([]),
                    listAnyThreads: () => rows([makeRow({id: 'thread-old', updated_at_ms: NOW - 30 * 24 * 60 * 60 * 1000})]),
                }),
            )
            expect(result).toEqual({
                kind: 'not-found',
                reason: 'outside-recency-window',
                diagnosticSessionId: 'thread-old',
            })
        })

        it('returns no-rows when the unwindowed query has rows but none carry our markers', () => {
            const result = resolveCodexNativeSession(
                {terminalId: TERMINAL, projectRoot: VAULT, taskNodePath: TASK},
                makeDeps({
                    listRecentThreads: () => rows([]),
                    listAnyThreads: () => rows([makeRow({first_user_message: 'unrelated user thread'})]),
                }),
            )
            expect(result).toEqual({kind: 'not-found', reason: 'no-rows'})
        })

        it('does NOT call listAnyThreads when the windowed query already returned rows (cheap path)', () => {
            let unwindowedCalls = 0
            resolveCodexNativeSession(
                {terminalId: TERMINAL, projectRoot: VAULT, taskNodePath: TASK},
                makeDeps({
                    listRecentThreads: () => rows([makeRow({first_user_message: 'no markers'})]),
                    listAnyThreads: () => {
                        unwindowedCalls += 1
                        return rows([])
                    },
                }),
            )
            expect(unwindowedCalls).toBe(0)
        })
    })
})
