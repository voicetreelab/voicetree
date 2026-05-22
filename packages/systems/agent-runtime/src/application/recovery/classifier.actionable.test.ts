import {describe, expect, it} from 'vitest'
import {classifyRecoveryCandidates} from './classifier'
import {
    baseInput,
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
// Scenario: Running record + alive tmux → attachable-live-tmux
// ---------------------------------------------------------------------------

describe('attachable-live-tmux', () => {
    it('returns attachable-live-tmux when session is in liveTmuxSessionNames', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record(makeRunningClaudeMetadata())],
            liveTmuxSessionNames: new Set([SESSION_A]),
        }))
        expect(result.kind).toBe('attachable-live-tmux')
        if (result.kind === 'attachable-live-tmux') {
            expect(result.terminalId).toBe(TERMINAL_A)
            expect(result.sessionName).toBe(SESSION_A)
            expect(result.metadataPath).toBe(METADATA_PATH_A)
        }
    })

    it('does not also return resumable for the same alive session — one classification only', () => {
        const results = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record(makeRunningClaudeMetadata())],
            liveTmuxSessionNames: new Set([SESSION_A]),
        }))
        expect(results).toHaveLength(1)
        expect(results[0].kind).toBe('attachable-live-tmux')
    })

    it('falls through to resumable when session is not alive', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record(makeRunningClaudeMetadata())],
            liveTmuxSessionNames: new Set(), // dead
        }))
        expect(result.kind).toBe('resumable-missing-tmux')
    })
})

// ---------------------------------------------------------------------------
// Scenario: Persisted running Claude record with missing tmux + recovery.native → resumable
// ---------------------------------------------------------------------------

describe('resumable-missing-tmux — Claude', () => {
    it('returns resumable-missing-tmux for Claude when tmux session is dead', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record(makeRunningClaudeMetadata())],
        }))
        expect(result.kind).toBe('resumable-missing-tmux')
        if (result.kind === 'resumable-missing-tmux') {
            expect(result.terminalId).toBe(TERMINAL_A)
            expect(result.cliType).toBe('claude')
            expect(result.nativeSessionId).toBe('sess-uuid-123')
            expect(result.agentName).toBe('Ari')
            expect(result.metadataPath).toBe(METADATA_PATH_A)
        }
    })

    it('includes terminalData in the resumable result', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record(makeRunningClaudeMetadata())],
        }))
        expect(result.kind).toBe('resumable-missing-tmux')
        if (result.kind === 'resumable-missing-tmux') {
            expect(result.terminalData.initialCommand).toBe('claude')
        }
    })

    it('detects Claude command even with env-var prefix', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record(makeRunningClaudeMetadata({
                terminalData: makeTerminalData({
                    initialCommand: 'CLAUDE_CODE_NO_FLICKER=1 claude --dangerously-skip-permissions',
                }),
            }))],
        }))
        expect(result.kind).toBe('resumable-missing-tmux')
        if (result.kind === 'resumable-missing-tmux') {
            expect(result.cliType).toBe('claude')
        }
    })
})

// ---------------------------------------------------------------------------
// Scenario: Persisted running Codex record with missing tmux + recovery.native → resumable
// ---------------------------------------------------------------------------

describe('resumable-missing-tmux — Codex', () => {
    it('returns resumable-missing-tmux for Codex when tmux session is dead', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record(makeRunningCodexMetadata())],
        }))
        expect(result.kind).toBe('resumable-missing-tmux')
        if (result.kind === 'resumable-missing-tmux') {
            expect(result.terminalId).toBe('B')
            expect(result.cliType).toBe('codex')
            expect(result.nativeSessionId).toBe('thread-uuid-456')
            expect(result.agentName).toBe('Bea')
        }
    })

    it('includes terminalData with correct command for Codex', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record(makeRunningCodexMetadata())],
        }))
        expect(result.kind).toBe('resumable-missing-tmux')
        if (result.kind === 'resumable-missing-tmux') {
            expect(result.terminalData.initialCommand).toBe('codex')
        }
    })
})

// ---------------------------------------------------------------------------
// Session name fallback: computed via buildTmuxSessionName when session field absent
// ---------------------------------------------------------------------------

describe('session name resolution from env vars', () => {
    it('classifies as attachable when session field absent but computed name matches live session', () => {
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
                recovery: {native: {cli: 'claude', mode: 'interactive', sessionId: 'x', capturedAt: '', source: 'claude-project-transcript'}},
            })],
            // The computed session name uses VOICETREE_VAULT_PATH to build the hash.
            // We pass the actual expected session name here so the live-session check matches.
            liveTmuxSessionNames: new Set([SESSION_A]),
            currentNamespaceHash: VAULT_HASH,
        }))
        expect(result.kind).toBe('attachable-live-tmux')
    })

    it('classifies as resumable when session field absent and computed name is not alive', () => {
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
                recovery: {native: {cli: 'claude', mode: 'interactive', sessionId: 'sid', capturedAt: '', source: 'claude-project-transcript'}},
            })],
            liveTmuxSessionNames: new Set(), // computed session is not alive
        }))
        expect(result.kind).toBe('resumable-missing-tmux')
    })
})
