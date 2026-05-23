import {describe, expect, it} from 'vitest'
import {discoverRecoverableAgentSessions, type DiscoverRecoveryDeps, type ResolveRequest} from './discovery'
import type {MetadataRecord} from './classifier'
import type {RecoverableAgentSession, ResumeCapability} from './types'
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

type ResolverMap = ReadonlyMap<string, ResumeCapability>

function makeDeps(overrides: Partial<DiscoverRecoveryDeps> = {}, resolverMap: ResolverMap = new Map()): DiscoverRecoveryDeps {
    return {
        readVaultMetadataDir: async () => [],
        listLiveUnclaimedTmuxSessions: async () => [],
        getRegistryTerminalIds: () => new Set<string>(),
        getCurrentNamespaceHash: async () => VAULT_HASH,
        resolveResumeHandle: (req: ResolveRequest): ResumeCapability | null => resolverMap.get(req.terminalId) ?? null,
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
// Resume capability surfaces when the resolver finds a transcript
// ---------------------------------------------------------------------------

describe('discoverRecoverableAgentSessions — resume capability', () => {
    it('attaches a resume capability for Claude when the resolver returns a session id', async () => {
        const rows = await discoverRecoverableAgentSessions(makeDeps(
            {readVaultMetadataDir: async () => [metadataRecord(makeRunningClaudeMetadata())]},
            new Map([[TERMINAL_A, {cliType: 'claude', nativeSessionId: 'sess-uuid-123'}]]),
        ))
        expect(rows).toHaveLength(1)
        const row: RecoverableAgentSession = rows[0]
        expect(row.terminalId).toBe(TERMINAL_A)
        expect(row.resume?.cliType).toBe('claude')
        expect(row.resume?.nativeSessionId).toBe('sess-uuid-123')
        expect(row.metadataPath).toBe(METADATA_PATH_A)
    })

    it('attaches a resume capability for Codex when the resolver returns a session id', async () => {
        const rows = await discoverRecoverableAgentSessions(makeDeps(
            {readVaultMetadataDir: async () => [metadataRecord(makeRunningCodexMetadata(), '/vault/.voicetree/terminals/B.json')]},
            new Map([['B', {cliType: 'codex', nativeSessionId: 'thread-uuid-456'}]]),
        ))
        expect(rows).toHaveLength(1)
        expect(rows[0].resume?.cliType).toBe('codex')
        expect(rows[0].resume?.nativeSessionId).toBe('thread-uuid-456')
    })

    it('omits the resume capability when the resolver returns not-found', async () => {
        const rows = await discoverRecoverableAgentSessions(makeDeps({
            readVaultMetadataDir: async () => [metadataRecord(makeRunningClaudeMetadata())],
        }))
        expect(rows).toHaveLength(0)  // no attach, no resume, not claimed → not surfaced
    })

    it('does NOT call the resolver for unsupported CLIs', async () => {
        let calls = 0
        await discoverRecoverableAgentSessions(makeDeps({
            readVaultMetadataDir: async () => [metadataRecord(makeRunningClaudeMetadata({
                terminalData: makeTerminalData({initialCommand: 'gemini'}),
            }))],
            resolveResumeHandle: () => { calls += 1; return null },
        }))
        expect(calls).toBe(0)
    })

    it('does NOT call the resolver for foreign-vault records', async () => {
        let calls = 0
        await discoverRecoverableAgentSessions(makeDeps({
            readVaultMetadataDir: async () => [metadataRecord(makeRunningClaudeMetadata({
                session: `vt-${FOREIGN_HASH}-${TERMINAL_A}`,
            }))],
            resolveResumeHandle: () => { calls += 1; return null },
        }))
        expect(calls).toBe(0)
    })
})

// ---------------------------------------------------------------------------
// Attach capability for live tmux
// ---------------------------------------------------------------------------

describe('discoverRecoverableAgentSessions — attach capability', () => {
    it('attaches an attach capability when the tmux session is alive and matches an unclaimed listing', async () => {
        const unclaimed: UnclaimedTmuxSession = makeUnclaimed()
        const rows = await discoverRecoverableAgentSessions(makeDeps({
            readVaultMetadataDir: async () => [metadataRecord(makeRunningClaudeMetadata())],
            listLiveUnclaimedTmuxSessions: async () => [unclaimed],
        }))
        expect(rows).toHaveLength(1)
        expect(rows[0].attach?.session).toBe(unclaimed)
    })

    it('attaches BOTH attach AND resume capabilities when tmux is alive AND resolver finds a session', async () => {
        const unclaimed: UnclaimedTmuxSession = makeUnclaimed()
        const rows = await discoverRecoverableAgentSessions(makeDeps(
            {
                readVaultMetadataDir: async () => [metadataRecord(makeRunningClaudeMetadata())],
                listLiveUnclaimedTmuxSessions: async () => [unclaimed],
            },
            new Map([[TERMINAL_A, {cliType: 'claude', nativeSessionId: 'sess-uuid-123'}]]),
        ))
        expect(rows).toHaveLength(1)
        expect(rows[0].attach).toBeDefined()
        expect(rows[0].resume).toBeDefined()
    })

    it('surfaces a live unclaimed tmux session that has no matching metadata file', async () => {
        const orphan: UnclaimedTmuxSession = makeUnclaimed({
            sessionName: `vt-${VAULT_HASH}-Orphan`,
            terminalId: 'Orphan',
            agentName: 'Orphan',
        })
        const rows = await discoverRecoverableAgentSessions(makeDeps({
            readVaultMetadataDir: async () => [],
            listLiveUnclaimedTmuxSessions: async () => [orphan],
        }))
        expect(rows).toHaveLength(1)
        expect(rows[0].attach?.session).toBe(orphan)
        expect(rows[0].resume).toBeUndefined()
    })

    it('does not duplicate a terminal that appears in both metadata classification and live unclaimed list', async () => {
        const unclaimed: UnclaimedTmuxSession = makeUnclaimed()
        const rows = await discoverRecoverableAgentSessions(makeDeps({
            readVaultMetadataDir: async () => [metadataRecord(makeRunningClaudeMetadata())],
            listLiveUnclaimedTmuxSessions: async () => [unclaimed],
        }))
        expect(rows).toHaveLength(1)
    })
})

// ---------------------------------------------------------------------------
// Surfacing rules
// ---------------------------------------------------------------------------

describe('discoverRecoverableAgentSessions — surfacing rules', () => {
    it('surfaces claimed terminals with isClaimed=true (so live tabs can offer fork-on-hover)', async () => {
        const rows = await discoverRecoverableAgentSessions(makeDeps(
            {
                readVaultMetadataDir: async () => [metadataRecord(makeRunningClaudeMetadata())],
                getRegistryTerminalIds: () => new Set([TERMINAL_A]),
            },
            new Map([[TERMINAL_A, {cliType: 'claude', nativeSessionId: 'sess-uuid-123'}]]),
        ))
        expect(rows).toHaveLength(1)
        expect(rows[0].isClaimed).toBe(true)
        expect(rows[0].resume).toBeDefined()
    })

    it('surfaces an exited record when a resolver match is still available', async () => {
        const rows = await discoverRecoverableAgentSessions(makeDeps(
            {readVaultMetadataDir: async () => [metadataRecord(makeRunningClaudeMetadata({status: 'exited'}))]},
            new Map([[TERMINAL_A, {cliType: 'claude', nativeSessionId: 'sess-uuid-123'}]]),
        ))
        expect(rows).toHaveLength(1)
        expect(rows[0].resume?.cliType).toBe('claude')
    })

    it('drops foreign-vault records', async () => {
        const foreignSession = `vt-${FOREIGN_HASH}-${TERMINAL_A}`
        const rows = await discoverRecoverableAgentSessions(makeDeps({
            readVaultMetadataDir: async () => [metadataRecord(makeRunningClaudeMetadata({session: foreignSession}))],
        }))
        expect(rows).toHaveLength(0)
    })

    it('skips invalid metadata records but still returns valid ones', async () => {
        const rows = await discoverRecoverableAgentSessions(makeDeps(
            {
                readVaultMetadataDir: async () => [
                    metadataRecord({not: 'valid metadata'}, '/vault/.voicetree/terminals/bad.json'),
                    metadataRecord(makeRunningClaudeMetadata()),
                ],
            },
            new Map([[TERMINAL_A, {cliType: 'claude', nativeSessionId: 'sess-uuid-123'}]]),
        ))
        expect(rows).toHaveLength(1)
        expect(rows[0].terminalId).toBe(TERMINAL_A)
    })

    it('returns empty when the vault metadata dir is empty and no live sessions', async () => {
        const rows = await discoverRecoverableAgentSessions(makeDeps({readVaultMetadataDir: async () => []}))
        expect(rows).toEqual([])
    })
})

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

describe('discoverRecoverableAgentSessions — ordering', () => {
    it('places unclaimed rows before claimed rows, attach-bearing rows before resume-only rows', async () => {
        const unclaimedSession = `vt-${VAULT_HASH}-AttachOnly`
        const attachOnly: UnclaimedTmuxSession = makeUnclaimed({
            sessionName: unclaimedSession,
            terminalId: 'AttachOnly',
            agentName: 'AttachOnly',
        })
        const attachOnlyMeta = {
            name: 'AttachOnly',
            status: 'running' as const,
            session: unclaimedSession,
            terminalData: makeTerminalData({terminalId: 'AttachOnly' as ReturnType<typeof makeTerminalData>['terminalId']}),
        }
        const resumableA = makeRunningClaudeMetadata()  // METADATA_PATH_A = .../A.json
        const claimedMeta = makeRunningClaudeMetadata({
            name: 'Claimed',
            terminalData: makeTerminalData({
                terminalId: 'Claimed' as ReturnType<typeof makeTerminalData>['terminalId'],
                initialCommand: 'claude',
                initialEnvVars: {VOICETREE_TERMINAL_ID: 'Claimed', VOICETREE_VAULT_PATH: VAULT_PATH},
            }),
        })
        const rows = await discoverRecoverableAgentSessions(makeDeps(
            {
                readVaultMetadataDir: async () => [
                    metadataRecord(attachOnlyMeta, '/vault/.voicetree/terminals/AttachOnly.json'),
                    metadataRecord(resumableA, METADATA_PATH_A),
                    metadataRecord(claimedMeta, '/vault/.voicetree/terminals/Claimed.json'),
                ],
                listLiveUnclaimedTmuxSessions: async () => [attachOnly],
                getRegistryTerminalIds: () => new Set(['Claimed']),
            },
            new Map([
                [TERMINAL_A, {cliType: 'claude', nativeSessionId: 'sess-uuid-123'}],
                ['Claimed', {cliType: 'claude', nativeSessionId: 'sess-claimed'}],
            ]),
        ))
        // Expect attach-bearing (unclaimed) first, then resume-only (unclaimed),
        // then claimed rows. AttachOnly has attach, A has resume only.
        expect(rows.map((r) => ({terminalId: r.terminalId, isClaimed: r.isClaimed, hasAttach: !!r.attach}))).toEqual([
            {terminalId: 'AttachOnly', isClaimed: false, hasAttach: true},
            {terminalId: TERMINAL_A, isClaimed: false, hasAttach: false},
            {terminalId: 'Claimed', isClaimed: true, hasAttach: false},
        ])
    })
})
