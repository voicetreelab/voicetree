import {describe, expect, it} from 'vitest'
import {classifyRecoveryCandidates} from './classifier'
import {
    baseInput,
    FOREIGN_HASH,
    makeTerminalData,
    METADATA_PATH_A,
    record,
    SESSION_A,
    TERMINAL_A,
    VAULT_HASH,
} from './classifier.test-fixtures'

// ---------------------------------------------------------------------------
// Scenario: Parse-invalid record → invalid (do not crash)
// ---------------------------------------------------------------------------

describe('invalid metadata', () => {
    it('returns invalid for null', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record(null)],
        }))
        expect(result.kind).toBe('invalid')
        expect(result.metadataPath).toBe(METADATA_PATH_A)
    })

    it('returns invalid for a non-object', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record('not-an-object')],
        }))
        expect(result.kind).toBe('invalid')
    })

    it('returns invalid when name is missing', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({status: 'running'})],
        }))
        expect(result.kind).toBe('invalid')
    })

    it('returns invalid when status is missing', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({name: TERMINAL_A})],
        }))
        expect(result.kind).toBe('invalid')
    })

    it('returns invalid when status is an unknown string', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({name: TERMINAL_A, status: 'pending'})],
        }))
        expect(result.kind).toBe('invalid')
    })
})

// ---------------------------------------------------------------------------
// Scenario: status:"exited" → exited (non-actionable)
// ---------------------------------------------------------------------------

describe('exited metadata', () => {
    it('returns exited for status:exited regardless of tmux state', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({name: TERMINAL_A, status: 'exited'})],
            liveTmuxSessionNames: new Set([SESSION_A]),
        }))
        expect(result.kind).toBe('exited')
        if (result.kind === 'exited') {
            expect(result.terminalId).toBe(TERMINAL_A)
        }
    })
})

// ---------------------------------------------------------------------------
// Scenario: Already in registry → not duplicated (claimed)
// ---------------------------------------------------------------------------

describe('claimed terminal', () => {
    it('returns claimed when terminal id is in the registry', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({name: TERMINAL_A, status: 'running', session: SESSION_A})],
            registryTerminalIds: new Set([TERMINAL_A]),
        }))
        expect(result.kind).toBe('claimed')
        if (result.kind === 'claimed') {
            expect(result.terminalId).toBe(TERMINAL_A)
        }
    })

    it('does not classify as claimed when a different terminal is registered', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({name: TERMINAL_A, status: 'running', session: SESSION_A})],
            registryTerminalIds: new Set(['OtherTerminal']),
        }))
        expect(result.kind).not.toBe('claimed')
    })
})

// ---------------------------------------------------------------------------
// Scenario: Foreign-vault namespace hash → foreign-vault
// ---------------------------------------------------------------------------

describe('foreign-vault', () => {
    it('returns foreign-vault when session hash differs from current namespace hash', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({
                name: TERMINAL_A,
                status: 'running',
                session: `vt-${FOREIGN_HASH}-${TERMINAL_A}`,
            })],
            currentNamespaceHash: VAULT_HASH,
        }))
        expect(result.kind).toBe('foreign-vault')
        if (result.kind === 'foreign-vault') {
            expect(result.terminalId).toBe(TERMINAL_A)
        }
    })

    it('does not classify as foreign-vault when currentNamespaceHash is null', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({
                name: TERMINAL_A,
                status: 'running',
                session: `vt-${FOREIGN_HASH}-${TERMINAL_A}`,
                terminalData: makeTerminalData({initialCommand: 'claude'}),
                recovery: {native: {cli: 'claude', mode: 'interactive', sessionId: 'x', capturedAt: '', source: 'claude-project-transcript'}},
            })],
            currentNamespaceHash: null,
        }))
        expect(result.kind).not.toBe('foreign-vault')
    })
})

// ---------------------------------------------------------------------------
// Scenario: Unsupported CLI → unsupported-cli (non-actionable)
// ---------------------------------------------------------------------------

describe('unsupported-cli', () => {
    it('returns unsupported-cli for gemini command', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({
                name: TERMINAL_A,
                status: 'running',
                session: SESSION_A,
                terminalData: makeTerminalData({initialCommand: 'gemini'}),
            })],
        }))
        expect(result.kind).toBe('unsupported-cli')
    })

    it('returns unsupported-cli when terminalData is absent', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({name: TERMINAL_A, status: 'running', session: SESSION_A})],
        }))
        expect(result.kind).toBe('unsupported-cli')
    })

    it('returns unsupported-cli when initialCommand is absent', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({
                name: TERMINAL_A,
                status: 'running',
                session: SESSION_A,
                terminalData: makeTerminalData({initialCommand: undefined}),
            })],
        }))
        expect(result.kind).toBe('unsupported-cli')
    })

    it('returns unsupported-cli for a custom script command', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({
                name: TERMINAL_A,
                status: 'running',
                session: SESSION_A,
                terminalData: makeTerminalData({initialCommand: './my-script.sh --some-flag'}),
            })],
        }))
        expect(result.kind).toBe('unsupported-cli')
    })
})

// ---------------------------------------------------------------------------
// Scenario: Missing recovery.native → missing-native-handle (non-actionable)
// ---------------------------------------------------------------------------

describe('missing-native-handle', () => {
    it('returns missing-native-handle when recovery block is absent', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({
                name: TERMINAL_A,
                status: 'running',
                session: SESSION_A,
                terminalData: makeTerminalData({initialCommand: 'claude'}),
            })],
        }))
        expect(result.kind).toBe('missing-native-handle')
        if (result.kind === 'missing-native-handle') {
            expect(result.terminalId).toBe(TERMINAL_A)
        }
    })

    it('returns missing-native-handle when recovery.native is absent', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({
                name: TERMINAL_A,
                status: 'running',
                session: SESSION_A,
                terminalData: makeTerminalData({initialCommand: 'codex'}),
                recovery: {},
            })],
        }))
        expect(result.kind).toBe('missing-native-handle')
    })

    it('returns missing-native-handle when sessionId is absent from recovery.native', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({
                name: TERMINAL_A,
                status: 'running',
                session: SESSION_A,
                terminalData: makeTerminalData({initialCommand: 'claude'}),
                recovery: {native: {cli: 'claude', mode: 'interactive', capturedAt: '', source: 'claude-project-transcript'}},
            })],
        }))
        expect(result.kind).toBe('missing-native-handle')
    })
})
