import {describe, expect, it} from 'vitest'
import {classifyRecoveryCandidates} from '../classifier'
import {
    baseInput,
    FOREIGN_HASH,
    makeLiveSession,
    makeRunningClaudeMetadata,
    makeRunningCodexMetadata,
    makeTerminalData,
    METADATA_PATH_A,
    record,
    SESSION_A,
    TERMINAL_A,
    VAULT_HASH,
} from './classifier.test-fixtures'

// ---------------------------------------------------------------------------
// Drop precedence: foreign-vault and invalid trump capability detection.
// Other former "non-actionable" kinds (exited, claimed, unsupported-cli,
// missing-native-handle) are no longer drops — they surface as recoverable
// rows with `isClaimed` and/or capabilities populated accordingly.
// ---------------------------------------------------------------------------

describe('drop precedence', () => {
    it('drops as invalid even when the same terminal would otherwise be live', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record(null)],
            liveTmuxSessionsByName: new Map([[SESSION_A, makeLiveSession(SESSION_A)]]),
        }))
        expect(result.kind).toBe('dropped')
        if (result.kind === 'dropped') {
            expect(result.reason).toBe('invalid')
        }
    })

    it('drops as foreign-vault even when the foreign session is live in the local tmux', () => {
        const foreignSession: string = `vt-${FOREIGN_HASH}-${TERMINAL_A}`
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({
                name: TERMINAL_A,
                status: 'running',
                session: foreignSession,
                terminalData: makeTerminalData({initialCommand: 'claude'}),
            })],
            liveTmuxSessionsByName: new Map([[foreignSession, makeLiveSession(foreignSession)]]),
            currentNamespaceHash: VAULT_HASH,
        }))
        expect(result.kind).toBe('dropped')
        if (result.kind === 'dropped') {
            expect(result.reason).toBe('foreign-vault')
        }
    })

    it('still surfaces the record as recoverable when a claimed terminal is also live (isClaimed + attach)', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({
                name: TERMINAL_A,
                status: 'running',
                session: SESSION_A,
                terminalData: makeTerminalData({initialCommand: 'claude'}),
            })],
            liveTmuxSessionsByName: new Map([[SESSION_A, makeLiveSession(SESSION_A)]]),
            registryTerminalIds: new Set([TERMINAL_A]),
        }))
        expect(result.kind).toBe('recoverable')
        if (result.kind === 'recoverable') {
            expect(result.record.isClaimed).toBe(true)
            expect(result.record.attach).toBeDefined()
        }
    })
})

// ---------------------------------------------------------------------------
// Multiple records in a single call
// ---------------------------------------------------------------------------

describe('multiple records', () => {
    it('classifies each record independently', () => {
        const results = classifyRecoveryCandidates(baseInput({
            metadataRecords: [
                record(makeRunningClaudeMetadata(), METADATA_PATH_A),
                record(makeRunningCodexMetadata(), '/vault/.voicetree/terminals/B.json'),
                record(null, '/vault/.voicetree/terminals/bad.json'),
            ],
            resumeHandleByTerminalId: new Map([
                [TERMINAL_A, {cliType: 'claude'}],
                ['B', {cliType: 'codex'}],
            ]),
        }))
        expect(results).toHaveLength(3)
        expect(results[0].kind).toBe('recoverable')
        expect(results[1].kind).toBe('recoverable')
        expect(results[2].kind).toBe('dropped')
        if (results[0].kind === 'recoverable') expect(results[0].record.resume?.cliType).toBe('claude')
        if (results[1].kind === 'recoverable') expect(results[1].record.resume?.cliType).toBe('codex')
    })

    it('returns empty array for empty input', () => {
        const results = classifyRecoveryCandidates(baseInput())
        expect(results).toHaveLength(0)
    })

    it('mixes recoverable records and drops correctly', () => {
        const results = classifyRecoveryCandidates(baseInput({
            metadataRecords: [
                record(makeRunningClaudeMetadata(), '/vault/.voicetree/terminals/A.json'),
                record({name: 'C', status: 'exited', terminalData: makeTerminalData({terminalId: 'C' as ReturnType<typeof makeTerminalData>['terminalId'], initialCommand: 'claude'})}, '/vault/.voicetree/terminals/C.json'),
                record(makeRunningCodexMetadata(), '/vault/.voicetree/terminals/B.json'),
            ],
            resumeHandleByTerminalId: new Map([
                [TERMINAL_A, {cliType: 'claude'}],
                ['B', {cliType: 'codex'}],
            ]),
        }))
        expect(results.map(r => r.kind)).toEqual(['recoverable', 'recoverable', 'recoverable'])
    })
})
