import {describe, expect, it} from 'vitest'
import {resolveCodexNativeSession, type ResolveCodexDeps} from '../resolveCodexNativeSession'
import type {CodexThreadRow} from '../codex-thread-matcher'

const TERMINAL = 'Eva'
const VAULT = '/vault'
const TASK = '/vault/task.md'
const NOW = 1779424330000

function makeRow(overrides: Partial<CodexThreadRow> = {}): CodexThreadRow {
    return {
        id: 'thread-uuid-default',
        first_user_message: `header\nVOICETREE_TERMINAL_ID = ${TERMINAL} VOICETREE_VAULT_PATH = ${VAULT} TASK_NODE_PATH = ${TASK}`,
        cwd: VAULT,
        created_at_ms: NOW - 120_000,
        updated_at_ms: NOW - 60_000,
        rollout_path: '/Users/x/.codex/sessions/2026/05/22/rollout-default.jsonl',
        ...overrides,
    }
}

function makeDeps(rows: readonly CodexThreadRow[]): ResolveCodexDeps {
    return {
        listRecentThreads: () => rows,
        now: () => NOW,
    }
}

describe('resolveCodexNativeSession', () => {
    it('returns the thread id and rollout_path for a matching row', () => {
        const result = resolveCodexNativeSession(
            {terminalId: TERMINAL, projectRoot: VAULT, taskNodePath: TASK},
            makeDeps([makeRow({id: 'thread-A', rollout_path: '/rollouts/A.jsonl'})]),
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
            makeDeps([makeRow({id: 'thread-B', rollout_path: undefined})]),
        )
        expect(result).toEqual({kind: 'found', sessionId: 'thread-B'})
    })

    it('returns not-found when no row matches', () => {
        const result = resolveCodexNativeSession(
            {terminalId: TERMINAL, projectRoot: VAULT, taskNodePath: TASK},
            makeDeps([makeRow({first_user_message: 'no markers here'})]),
        )
        expect(result).toEqual({kind: 'not-found'})
    })

    it('returns not-found when the candidate list is empty', () => {
        const result = resolveCodexNativeSession(
            {terminalId: TERMINAL, projectRoot: VAULT, taskNodePath: TASK},
            makeDeps([]),
        )
        expect(result).toEqual({kind: 'not-found'})
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
                    return []
                },
                now: () => NOW,
            },
        )
        expect(capturedSince).toBe(NOW - 90_000)
        expect(capturedLimit).toBe(7)
    })
})
