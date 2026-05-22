import {describe, expect, it} from 'vitest'
import {classifyRecoveryCandidates} from './classifier'
import {
    baseInput,
    FOREIGN_HASH,
    makeRunningClaudeMetadata,
    makeRunningCodexMetadata,
    METADATA_PATH_A,
    record,
    SESSION_A,
    TERMINAL_A,
    VAULT_HASH,
} from './classifier.test-fixtures'

// ---------------------------------------------------------------------------
// Classification priority: earlier checks take precedence
// ---------------------------------------------------------------------------

describe('classification priority ordering', () => {
    it('classifies as exited even if terminal is also in registry', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({name: TERMINAL_A, status: 'exited'})],
            registryTerminalIds: new Set([TERMINAL_A]),
        }))
        expect(result.kind).toBe('exited')
    })

    it('classifies as claimed before checking foreign-vault', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({
                name: TERMINAL_A,
                status: 'running',
                session: `vt-${FOREIGN_HASH}-${TERMINAL_A}`,
            })],
            registryTerminalIds: new Set([TERMINAL_A]),
            currentNamespaceHash: VAULT_HASH,
        }))
        expect(result.kind).toBe('claimed')
    })

    it('classifies as foreign-vault before checking live tmux', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({
                name: TERMINAL_A,
                status: 'running',
                session: `vt-${FOREIGN_HASH}-${TERMINAL_A}`,
            })],
            liveTmuxSessionNames: new Set([`vt-${FOREIGN_HASH}-${TERMINAL_A}`]),
            currentNamespaceHash: VAULT_HASH,
        }))
        expect(result.kind).toBe('foreign-vault')
    })

    it('classifies as attachable-live-tmux before checking CLI support', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({
                name: TERMINAL_A,
                status: 'running',
                session: SESSION_A,
                // no terminalData → would normally be unsupported-cli
            })],
            liveTmuxSessionNames: new Set([SESSION_A]),
        }))
        expect(result.kind).toBe('attachable-live-tmux')
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
        }))
        expect(results).toHaveLength(3)
        expect(results[0].kind).toBe('resumable-missing-tmux')
        expect(results[1].kind).toBe('resumable-missing-tmux')
        expect(results[2].kind).toBe('invalid')
    })

    it('returns empty array for empty input', () => {
        const results = classifyRecoveryCandidates(baseInput())
        expect(results).toHaveLength(0)
    })

    it('mixes actionable and non-actionable correctly', () => {
        const results = classifyRecoveryCandidates(baseInput({
            metadataRecords: [
                record(makeRunningClaudeMetadata(), '/vault/.voicetree/terminals/A.json'),
                record({name: 'C', status: 'exited'}, '/vault/.voicetree/terminals/C.json'),
                record(makeRunningCodexMetadata(), '/vault/.voicetree/terminals/B.json'),
            ],
        }))
        expect(results.map(r => r.kind)).toEqual([
            'resumable-missing-tmux',
            'exited',
            'resumable-missing-tmux',
        ])
    })
})
