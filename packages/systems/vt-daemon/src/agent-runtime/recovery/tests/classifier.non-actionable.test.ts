import {describe, expect, it} from 'vitest'
import {classifyRecoveryCandidates} from '../classifier'
import {
    baseInput,
    FOREIGN_HASH,
    makeTerminalData,
    METADATA_PATH_A,
    record,
    SESSION_A,
    TERMINAL_A,
    PROJECT_HASH,
} from './classifier.test-fixtures'

// ---------------------------------------------------------------------------
// Invalid metadata is dropped (the classifier no longer crashes on garbage)
// ---------------------------------------------------------------------------

describe('invalid metadata', () => {
    it('drops null', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record(null)],
        }))
        expect(result.kind).toBe('dropped')
        if (result.kind === 'dropped') {
            expect(result.reason).toBe('invalid')
            expect(result.metadataPath).toBe(METADATA_PATH_A)
        }
    })

    it('drops a non-object', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record('not-an-object')],
        }))
        expect(result.kind).toBe('dropped')
    })

    it('drops records missing a name', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({status: 'running'})],
        }))
        expect(result.kind).toBe('dropped')
    })

    it('drops records missing a status', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({name: TERMINAL_A})],
        }))
        expect(result.kind).toBe('dropped')
    })

    it('drops records with an unknown status string', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({name: TERMINAL_A, status: 'pending'})],
        }))
        expect(result.kind).toBe('dropped')
    })

    it('drops records with no terminalData (UI cannot render anything useful)', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({name: TERMINAL_A, status: 'running', session: SESSION_A})],
        }))
        expect(result.kind).toBe('dropped')
        if (result.kind === 'dropped') {
            expect(result.reason).toBe('invalid')
        }
    })
})

// ---------------------------------------------------------------------------
// Status = 'exited' is no longer a filter — the record surfaces as recoverable
// (a Resume capability is still possible if a handle was supplied; absent
// both capabilities the row carries enough metadata for "this is a terminal
// I once knew" without an action).
// ---------------------------------------------------------------------------

describe('exited metadata', () => {
    it('surfaces an exited record as recoverable (no filter on status)', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({
                name: TERMINAL_A,
                status: 'exited',
                session: SESSION_A,
                terminalData: makeTerminalData({initialCommand: 'claude'}),
            })],
        }))
        expect(result.kind).toBe('recoverable')
        if (result.kind === 'recoverable') {
            expect(result.record.terminalId).toBe(TERMINAL_A)
            expect(result.record.attach).toBeUndefined()
            expect(result.record.resume).toBeUndefined()
        }
    })
})

// ---------------------------------------------------------------------------
// `claimed` (terminal id is in the in-memory registry) is no longer a filter.
// The record surfaces with `isClaimed: true` so the UI can route it to the
// regular tab strip (fork-on-hover) rather than the Surviving Agents section.
// ---------------------------------------------------------------------------

describe('claimed terminal', () => {
    it('exposes isClaimed=true when terminal id is in the registry', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({
                name: TERMINAL_A,
                status: 'running',
                session: SESSION_A,
                terminalData: makeTerminalData({initialCommand: 'claude'}),
            })],
            registryTerminalIds: new Set([TERMINAL_A]),
        }))
        expect(result.kind).toBe('recoverable')
        if (result.kind === 'recoverable') {
            expect(result.record.isClaimed).toBe(true)
        }
    })

    it('exposes isClaimed=false when a different terminal is registered', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({
                name: TERMINAL_A,
                status: 'running',
                session: SESSION_A,
                terminalData: makeTerminalData({initialCommand: 'claude'}),
            })],
            registryTerminalIds: new Set(['OtherTerminal']),
        }))
        expect(result.kind).toBe('recoverable')
        if (result.kind === 'recoverable') {
            expect(result.record.isClaimed).toBe(false)
        }
    })
})

// ---------------------------------------------------------------------------
// Foreign-project namespace hash → dropped (we don't surface records that don't
// belong to the current project).
// ---------------------------------------------------------------------------

describe('foreign-project', () => {
    it('drops records when session hash differs from current namespace hash', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({
                name: TERMINAL_A,
                status: 'running',
                session: `vt-${FOREIGN_HASH}-${TERMINAL_A}`,
                terminalData: makeTerminalData({initialCommand: 'claude'}),
            })],
            currentNamespaceHash: PROJECT_HASH,
        }))
        expect(result.kind).toBe('dropped')
        if (result.kind === 'dropped') {
            expect(result.reason).toBe('foreign-project')
        }
    })

    it('does not drop as foreign-project when currentNamespaceHash is null', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({
                name: TERMINAL_A,
                status: 'running',
                session: `vt-${FOREIGN_HASH}-${TERMINAL_A}`,
                terminalData: makeTerminalData({initialCommand: 'claude'}),
            })],
            currentNamespaceHash: null,
        }))
        expect(result.kind).toBe('recoverable')
    })
})

// ---------------------------------------------------------------------------
// Unsupported CLIs (gemini, custom scripts) and missing handles no longer get
// their own classification — they just lack a `resume` capability. The
// classifier still surfaces the row (it may be attachable via tmux).
// ---------------------------------------------------------------------------

describe('records without a resume capability', () => {
    it('surfaces a gemini record without resume capability', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({
                name: TERMINAL_A,
                status: 'running',
                session: SESSION_A,
                terminalData: makeTerminalData({initialCommand: 'gemini'}),
            })],
        }))
        expect(result.kind).toBe('recoverable')
        if (result.kind === 'recoverable') {
            expect(result.record.resume).toBeUndefined()
        }
    })

    it('surfaces a custom-script record without resume capability', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({
                name: TERMINAL_A,
                status: 'running',
                session: SESSION_A,
                terminalData: makeTerminalData({initialCommand: './my-script.sh --some-flag'}),
            })],
        }))
        expect(result.kind).toBe('recoverable')
        if (result.kind === 'recoverable') {
            expect(result.record.resume).toBeUndefined()
        }
    })

    it('surfaces a claude record without resume capability when no handle is supplied', () => {
        const [result] = classifyRecoveryCandidates(baseInput({
            metadataRecords: [record({
                name: TERMINAL_A,
                status: 'running',
                session: SESSION_A,
                terminalData: makeTerminalData({initialCommand: 'claude'}),
            })],
        }))
        expect(result.kind).toBe('recoverable')
        if (result.kind === 'recoverable') {
            expect(result.record.resume).toBeUndefined()
        }
    })
})
