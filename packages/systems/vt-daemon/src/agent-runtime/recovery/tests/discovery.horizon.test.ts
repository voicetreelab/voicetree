import {describe, expect, it} from 'vitest'
import {discoverRecoverableAgentSessions, type DiscoverRecoveryDeps} from '../discovery'
import type {MetadataRecord} from '../classifier/classifier'
import type {UnclaimedTmuxSession} from '../../terminals/tmux/unclaimed-tmux'
import {
    makeExitedClaudeMetadata,
    makeKilledClaudeMetadata,
    makeRunningClaudeMetadata,
    makeTerminalData,
    record,
    SESSION_A,
    TERMINAL_A,
    VAULT_HASH,
    VAULT_PATH,
} from '../classifier/classifier.test-fixtures'

const NOW_MS: number = Date.parse('2026-05-27T00:00:00.000Z')
const FIVE_DAYS_AGO: string = new Date(NOW_MS - 5 * 24 * 60 * 60 * 1000).toISOString()
const THIRTY_DAYS_AGO: string = new Date(NOW_MS - 30 * 24 * 60 * 60 * 1000).toISOString()
const ONE_DAY_AGO: string = new Date(NOW_MS - 1 * 24 * 60 * 60 * 1000).toISOString()
const TWO_HOURS_AGO: string = new Date(NOW_MS - 2 * 60 * 60 * 1000).toISOString()

function fixedNow(): number {
    return NOW_MS
}

function makeDeps(overrides: Partial<DiscoverRecoveryDeps> = {}): DiscoverRecoveryDeps {
    return {
        readVaultMetadataDir: async () => [],
        listLiveUnclaimedTmuxSessions: async () => [],
        getRegistryTerminalIds: () => new Set<string>(),
        getCurrentNamespaceHash: async () => VAULT_HASH,
        ...overrides,
    }
}

function metadataRecord(data: unknown, path = '/vault/.voicetree/terminals/A.json'): MetadataRecord {
    return record(data, path)
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
        projectRoot: VAULT_PATH,
        contextNodePath: '/vault/node.md',
        taskNodePath: '/vault/task.md',
        ...overrides,
    }
}

describe('discoverRecoverableAgentSessions — recency horizon (§6.3, §6.6)', () => {
    it('includes an exited record whose endedAt is within the horizon', async () => {
        const rows = await discoverRecoverableAgentSessions(
            makeDeps({
                readVaultMetadataDir: async () => [metadataRecord(makeExitedClaudeMetadata({
                    endedAt: FIVE_DAYS_AGO,
                }))],
            }),
            {now: fixedNow},
        )
        expect(rows).toHaveLength(1)
        expect(rows[0].status).toBe('exited')
        expect(rows[0].endedAt).toBe(FIVE_DAYS_AGO)
    })

    it('drops an exited record whose endedAt is older than the horizon', async () => {
        const rows = await discoverRecoverableAgentSessions(
            makeDeps({
                readVaultMetadataDir: async () => [metadataRecord(makeExitedClaudeMetadata({
                    endedAt: THIRTY_DAYS_AGO,
                }))],
            }),
            {now: fixedNow},
        )
        expect(rows).toHaveLength(0)
    })

    it('surfaces a killed record within the horizon with killReason propagated', async () => {
        const rows = await discoverRecoverableAgentSessions(
            makeDeps({
                readVaultMetadataDir: async () => [metadataRecord(makeKilledClaudeMetadata({
                    endedAt: ONE_DAY_AGO,
                    killReason: 'user',
                }))],
            }),
            {now: fixedNow},
        )
        expect(rows).toHaveLength(1)
        expect(rows[0].status).toBe('killed')
        expect(rows[0].killReason).toBe('user')
    })

    it('keeps a running row regardless of how old its startedAt is (horizon only gates closed rows)', async () => {
        const rows = await discoverRecoverableAgentSessions(
            makeDeps({
                readVaultMetadataDir: async () => [metadataRecord(makeRunningClaudeMetadata({
                    startedAt: THIRTY_DAYS_AGO,
                }))],
            }),
            {now: fixedNow},
        )
        expect(rows).toHaveLength(1)
        expect(rows[0].status).toBe('running')
    })

    it('disables the cutoff when horizonMs is null (show-older path)', async () => {
        const rows = await discoverRecoverableAgentSessions(
            makeDeps({
                readVaultMetadataDir: async () => [metadataRecord(makeExitedClaudeMetadata({
                    endedAt: THIRTY_DAYS_AGO,
                }))],
            }),
            {now: fixedNow, horizonMs: null},
        )
        expect(rows).toHaveLength(1)
        expect(rows[0].endedAt).toBe(THIRTY_DAYS_AGO)
    })

    it('surfaces an exited row that carries no endedAt (unknown age — do not silently hide)', async () => {
        const rows = await discoverRecoverableAgentSessions(
            makeDeps({
                readVaultMetadataDir: async () => [metadataRecord({
                    name: TERMINAL_A,
                    status: 'exited',
                    session: SESSION_A,
                    terminalData: makeTerminalData({initialCommand: 'claude'}),
                })],
            }),
            {now: fixedNow},
        )
        expect(rows).toHaveLength(1)
        expect(rows[0].endedAt).toBeUndefined()
    })
})

describe('discoverRecoverableAgentSessions — sort across groups (§6.4)', () => {
    it('orders attach-bearing → resume-only → closed; within group sorts by recency desc', async () => {
        const liveSessionName = `vt-${VAULT_HASH}-Live`
        const live: UnclaimedTmuxSession = makeUnclaimed({
            sessionName: liveSessionName,
            terminalId: 'Live',
            agentName: 'Live',
        })
        const liveMeta = {
            name: 'Live',
            status: 'running' as const,
            session: liveSessionName,
            startedAt: TWO_HOURS_AGO,
            terminalData: makeTerminalData({
                terminalId: 'Live' as ReturnType<typeof makeTerminalData>['terminalId'],
                initialCommand: 'claude',
                initialEnvVars: {VOICETREE_TERMINAL_ID: 'Live', VOICETREE_VAULT_PATH: VAULT_PATH},
            }),
        }
        const resumeOnlyMeta = makeRunningClaudeMetadata({
            name: 'ResumeOnly',
            session: `vt-${VAULT_HASH}-ResumeOnly`,
            startedAt: FIVE_DAYS_AGO,
            terminalData: makeTerminalData({
                terminalId: 'ResumeOnly' as ReturnType<typeof makeTerminalData>['terminalId'],
                initialCommand: 'claude',
                initialEnvVars: {VOICETREE_TERMINAL_ID: 'ResumeOnly', VOICETREE_VAULT_PATH: VAULT_PATH},
            }),
        })
        const closedRecent = makeExitedClaudeMetadata({
            name: 'ClosedRecent',
            session: `vt-${VAULT_HASH}-ClosedRecent`,
            endedAt: ONE_DAY_AGO,
            terminalData: makeTerminalData({
                terminalId: 'ClosedRecent' as ReturnType<typeof makeTerminalData>['terminalId'],
                initialCommand: 'claude',
                initialEnvVars: {VOICETREE_TERMINAL_ID: 'ClosedRecent', VOICETREE_VAULT_PATH: VAULT_PATH},
            }),
        })
        const closedOlder = makeKilledClaudeMetadata({
            name: 'ClosedOlder',
            session: `vt-${VAULT_HASH}-ClosedOlder`,
            endedAt: FIVE_DAYS_AGO,
            terminalData: makeTerminalData({
                terminalId: 'ClosedOlder' as ReturnType<typeof makeTerminalData>['terminalId'],
                initialCommand: 'claude',
                initialEnvVars: {VOICETREE_TERMINAL_ID: 'ClosedOlder', VOICETREE_VAULT_PATH: VAULT_PATH},
            }),
        })

        const rows = await discoverRecoverableAgentSessions(
            makeDeps({
                readVaultMetadataDir: async () => [
                    metadataRecord(closedOlder, '/vault/.voicetree/terminals/ClosedOlder.json'),
                    metadataRecord(resumeOnlyMeta, '/vault/.voicetree/terminals/ResumeOnly.json'),
                    metadataRecord(closedRecent, '/vault/.voicetree/terminals/ClosedRecent.json'),
                    metadataRecord(liveMeta, '/vault/.voicetree/terminals/Live.json'),
                ],
                listLiveUnclaimedTmuxSessions: async () => [live],
            }),
            {now: fixedNow},
        )

        expect(rows.map((r) => r.terminalId)).toEqual([
            'Live',          // tier 0: live tmux attachable
            'ResumeOnly',    // tier 1: resume only, status running
            'ClosedRecent',  // tier 2: closed, most recent first
            'ClosedOlder',   // tier 2: closed, older second
        ])
    })
})
