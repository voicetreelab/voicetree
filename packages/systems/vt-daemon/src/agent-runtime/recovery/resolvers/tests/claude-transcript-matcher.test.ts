import {describe, expect, it} from 'vitest'
import {matchClaudeSessionId, type ClaudeTranscriptRecord} from '../claude-transcript-matcher'

const TERMINAL = 'Ari'
const PROJECT = '/Users/example/repos/voicetree-public/voicetree-22-5'
const TASK = '/Users/example/repos/voicetree-public/voicetree-22-5/task.md'

function userRecord(content: string | ReadonlyArray<{type?: string; text?: string}>, sessionId = 'sess-claude-abc'): ClaudeTranscriptRecord {
    return {
        sessionId,
        type: 'user',
        message: {role: 'user', content},
    }
}

function markers(terminal = TERMINAL, project = PROJECT, task = TASK): string {
    return `VOICETREE_TERMINAL_ID = ${terminal} VOICETREE_PROJECT_PATH = ${project} TASK_NODE_PATH = ${task}`
}

describe('matchClaudeSessionId — happy path', () => {
    it('matches a string-content user record with all three markers', () => {
        const result: string | null = matchClaudeSessionId({
            records: [userRecord(`prompt text\n${markers()}\nmore text`, 'sess-1')],
            terminalId: TERMINAL, projectRoot: PROJECT, taskNodePath: TASK,
        })
        expect(result).toBe('sess-1')
    })

    it('matches an array-content user record by concatenating block.text values', () => {
        const blocks: ReadonlyArray<{type: string; text: string}> = [
            {type: 'text', text: 'leading'},
            {type: 'text', text: markers()},
            {type: 'text', text: 'trailing'},
        ]
        const result: string | null = matchClaudeSessionId({
            records: [userRecord(blocks, 'sess-blocks')],
            terminalId: TERMINAL, projectRoot: PROJECT, taskNodePath: TASK,
        })
        expect(result).toBe('sess-blocks')
    })

    it('returns the first matching record when multiple candidates exist', () => {
        const result: string | null = matchClaudeSessionId({
            records: [userRecord(markers(), 'sess-first'), userRecord(markers(), 'sess-second')],
            terminalId: TERMINAL, projectRoot: PROJECT, taskNodePath: TASK,
        })
        expect(result).toBe('sess-first')
    })
})

describe('matchClaudeSessionId — non-match cases', () => {
    it('returns null for empty input', () => {
        expect(matchClaudeSessionId({records: [], terminalId: TERMINAL, projectRoot: PROJECT, taskNodePath: TASK})).toBeNull()
    })

    it('returns null when only terminal+project markers are present (missing task)', () => {
        const partial: string = `VOICETREE_TERMINAL_ID = ${TERMINAL}\nVOICETREE_PROJECT_PATH = ${PROJECT}\n`
        expect(matchClaudeSessionId({
            records: [userRecord(partial)],
            terminalId: TERMINAL, projectRoot: PROJECT, taskNodePath: TASK,
        })).toBeNull()
    })

    it('returns null when the project path differs (reused terminal name in a different project)', () => {
        expect(matchClaudeSessionId({
            records: [userRecord(markers(TERMINAL, '/other/project', TASK))],
            terminalId: TERMINAL, projectRoot: PROJECT, taskNodePath: TASK,
        })).toBeNull()
    })

    it('returns null when the task node path differs', () => {
        expect(matchClaudeSessionId({
            records: [userRecord(markers(TERMINAL, PROJECT, '/other/task.md'))],
            terminalId: TERMINAL, projectRoot: PROJECT, taskNodePath: TASK,
        })).toBeNull()
    })
})

describe('matchClaudeSessionId — defensive parsing', () => {
    it('does not throw on records with no message at all', () => {
        const malformed: ClaudeTranscriptRecord = {sessionId: 'sess-bare'}
        expect(matchClaudeSessionId({
            records: [malformed, userRecord(markers(), 'sess-good')],
            terminalId: TERMINAL, projectRoot: PROJECT, taskNodePath: TASK,
        })).toBe('sess-good')
    })

    it('skips array content with no text blocks', () => {
        const blocks: ReadonlyArray<{type: string}> = [{type: 'image'}, {type: 'tool_use'}]
        expect(matchClaudeSessionId({
            records: [userRecord(blocks, 'sess-empty'), userRecord(markers(), 'sess-good')],
            terminalId: TERMINAL, projectRoot: PROJECT, taskNodePath: TASK,
        })).toBe('sess-good')
    })

    it('skips records whose message.content is null', () => {
        const record: ClaudeTranscriptRecord = {sessionId: 'sess-null', message: {role: 'user', content: undefined}}
        expect(matchClaudeSessionId({
            records: [record, userRecord(markers(), 'sess-good')],
            terminalId: TERMINAL, projectRoot: PROJECT, taskNodePath: TASK,
        })).toBe('sess-good')
    })

    it('returns null when the matching record has no sessionId field', () => {
        const noSession: ClaudeTranscriptRecord = {message: {role: 'user', content: markers()}}
        expect(matchClaudeSessionId({
            records: [noSession],
            terminalId: TERMINAL, projectRoot: PROJECT, taskNodePath: TASK,
        })).toBeNull()
    })
})
