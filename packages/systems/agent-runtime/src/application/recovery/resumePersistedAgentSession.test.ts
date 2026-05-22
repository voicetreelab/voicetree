import {describe, expect, it} from 'vitest'
import {resumePersistedAgentSession, type ResumePersistedDeps} from './resumePersistedAgentSession'
import type {RecoverableAgentSession} from './types'
import type {TerminalData, TerminalId} from '../terminals/terminal-registry/types'
import type {UnclaimedTmuxSession} from '../terminals/tmux/unclaimed-tmux'
import {makeTerminalData, TERMINAL_A, VAULT_HASH, VAULT_PATH} from './classifier.test-fixtures'

const TERMINAL_ID_A: TerminalId = TERMINAL_A as TerminalId

function makeResumableSession(overrides: Partial<Extract<RecoverableAgentSession, {kind: 'resumable-cli'}>> = {}): RecoverableAgentSession {
    return {
        kind: 'resumable-cli',
        terminalId: TERMINAL_ID_A,
        agentName: 'Ari',
        cliType: 'claude',
        metadataPath: '/vault/.voicetree/terminals/A.json',
        terminalData: makeTerminalData({initialCommand: 'claude'}),
        nativeSessionId: 'sess-uuid-resume',
        reason: 'missing-tmux-session',
        ...overrides,
    }
}

function makeAttachableSession(): RecoverableAgentSession {
    const unclaimed: UnclaimedTmuxSession = {
        sessionName: `vt-${VAULT_HASH}-${TERMINAL_ID_A}`,
        terminalId: TERMINAL_ID_A,
        hash: VAULT_HASH,
        classification: 'this-vault',
        attachable: true,
        createdAt: 1_700_000_000_000,
        panePid: 1234,
        agentName: 'Ari',
        vaultPath: VAULT_PATH,
    }
    return {kind: 'attachable-tmux', session: unclaimed}
}

type SpawnCall = {
    terminalId: TerminalId
    terminalData: TerminalData
    command: string
    cwd: string | undefined
    env: Record<string, string>
}

function makeDeps(overrides: Partial<ResumePersistedDeps> = {}, spawnImpl?: (call: SpawnCall) => Promise<{readonly pid: number}>): {deps: ResumePersistedDeps; calls: SpawnCall[]} {
    const calls: SpawnCall[] = []
    const defaultSpawn = async (
        terminalId: TerminalId,
        terminalData: TerminalData,
        command: string,
        cwd: string | undefined,
        env: Record<string, string>,
    ): Promise<{readonly pid: number}> => {
        const call: SpawnCall = {terminalId, terminalData, command, cwd, env}
        calls.push(call)
        return spawnImpl ? spawnImpl(call) : {pid: 9876}
    }
    return {
        deps: {
            discover: async () => [],
            spawn: defaultSpawn,
            ...overrides,
        },
        calls,
    }
}

// ---------------------------------------------------------------------------
// Scenario: Resume Claude session — spec.md "Resume a persisted Claude or Codex session"
// ---------------------------------------------------------------------------

describe('resumePersistedAgentSession — Claude', () => {
    it('spawns a claude --resume <session-id> command under the original terminal id with persisted cwd and env', async () => {
        const claudeSession = makeResumableSession({
            terminalData: makeTerminalData({
                initialCommand: 'claude',
                initialSpawnDirectory: '/vault/work',
                initialEnvVars: {VOICETREE_TERMINAL_ID: TERMINAL_A, VOICETREE_VAULT_PATH: VAULT_PATH, AGENT_NAME: 'Ari'},
            }),
        })
        const {deps, calls} = makeDeps({discover: async () => [claudeSession]})
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result.kind).toBe('spawned')
        if (result.kind === 'spawned') {
            expect(result.command).toContain('claude --resume sess-uuid-resume')
        }
        expect(calls).toHaveLength(1)
        expect(calls[0].terminalId).toBe(TERMINAL_ID_A)
        expect(calls[0].cwd).toBe('/vault/work')
        expect(calls[0].env).toEqual({VOICETREE_TERMINAL_ID: TERMINAL_A, VOICETREE_VAULT_PATH: VAULT_PATH, AGENT_NAME: 'Ari'})
    })
})

// ---------------------------------------------------------------------------
// Scenario: Resume Codex session (interactive vs headless)
// ---------------------------------------------------------------------------

describe('resumePersistedAgentSession — Codex', () => {
    it('spawns codex resume <thread-id> for interactive Codex agents', async () => {
        const codexSession = makeResumableSession({
            cliType: 'codex',
            nativeSessionId: 'thread-xyz',
            terminalData: makeTerminalData({initialCommand: 'codex', isHeadless: false}),
        })
        const {deps, calls} = makeDeps({discover: async () => [codexSession]})
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result.kind).toBe('spawned')
        if (result.kind === 'spawned') {
            expect(result.command).toContain('codex resume thread-xyz')
            expect(result.command).not.toContain('exec')
        }
        expect(calls).toHaveLength(1)
    })

    it('spawns codex exec resume <thread-id> for headless Codex agents', async () => {
        const codexSession = makeResumableSession({
            cliType: 'codex',
            nativeSessionId: 'thread-headless',
            terminalData: makeTerminalData({initialCommand: 'codex exec --full-auto "$AGENT_PROMPT"', isHeadless: true}),
        })
        const {deps, calls} = makeDeps({discover: async () => [codexSession]})
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result.kind).toBe('spawned')
        if (result.kind === 'spawned') {
            expect(result.command).toContain('codex exec resume thread-headless')
        }
        expect(calls).toHaveLength(1)
    })
})

// ---------------------------------------------------------------------------
// Scenario: Resume action revalidates before spawning
// ---------------------------------------------------------------------------

describe('resumePersistedAgentSession — staleness checks', () => {
    it('returns stale/not-in-discovery without spawning when the terminal is no longer in the recovery list', async () => {
        const {deps, calls} = makeDeps({discover: async () => []})
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result).toEqual({kind: 'stale', reason: 'not-in-discovery'})
        expect(calls).toHaveLength(0)
    })

    it('returns stale/no-longer-resumable when the row has become an attachable tmux session', async () => {
        const {deps, calls} = makeDeps({discover: async () => [makeAttachableSession()]})
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result).toEqual({kind: 'stale', reason: 'no-longer-resumable'})
        expect(calls).toHaveLength(0)
    })
})

// ---------------------------------------------------------------------------
// Scenario: Resume failure preserves recovery state — spec.md "Report resume failures without corrupting recovery state"
// ---------------------------------------------------------------------------

describe('resumePersistedAgentSession — spawn failure', () => {
    it('returns spawn-failed without throwing or calling any metadata-exit path', async () => {
        const claudeSession = makeResumableSession()
        const {deps, calls} = makeDeps(
            {discover: async () => [claudeSession]},
            async () => {
                throw new Error('tmux: server failure')
            },
        )
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result).toEqual({kind: 'spawn-failed', error: 'tmux: server failure'})
        expect(calls).toHaveLength(1)  // spawn was attempted exactly once
    })

    it('does not attempt a second spawn even after a failure', async () => {
        const claudeSession = makeResumableSession()
        const {deps, calls} = makeDeps(
            {discover: async () => [claudeSession]},
            async () => {
                throw new Error('boom')
            },
        )
        await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(calls).toHaveLength(1)
    })
})

// ---------------------------------------------------------------------------
// Scenario: Unsupported CLI / missing initialCommand
// ---------------------------------------------------------------------------

describe('resumePersistedAgentSession — unsupported inputs', () => {
    it('returns unsupported when the persisted terminal has no initialCommand', async () => {
        const broken = makeResumableSession({
            terminalData: makeTerminalData({initialCommand: undefined}),
        })
        const {deps, calls} = makeDeps({discover: async () => [broken]})
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result).toEqual({kind: 'unsupported', reason: 'missing-initial-command'})
        expect(calls).toHaveLength(0)
    })

    it('returns unsupported/no-cli-detected when initialCommand does not begin with claude/codex', async () => {
        const broken = makeResumableSession({
            terminalData: makeTerminalData({initialCommand: 'bash -c "echo hi"'}),
        })
        const {deps, calls} = makeDeps({discover: async () => [broken]})
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result.kind).toBe('unsupported')
        if (result.kind === 'unsupported') expect(result.reason).toBe('no-cli-detected')
        expect(calls).toHaveLength(0)
    })

    it('returns unsupported/empty-session-id when nativeSessionId is blank', async () => {
        const broken = makeResumableSession({nativeSessionId: '   '})
        const {deps, calls} = makeDeps({discover: async () => [broken]})
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result.kind).toBe('unsupported')
        if (result.kind === 'unsupported') expect(result.reason).toBe('empty-session-id')
        expect(calls).toHaveLength(0)
    })
})
