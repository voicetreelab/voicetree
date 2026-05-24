import {describe, expect, it} from 'vitest'
import {matchCodexThreadId, type CodexThreadRow} from '../codex-thread-matcher'

const TERMINAL = 'Eva'
const VAULT = '/Users/bobbobby/repos/voicetree-public/voicetree-22-5'
const TASK = '/Users/bobbobby/repos/voicetree-public/voicetree-22-5/task.md'

function makeRow(overrides: Partial<CodexThreadRow> = {}): CodexThreadRow {
    return {
        id: '019e4ded-d566-7d52-b443-4610669da39e',
        first_user_message: `prompt\nVOICETREE_TERMINAL_ID = ${TERMINAL} VOICETREE_VAULT_PATH = ${VAULT} TASK_NODE_PATH = ${TASK}`,
        cwd: VAULT,
        created_at_ms: 1779424330000,
        updated_at_ms: 1779424340000,
        rollout_path: '/Users/bobbobby/.codex/sessions/2026/05/22/rollout-XYZ.jsonl',
        ...overrides,
    }
}

describe('matchCodexThreadId — happy path', () => {
    it('returns the matching row id when all three markers are present', () => {
        const result: string | null = matchCodexThreadId({
            rows: [makeRow()],
            terminalId: TERMINAL, projectRoot: VAULT, taskNodePath: TASK,
        })
        expect(result).toBe('019e4ded-d566-7d52-b443-4610669da39e')
    })

    it('returns the first matching row when duplicates exist', () => {
        const result: string | null = matchCodexThreadId({
            rows: [makeRow({id: 'first'}), makeRow({id: 'second'})],
            terminalId: TERMINAL, projectRoot: VAULT, taskNodePath: TASK,
        })
        expect(result).toBe('first')
    })

    it('matches even when the row timestamps are very old (recency is not the matcher\'s concern)', () => {
        const result: string | null = matchCodexThreadId({
            rows: [makeRow({created_at_ms: 0, updated_at_ms: 0})],
            terminalId: TERMINAL, projectRoot: VAULT, taskNodePath: TASK,
        })
        expect(result).not.toBeNull()
    })
})

describe('matchCodexThreadId — non-match cases', () => {
    it('returns null on empty input', () => {
        expect(matchCodexThreadId({rows: [], terminalId: TERMINAL, projectRoot: VAULT, taskNodePath: TASK})).toBeNull()
    })

    it('returns null when the vault marker differs (reused terminal name in another vault)', () => {
        expect(matchCodexThreadId({
            rows: [makeRow({first_user_message: `VOICETREE_TERMINAL_ID = ${TERMINAL} VOICETREE_VAULT_PATH = /other VAULT TASK_NODE_PATH = ${TASK}`})],
            terminalId: TERMINAL, projectRoot: VAULT, taskNodePath: TASK,
        })).toBeNull()
    })

    it('returns null when the task path marker differs', () => {
        expect(matchCodexThreadId({
            rows: [makeRow({first_user_message: `VOICETREE_TERMINAL_ID = ${TERMINAL} VOICETREE_VAULT_PATH = ${VAULT} TASK_NODE_PATH = /other.md`})],
            terminalId: TERMINAL, projectRoot: VAULT, taskNodePath: TASK,
        })).toBeNull()
    })
})

describe('matchCodexThreadId — defensive parsing', () => {
    it('skips rows with no first_user_message but still returns later valid matches', () => {
        const incomplete: CodexThreadRow = {id: 'no-msg', cwd: VAULT}
        const result: string | null = matchCodexThreadId({
            rows: [incomplete, makeRow({id: 'has-msg'})],
            terminalId: TERMINAL, projectRoot: VAULT, taskNodePath: TASK,
        })
        expect(result).toBe('has-msg')
    })

    it('returns null when the matching row has an empty id', () => {
        const empty: CodexThreadRow = makeRow({id: ''})
        expect(matchCodexThreadId({
            rows: [empty],
            terminalId: TERMINAL, projectRoot: VAULT, taskNodePath: TASK,
        })).toBeNull()
    })
})
