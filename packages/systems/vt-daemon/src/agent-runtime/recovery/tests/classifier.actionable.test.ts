import {describe, expect, it} from 'vitest'
import {classifyRecoveryCandidates} from '../classifier'
import type {ResumeCapability} from '../types'
import {
    baseInput,
    makeLiveSession,
    makeRunningClaudeMetadata,
    makeRunningCodexMetadata,
    makeTerminalData,
    METADATA_PATH_A,
    record,
    SESSION_A,
    TERMINAL_A,
    VAULT_HASH,
    VAULT_PATH,
} from './classifier.test-fixtures'

// ---------------------------------------------------------------------------
// Scenario: Running record + alive tmux → attach capability present
// ---------------------------------------------------------------------------

describe('attach capability', () => {
    it('exposes attach when session is in liveTmuxSessionsByName', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record(makeRunningClaudeMetadata())],
            liveTmuxSessionsByName: new Map([[SESSION_A, makeLiveSession(SESSION_A)]]),
        }))
        expect(result.kind).toBe('recoverable')
        if (result.kind === 'recoverable') {
            expect(result.record.terminalId).toBe(TERMINAL_A)
            expect(result.record.attach?.session.sessionName).toBe(SESSION_A)
            expect(result.record.metadataPath).toBe(METADATA_PATH_A)
        }
    })

    it('exposes BOTH attach AND resume when session is alive AND a resume handle is present (fork-while-running)', () => {
        const resumeHandle: ResumeCapability = {cliType: 'claude'}
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record(makeRunningClaudeMetadata())],
            liveTmuxSessionsByName: new Map([[SESSION_A, makeLiveSession(SESSION_A)]]),
            resumeHandleByTerminalId: new Map([[TERMINAL_A, resumeHandle]]),
        }))
        expect(result.kind).toBe('recoverable')
        if (result.kind === 'recoverable') {
            expect(result.record.attach).toBeDefined()
            expect(result.record.resume).toEqual(resumeHandle)
        }
    })

    it('falls through to resume-only when session is dead but resume handle is present', () => {
        const resumeHandle: ResumeCapability = {cliType: 'claude'}
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record(makeRunningClaudeMetadata())],
            resumeHandleByTerminalId: new Map([[TERMINAL_A, resumeHandle]]),
        }))
        expect(result.kind).toBe('recoverable')
        if (result.kind === 'recoverable') {
            expect(result.record.attach).toBeUndefined()
            expect(result.record.resume).toEqual(resumeHandle)
        }
    })
})

// ---------------------------------------------------------------------------
// Scenario: Resume handle present for Claude / Codex
// ---------------------------------------------------------------------------

describe('resume capability — Claude', () => {
    it('exposes resume when a Claude handle is in resumeHandleByTerminalId', () => {
        const resumeHandle: ResumeCapability = {cliType: 'claude'}
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record(makeRunningClaudeMetadata())],
            resumeHandleByTerminalId: new Map([[TERMINAL_A, resumeHandle]]),
        }))
        expect(result.kind).toBe('recoverable')
        if (result.kind === 'recoverable') {
            expect(result.record.terminalId).toBe(TERMINAL_A)
            expect(result.record.resume?.cliType).toBe('claude')
            expect(result.record.agentName).toBe('Ari')
            expect(result.record.metadataPath).toBe(METADATA_PATH_A)
        }
    })

    it('includes terminalData in the recoverable record', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record(makeRunningClaudeMetadata())],
            resumeHandleByTerminalId: new Map([[TERMINAL_A, {cliType: 'claude'}]]),
        }))
        expect(result.kind).toBe('recoverable')
        if (result.kind === 'recoverable') {
            expect(result.record.terminalData.initialCommand).toBe('claude')
        }
    })

    it('still surfaces the row when initialCommand carries an env-var prefix (resolver job is upstream)', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record(makeRunningClaudeMetadata({
                terminalData: makeTerminalData({
                    initialCommand: 'CLAUDE_CODE_NO_FLICKER=1 claude --dangerously-skip-permissions',
                }),
            }))],
            resumeHandleByTerminalId: new Map([[TERMINAL_A, {cliType: 'claude'}]]),
        }))
        expect(result.kind).toBe('recoverable')
        if (result.kind === 'recoverable') {
            expect(result.record.resume?.cliType).toBe('claude')
        }
    })
})

describe('resume capability — Codex', () => {
    it('exposes resume when a Codex handle is in resumeHandleByTerminalId', () => {
        const resumeHandle: ResumeCapability = {cliType: 'codex'}
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record(makeRunningCodexMetadata())],
            resumeHandleByTerminalId: new Map([['B', resumeHandle]]),
        }))
        expect(result.kind).toBe('recoverable')
        if (result.kind === 'recoverable') {
            expect(result.record.terminalId).toBe('B')
            expect(result.record.resume?.cliType).toBe('codex')
            expect(result.record.agentName).toBe('Bea')
        }
    })
})

// ---------------------------------------------------------------------------
// Session name fallback: computed via buildTmuxSessionName when session field absent
// ---------------------------------------------------------------------------

describe('session name resolution from env vars', () => {
    it('exposes attach when session field absent but computed name matches live session', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({
                name: TERMINAL_A,
                status: 'running',
                // no explicit session field
                terminalData: makeTerminalData({
                    initialCommand: 'claude',
                    initialEnvVars: {
                        VOICETREE_TERMINAL_ID: TERMINAL_A,
                        VOICETREE_VAULT_PATH: VAULT_PATH,
                    },
                }),
            })],
            liveTmuxSessionsByName: new Map([[SESSION_A, makeLiveSession(SESSION_A)]]),
            currentNamespaceHash: VAULT_HASH,
        }))
        expect(result.kind).toBe('recoverable')
        if (result.kind === 'recoverable') {
            expect(result.record.attach?.session.sessionName).toBe(SESSION_A)
        }
    })

    it('exposes resume-only when session field absent, computed name is dead, and a resume handle is supplied', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({
                name: TERMINAL_A,
                status: 'running',
                terminalData: makeTerminalData({
                    initialCommand: 'claude',
                    initialEnvVars: {
                        VOICETREE_TERMINAL_ID: TERMINAL_A,
                        VOICETREE_VAULT_PATH: VAULT_PATH,
                    },
                }),
            })],
            resumeHandleByTerminalId: new Map([[TERMINAL_A, {cliType: 'claude'}]]),
        }))
        expect(result.kind).toBe('recoverable')
        if (result.kind === 'recoverable') {
            expect(result.record.attach).toBeUndefined()
            expect(result.record.resume?.cliType).toBe('claude')
        }
    })
})
