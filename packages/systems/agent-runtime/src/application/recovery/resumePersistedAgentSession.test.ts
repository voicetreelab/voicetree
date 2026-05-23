import {describe, expect, it} from 'vitest'
import {resumePersistedAgentSession, type ResumePersistedDeps} from './resumePersistedAgentSession'
import type {RecoverableAgentSession} from './types'
import type {TerminalData, TerminalId} from '../terminals/terminal-registry/types'
import {makeLiveSession, makeTerminalData, SESSION_A, TERMINAL_A, VAULT_PATH} from './classifier.test-fixtures'

const TERMINAL_ID_A: TerminalId = TERMINAL_A as TerminalId

function makeRecoverableRow(overrides: Partial<RecoverableAgentSession> = {}): RecoverableAgentSession {
    return {
        terminalId: TERMINAL_ID_A,
        agentName: 'Ari',
        metadataPath: '/vault/.voicetree/terminals/A.json',
        terminalData: makeTerminalData({initialCommand: 'claude'}),
        isClaimed: false,
        resume: {cliType: 'claude', nativeSessionId: 'sess-uuid-resume'},
        ...overrides,
    }
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
// Resume Claude session
// ---------------------------------------------------------------------------

describe('resumePersistedAgentSession — Claude', () => {
    it('spawns a claude --resume <session-id> command under the original terminal id with persisted cwd and env', async () => {
        const row = makeRecoverableRow({
            terminalData: makeTerminalData({
                initialCommand: 'claude',
                initialSpawnDirectory: '/vault/work',
                initialEnvVars: {VOICETREE_TERMINAL_ID: TERMINAL_A, VOICETREE_VAULT_PATH: VAULT_PATH, AGENT_NAME: 'Ari'},
            }),
        })
        const {deps, calls} = makeDeps({discover: async () => [row]})
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
// Resume Codex session (interactive vs headless)
// ---------------------------------------------------------------------------

describe('resumePersistedAgentSession — Codex', () => {
    it('spawns codex resume <thread-id> for interactive Codex agents', async () => {
        const row = makeRecoverableRow({
            resume: {cliType: 'codex', nativeSessionId: 'thread-xyz'},
            terminalData: makeTerminalData({initialCommand: 'codex', isHeadless: false}),
        })
        const {deps, calls} = makeDeps({discover: async () => [row]})
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result.kind).toBe('spawned')
        if (result.kind === 'spawned') {
            expect(result.command).toContain('codex resume thread-xyz')
            expect(result.command).not.toContain('exec')
        }
        expect(calls).toHaveLength(1)
    })

    it('spawns codex exec resume <thread-id> for headless Codex agents', async () => {
        const row = makeRecoverableRow({
            resume: {cliType: 'codex', nativeSessionId: 'thread-headless'},
            terminalData: makeTerminalData({initialCommand: 'codex exec --full-auto "$AGENT_PROMPT"', isHeadless: true}),
        })
        const {deps, calls} = makeDeps({discover: async () => [row]})
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result.kind).toBe('spawned')
        if (result.kind === 'spawned') {
            expect(result.command).toContain('codex exec resume thread-headless')
        }
        expect(calls).toHaveLength(1)
    })
})

// ---------------------------------------------------------------------------
// Staleness checks: do not spawn when the row no longer makes sense
// ---------------------------------------------------------------------------

describe('resumePersistedAgentSession — staleness checks', () => {
    it('returns stale/not-in-discovery without spawning when the terminal is no longer in the recovery list', async () => {
        const {deps, calls} = makeDeps({discover: async () => []})
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result).toEqual({kind: 'stale', reason: 'not-in-discovery'})
        expect(calls).toHaveLength(0)
    })

    it('returns stale/already-claimed without spawning when the terminal is now claimed', async () => {
        const claimedRow: RecoverableAgentSession = makeRecoverableRow({isClaimed: true})
        const {deps, calls} = makeDeps({discover: async () => [claimedRow]})
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result).toEqual({kind: 'stale', reason: 'already-claimed'})
        expect(calls).toHaveLength(0)
    })

    it('returns stale/no-resume-handle when the discovery row lacks a resume capability', async () => {
        const attachOnlyRow: RecoverableAgentSession = makeRecoverableRow({
            resume: undefined,
            attach: {session: makeLiveSession(SESSION_A)},
        })
        const {deps, calls} = makeDeps({discover: async () => [attachOnlyRow]})
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result).toEqual({kind: 'stale', reason: 'no-resume-handle'})
        expect(calls).toHaveLength(0)
    })
})

// ---------------------------------------------------------------------------
// Spawn failure preserves recovery state
// ---------------------------------------------------------------------------

describe('resumePersistedAgentSession — spawn failure', () => {
    it('returns spawn-failed without throwing or calling any metadata-exit path', async () => {
        const row = makeRecoverableRow()
        const {deps, calls} = makeDeps(
            {discover: async () => [row]},
            async () => {
                throw new Error('tmux: server failure')
            },
        )
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result).toEqual({kind: 'spawn-failed', error: 'tmux: server failure'})
        expect(calls).toHaveLength(1)
    })

    it('does not attempt a second spawn even after a failure', async () => {
        const row = makeRecoverableRow()
        const {deps, calls} = makeDeps(
            {discover: async () => [row]},
            async () => {
                throw new Error('boom')
            },
        )
        await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(calls).toHaveLength(1)
    })
})

// ---------------------------------------------------------------------------
// Unsupported CLI / missing initialCommand
// ---------------------------------------------------------------------------

describe('resumePersistedAgentSession — unsupported inputs', () => {
    it('returns unsupported when the persisted terminal has no initialCommand', async () => {
        const row = makeRecoverableRow({
            terminalData: makeTerminalData({initialCommand: undefined}),
        })
        const {deps, calls} = makeDeps({discover: async () => [row]})
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result).toEqual({kind: 'unsupported', reason: 'missing-initial-command'})
        expect(calls).toHaveLength(0)
    })

    it('returns unsupported/empty-session-id when nativeSessionId is blank', async () => {
        const row = makeRecoverableRow({
            resume: {cliType: 'claude', nativeSessionId: '   '},
        })
        const {deps, calls} = makeDeps({discover: async () => [row]})
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result.kind).toBe('unsupported')
        if (result.kind === 'unsupported') expect(result.reason).toBe('empty-session-id')
        expect(calls).toHaveLength(0)
    })
})
