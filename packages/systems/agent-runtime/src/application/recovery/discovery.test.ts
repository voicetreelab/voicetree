import {describe, expect, it} from 'vitest'
import {discoverRecoverableAgentSessions, type DiscoverRecoveryDeps} from './discovery'
import type {MetadataRecord} from './classifier'
import type {RecoverableAgentSession} from './types'
import type {UnclaimedTmuxSession} from '../terminals/tmux/unclaimed-tmux'
import {
    baseInput as _ignored,  // imported only to ensure shared fixture module compiles together
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

void _ignored

const FOREIGN_HASH = 'f6e7d8c9b0'

function makeDeps(overrides: Partial<DiscoverRecoveryDeps> = {}): DiscoverRecoveryDeps {
    return {
        readVaultMetadataDir: async () => [],
        listLiveTmuxSessionNames: async () => new Set<string>(),
        listLiveUnclaimedTmuxSessions: async () => [],
        getRegistryTerminalIds: () => new Set<string>(),
        getCurrentNamespaceHash: async () => VAULT_HASH,
        ...overrides,
    }
}

function makeUnclaimed(overrides: Partial<UnclaimedTmuxSession> = {}): UnclaimedTmuxSession {
    return {
        sessionName: SESSION_A,
        terminalId: TERMINAL_A,
        hash: VAULT_HASH,
        classification: 'this-vault',
        attachable: true,
        createdAt: 1_700_000_000_000,
        panePid: 1234,
        agentName: 'Ari',
        vaultPath: VAULT_PATH,
        contextNodePath: '/vault/node.md',
        taskNodePath: '/vault/task.md',
        ...overrides,
    }
}

function metadataRecord(data: unknown, path = METADATA_PATH_A): MetadataRecord {
    return record(data, path)
}

// ---------------------------------------------------------------------------
// Scenario: Persisted running Claude record with missing tmux pane is resumable
// ---------------------------------------------------------------------------

describe('discoverRecoverableAgentSessions — resumable rows', () => {
    it('returns a resumable-cli row for Claude metadata with dead tmux and recovery.native', async () => {
        const rows = await discoverRecoverableAgentSessions(
            makeDeps({readVaultMetadataDir: async () => [metadataRecord(makeRunningClaudeMetadata())]}),
        )
        expect(rows).toHaveLength(1)
        const row: RecoverableAgentSession = rows[0]
        expect(row.kind).toBe('resumable-cli')
        if (row.kind === 'resumable-cli') {
            expect(row.terminalId).toBe(TERMINAL_A)
            expect(row.agentName).toBe('Ari')
            expect(row.cliType).toBe('claude')
            expect(row.metadataPath).toBe(METADATA_PATH_A)
            expect(row.nativeSessionId).toBe('sess-uuid-123')
            expect(row.reason).toBe('missing-tmux-session')
            expect(row.terminalData.initialCommand).toBe('claude')
        }
    })

    it('returns a resumable-cli row for Codex metadata with dead tmux and recovery.native', async () => {
        const rows = await discoverRecoverableAgentSessions(
            makeDeps({readVaultMetadataDir: async () => [metadataRecord(makeRunningCodexMetadata(), '/vault/.voicetree/terminals/B.json')]}),
        )
        expect(rows).toHaveLength(1)
        const row: RecoverableAgentSession = rows[0]
        expect(row.kind).toBe('resumable-cli')
        if (row.kind === 'resumable-cli') {
            expect(row.terminalId).toBe('B')
            expect(row.cliType).toBe('codex')
            expect(row.nativeSessionId).toBe('thread-uuid-456')
            expect(row.terminalData.initialCommand).toBe('codex')
        }
    })
})

// ---------------------------------------------------------------------------
// Scenario: Live unclaimed tmux pane remains an attach action
// ---------------------------------------------------------------------------

describe('discoverRecoverableAgentSessions — attachable rows', () => {
    it('returns an attachable-tmux row when the tmux session is alive and matches an unclaimed listing', async () => {
        const unclaimed: UnclaimedTmuxSession = makeUnclaimed()
        const rows = await discoverRecoverableAgentSessions(
            makeDeps({
                readVaultMetadataDir: async () => [metadataRecord(makeRunningClaudeMetadata())],
                listLiveTmuxSessionNames: async () => new Set([SESSION_A]),
                listLiveUnclaimedTmuxSessions: async () => [unclaimed],
            }),
        )
        expect(rows).toHaveLength(1)
        const row: RecoverableAgentSession = rows[0]
        expect(row.kind).toBe('attachable-tmux')
        if (row.kind === 'attachable-tmux') {
            expect(row.session).toBe(unclaimed)
        }
    })

    it('does not produce a duplicate resumable-cli row for an attachable terminal id', async () => {
        const unclaimed: UnclaimedTmuxSession = makeUnclaimed()
        const rows = await discoverRecoverableAgentSessions(
            makeDeps({
                readVaultMetadataDir: async () => [metadataRecord(makeRunningClaudeMetadata())],
                listLiveTmuxSessionNames: async () => new Set([SESSION_A]),
                listLiveUnclaimedTmuxSessions: async () => [unclaimed],
            }),
        )
        expect(rows.filter((r) => r.kind === 'resumable-cli')).toHaveLength(0)
    })

    it('surfaces a live unclaimed tmux session that has no matching metadata file (preserves pre-OpenSpec attach behavior)', async () => {
        const orphan: UnclaimedTmuxSession = makeUnclaimed({
            sessionName: `vt-${VAULT_HASH}-Orphan`,
            terminalId: 'Orphan',
            agentName: 'Orphan',
        })
        const rows = await discoverRecoverableAgentSessions(
            makeDeps({
                readVaultMetadataDir: async () => [],   // no metadata at all
                listLiveTmuxSessionNames: async () => new Set([orphan.sessionName]),
                listLiveUnclaimedTmuxSessions: async () => [orphan],
            }),
        )
        expect(rows).toHaveLength(1)
        const row: RecoverableAgentSession = rows[0]
        expect(row.kind).toBe('attachable-tmux')
        if (row.kind === 'attachable-tmux') {
            expect(row.session).toBe(orphan)
        }
    })

    it('does not duplicate a session that appears in both metadata classification and live unclaimed list', async () => {
        const unclaimed: UnclaimedTmuxSession = makeUnclaimed()
        const rows = await discoverRecoverableAgentSessions(
            makeDeps({
                readVaultMetadataDir: async () => [metadataRecord(makeRunningClaudeMetadata())],
                listLiveTmuxSessionNames: async () => new Set([SESSION_A]),
                listLiveUnclaimedTmuxSessions: async () => [unclaimed],
            }),
        )
        expect(rows.filter((r) => r.kind === 'attachable-tmux')).toHaveLength(1)
    })

    it('drops attachable-live-tmux rows whose unclaimed-session entry has disappeared between calls (race)', async () => {
        const rows = await discoverRecoverableAgentSessions(
            makeDeps({
                readVaultMetadataDir: async () => [metadataRecord(makeRunningClaudeMetadata())],
                listLiveTmuxSessionNames: async () => new Set([SESSION_A]),
                listLiveUnclaimedTmuxSessions: async () => [],
            }),
        )
        expect(rows).toHaveLength(0)
    })
})

// ---------------------------------------------------------------------------
// Scenario: Exclude non-resumable persisted records
// ---------------------------------------------------------------------------

describe('discoverRecoverableAgentSessions — non-actionable diagnostics are dropped', () => {
    it('omits records already represented in the in-memory registry', async () => {
        const rows = await discoverRecoverableAgentSessions(
            makeDeps({
                readVaultMetadataDir: async () => [metadataRecord(makeRunningClaudeMetadata())],
                getRegistryTerminalIds: () => new Set([TERMINAL_A]),
            }),
        )
        expect(rows).toHaveLength(0)
    })

    it('omits records missing recovery.native handle', async () => {
        const rows = await discoverRecoverableAgentSessions(
            makeDeps({readVaultMetadataDir: async () => [metadataRecord(makeRunningClaudeMetadata({recovery: undefined}))]}),
        )
        expect(rows).toHaveLength(0)
    })

    it('omits exited records', async () => {
        const rows = await discoverRecoverableAgentSessions(
            makeDeps({readVaultMetadataDir: async () => [metadataRecord(makeRunningClaudeMetadata({status: 'exited'}))]}),
        )
        expect(rows).toHaveLength(0)
    })

    it('omits records whose initialCommand does not detect as Claude/Codex', async () => {
        const rows = await discoverRecoverableAgentSessions(
            makeDeps({
                readVaultMetadataDir: async () => [
                    metadataRecord(makeRunningClaudeMetadata({terminalData: makeTerminalData({initialCommand: 'bash'})})),
                ],
            }),
        )
        expect(rows).toHaveLength(0)
    })

    it('omits foreign-vault records', async () => {
        const foreignSession = `vt-${FOREIGN_HASH}-${TERMINAL_A}`
        const rows = await discoverRecoverableAgentSessions(
            makeDeps({
                readVaultMetadataDir: async () => [metadataRecord(makeRunningClaudeMetadata({session: foreignSession}))],
            }),
        )
        expect(rows).toHaveLength(0)
    })

    it('skips invalid metadata records but still returns valid ones', async () => {
        const rows = await discoverRecoverableAgentSessions(
            makeDeps({
                readVaultMetadataDir: async () => [
                    metadataRecord({not: 'valid metadata'}, '/vault/.voicetree/terminals/bad.json'),
                    metadataRecord(makeRunningClaudeMetadata()),
                ],
            }),
        )
        expect(rows).toHaveLength(1)
        expect(rows[0].kind).toBe('resumable-cli')
    })

    it('returns empty when the vault metadata dir is empty', async () => {
        const rows = await discoverRecoverableAgentSessions(makeDeps({readVaultMetadataDir: async () => []}))
        expect(rows).toEqual([])
    })
})

// ---------------------------------------------------------------------------
// Scenario: Stable ordering
// ---------------------------------------------------------------------------

describe('discoverRecoverableAgentSessions — ordering', () => {
    it('places attachable rows before resumable rows and sorts attachable by createdAt desc, resumable by metadata path asc', async () => {
        const olderUnclaimed: UnclaimedTmuxSession = makeUnclaimed({
            sessionName: `vt-${VAULT_HASH}-Old`,
            terminalId: 'Old',
            createdAt: 1_700_000_000_000,
        })
        const newerUnclaimed: UnclaimedTmuxSession = makeUnclaimed({
            sessionName: `vt-${VAULT_HASH}-New`,
            terminalId: 'New',
            createdAt: 1_800_000_000_000,
        })
        const oldMeta = {
            name: 'Old',
            status: 'running' as const,
            session: olderUnclaimed.sessionName,
            terminalData: makeTerminalData({terminalId: 'Old' as ReturnType<typeof makeTerminalData>['terminalId']}),
        }
        const newMeta = {
            name: 'New',
            status: 'running' as const,
            session: newerUnclaimed.sessionName,
            terminalData: makeTerminalData({terminalId: 'New' as ReturnType<typeof makeTerminalData>['terminalId']}),
        }
        const resumableA = makeRunningClaudeMetadata()  // METADATA_PATH_A = .../A.json
        const resumableB = makeRunningCodexMetadata()   // we'll place at .../C.json so order checks both
        const rows = await discoverRecoverableAgentSessions(
            makeDeps({
                readVaultMetadataDir: async () => [
                    metadataRecord(newMeta, '/vault/.voicetree/terminals/New.json'),
                    metadataRecord(oldMeta, '/vault/.voicetree/terminals/Old.json'),
                    metadataRecord(resumableB, '/vault/.voicetree/terminals/C.json'),
                    metadataRecord(resumableA, METADATA_PATH_A),
                ],
                listLiveTmuxSessionNames: async () => new Set([olderUnclaimed.sessionName, newerUnclaimed.sessionName]),
                listLiveUnclaimedTmuxSessions: async () => [olderUnclaimed, newerUnclaimed],
            }),
        )
        expect(rows.map((r) => r.kind)).toEqual([
            'attachable-tmux',
            'attachable-tmux',
            'resumable-cli',
            'resumable-cli',
        ])
        if (rows[0].kind === 'attachable-tmux' && rows[1].kind === 'attachable-tmux') {
            expect(rows[0].session.terminalId).toBe('New')
            expect(rows[1].session.terminalId).toBe('Old')
        }
        if (rows[2].kind === 'resumable-cli' && rows[3].kind === 'resumable-cli') {
            expect(rows[2].metadataPath).toBe(METADATA_PATH_A)  // .../A.json
            expect(rows[3].metadataPath).toBe('/vault/.voicetree/terminals/C.json')
        }
    })
})
