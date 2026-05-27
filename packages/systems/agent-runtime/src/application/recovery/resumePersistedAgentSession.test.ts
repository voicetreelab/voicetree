import {describe, expect, it} from 'vitest'
import {resumePersistedAgentSession, type ResumePersistedDeps} from './resumePersistedAgentSession'
import type {NativeSessionRequest, NativeSessionResult} from './resolvers/resolveNativeSession'
import type {RecoverableAgentSession} from './types'
import type {TerminalData, TerminalId} from '@vt/vt-daemon/terminals/terminal-registry/types.ts'
import {makeLiveSession, makeTerminalData, SESSION_A, TERMINAL_A, VAULT_PATH} from './classifier.test-fixtures'

const TERMINAL_ID_A: TerminalId = TERMINAL_A as TerminalId

function makeRecoverableRow(overrides: Partial<RecoverableAgentSession> = {}): RecoverableAgentSession {
    return {
        terminalId: TERMINAL_ID_A,
        agentName: 'Ari',
        metadataPath: '/vault/.voicetree/terminals/A.json',
        terminalData: makeTerminalData({initialCommand: 'claude'}),
        isClaimed: false,
        resume: {cliType: 'claude'},
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

type Harness = {
    deps: ResumePersistedDeps
    spawnCalls: SpawnCall[]
    resolveCalls: NativeSessionRequest[]
}

function makeDeps(
    overrides: {
        discover?: ResumePersistedDeps['discover']
        resolveNativeSession?: ResumePersistedDeps['resolveNativeSession']
        spawnImpl?: (call: SpawnCall) => Promise<{readonly pid: number}>
    } = {},
): Harness {
    const spawnCalls: SpawnCall[] = []
    const resolveCalls: NativeSessionRequest[] = []
    const recordingResolver = async (req: NativeSessionRequest): Promise<NativeSessionResult> => {
        resolveCalls.push(req)
        return overrides.resolveNativeSession
            ? overrides.resolveNativeSession(req)
            : {kind: 'found', sessionId: 'sess-uuid-resume'}
    }
    const defaultSpawn = async (
        terminalId: TerminalId,
        terminalData: TerminalData,
        command: string,
        cwd: string | undefined,
        env: Record<string, string>,
    ): Promise<{readonly pid: number}> => {
        const call: SpawnCall = {terminalId, terminalData, command, cwd, env}
        spawnCalls.push(call)
        return overrides.spawnImpl ? overrides.spawnImpl(call) : {pid: 9876}
    }
    return {
        deps: {
            discover: overrides.discover ?? (async () => []),
            resolveNativeSession: recordingResolver,
            spawn: defaultSpawn,
        },
        spawnCalls,
        resolveCalls,
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
        const {deps, spawnCalls, resolveCalls} = makeDeps({discover: async () => [row]})
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result.kind).toBe('spawned')
        if (result.kind === 'spawned') {
            expect(result.command).toContain('claude --resume sess-uuid-resume')
        }
        expect(spawnCalls).toHaveLength(1)
        expect(spawnCalls[0].terminalId).toBe(TERMINAL_ID_A)
        expect(spawnCalls[0].cwd).toBe('/vault/work')
        expect(spawnCalls[0].env).toEqual({VOICETREE_TERMINAL_ID: TERMINAL_A, VOICETREE_VAULT_PATH: VAULT_PATH, AGENT_NAME: 'Ari'})
        // Lazy resolution: resolver invoked exactly once, at click time, with click-scoped request
        expect(resolveCalls).toHaveLength(1)
        expect(resolveCalls[0]).toEqual({
            cliType: 'claude',
            terminalId: TERMINAL_ID_A,
            projectRoot: VAULT_PATH,
            taskNodePath: '',
        })
    })
})

// ---------------------------------------------------------------------------
// Resume Codex session (interactive vs headless)
// ---------------------------------------------------------------------------

describe('resumePersistedAgentSession — Codex', () => {
    it('spawns codex resume <thread-id> for interactive Codex agents', async () => {
        const row = makeRecoverableRow({
            resume: {cliType: 'codex'},
            terminalData: makeTerminalData({initialCommand: 'codex', isHeadless: false}),
        })
        const {deps, spawnCalls} = makeDeps({
            discover: async () => [row],
            resolveNativeSession: async () => ({kind: 'found', sessionId: 'thread-xyz'}),
        })
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result.kind).toBe('spawned')
        if (result.kind === 'spawned') {
            expect(result.command).toContain('codex resume thread-xyz')
            expect(result.command).not.toContain('exec')
        }
        expect(spawnCalls).toHaveLength(1)
    })

    it('spawns codex exec resume <thread-id> for headless Codex agents', async () => {
        const row = makeRecoverableRow({
            resume: {cliType: 'codex'},
            terminalData: makeTerminalData({initialCommand: 'codex exec --full-auto "$AGENT_PROMPT"', isHeadless: true}),
        })
        const {deps, spawnCalls} = makeDeps({
            discover: async () => [row],
            resolveNativeSession: async () => ({kind: 'found', sessionId: 'thread-headless'}),
        })
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result.kind).toBe('spawned')
        if (result.kind === 'spawned') {
            expect(result.command).toContain('codex exec resume thread-headless')
        }
        expect(spawnCalls).toHaveLength(1)
    })
})

// ---------------------------------------------------------------------------
// Staleness checks: do not spawn or resolve when the row no longer makes sense
// ---------------------------------------------------------------------------

describe('resumePersistedAgentSession — staleness checks', () => {
    it('returns stale/not-in-discovery without spawning OR resolving when the terminal is no longer in the recovery list', async () => {
        const {deps, spawnCalls, resolveCalls} = makeDeps({discover: async () => []})
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result).toEqual({kind: 'stale', reason: 'not-in-discovery'})
        expect(spawnCalls).toHaveLength(0)
        expect(resolveCalls).toHaveLength(0)
    })

    it('returns stale/already-claimed without spawning OR resolving when the terminal is now claimed', async () => {
        const claimedRow: RecoverableAgentSession = makeRecoverableRow({isClaimed: true})
        const {deps, spawnCalls, resolveCalls} = makeDeps({discover: async () => [claimedRow]})
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result).toEqual({kind: 'stale', reason: 'already-claimed'})
        expect(spawnCalls).toHaveLength(0)
        expect(resolveCalls).toHaveLength(0)
    })

    it('returns stale/no-resume-handle without resolving when the discovery row lacks a resume capability', async () => {
        const attachOnlyRow: RecoverableAgentSession = makeRecoverableRow({
            resume: undefined,
            attach: {session: makeLiveSession(SESSION_A)},
        })
        const {deps, spawnCalls, resolveCalls} = makeDeps({discover: async () => [attachOnlyRow]})
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result).toEqual({kind: 'stale', reason: 'no-resume-handle'})
        expect(spawnCalls).toHaveLength(0)
        expect(resolveCalls).toHaveLength(0)
    })
})

// ---------------------------------------------------------------------------
// Lazy native-session resolution: scan happens at click, not at discovery
// ---------------------------------------------------------------------------

describe('resumePersistedAgentSession — lazy native-session resolution', () => {
    it('returns no-native-session without spawning when the resolver cannot locate a transcript', async () => {
        const row = makeRecoverableRow()
        const {deps, spawnCalls, resolveCalls} = makeDeps({
            discover: async () => [row],
            resolveNativeSession: async () => ({kind: 'not-found'}),
        })
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result).toEqual({kind: 'no-native-session', cliType: 'claude'})
        expect(spawnCalls).toHaveLength(0)
        expect(resolveCalls).toHaveLength(1)
    })

    it('passes the project root and task node path from the recovered row into the resolver request', async () => {
        const row = makeRecoverableRow({
            terminalData: makeTerminalData({
                initialCommand: 'claude',
                initialEnvVars: {
                    VOICETREE_TERMINAL_ID: TERMINAL_A,
                    VOICETREE_VAULT_PATH: '/some/vault/root',
                    TASK_NODE_PATH: '/some/vault/root/.voicetree/tasks/T-1.md',
                },
            }),
        })
        const {deps, resolveCalls} = makeDeps({discover: async () => [row]})
        await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(resolveCalls).toEqual([
            {
                cliType: 'claude',
                terminalId: TERMINAL_ID_A,
                projectRoot: '/some/vault/root',
                taskNodePath: '/some/vault/root/.voicetree/tasks/T-1.md',
            },
        ])
    })
})

// ---------------------------------------------------------------------------
// Spawn failure preserves recovery state
// ---------------------------------------------------------------------------

describe('resumePersistedAgentSession — spawn failure', () => {
    it('returns spawn-failed without throwing or calling any metadata-exit path', async () => {
        const row = makeRecoverableRow()
        const {deps, spawnCalls} = makeDeps({
            discover: async () => [row],
            spawnImpl: async () => {
                throw new Error('tmux: server failure')
            },
        })
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result).toEqual({kind: 'spawn-failed', error: 'tmux: server failure'})
        expect(spawnCalls).toHaveLength(1)
    })

    it('does not attempt a second spawn even after a failure', async () => {
        const row = makeRecoverableRow()
        const {deps, spawnCalls} = makeDeps({
            discover: async () => [row],
            spawnImpl: async () => {
                throw new Error('boom')
            },
        })
        await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(spawnCalls).toHaveLength(1)
    })
})

// ---------------------------------------------------------------------------
// Unsupported CLI / missing initialCommand / missing projectRoot
// ---------------------------------------------------------------------------

describe('resumePersistedAgentSession — unsupported inputs', () => {
    it('returns unsupported when the persisted terminal has no initialCommand (no resolver call)', async () => {
        const row = makeRecoverableRow({
            terminalData: makeTerminalData({initialCommand: undefined}),
        })
        const {deps, spawnCalls, resolveCalls} = makeDeps({discover: async () => [row]})
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result).toEqual({kind: 'unsupported', reason: 'missing-initial-command'})
        expect(spawnCalls).toHaveLength(0)
        expect(resolveCalls).toHaveLength(0)
    })

    it('returns unsupported/missing-project-root when the persisted terminal has no VOICETREE_VAULT_PATH', async () => {
        const row = makeRecoverableRow({
            terminalData: makeTerminalData({
                initialCommand: 'claude',
                initialEnvVars: {VOICETREE_TERMINAL_ID: TERMINAL_A},  // no VOICETREE_VAULT_PATH
            }),
        })
        const {deps, spawnCalls, resolveCalls} = makeDeps({discover: async () => [row]})
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result).toEqual({kind: 'unsupported', reason: 'missing-project-root'})
        expect(spawnCalls).toHaveLength(0)
        expect(resolveCalls).toHaveLength(0)
    })

    it('returns unsupported/empty-session-id when the resolver returns a blank sessionId', async () => {
        const row = makeRecoverableRow()
        const {deps, spawnCalls} = makeDeps({
            discover: async () => [row],
            resolveNativeSession: async () => ({kind: 'found', sessionId: '   '}),
        })
        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)
        expect(result.kind).toBe('unsupported')
        if (result.kind === 'unsupported') expect(result.reason).toBe('empty-session-id')
        expect(spawnCalls).toHaveLength(0)
    })
})
