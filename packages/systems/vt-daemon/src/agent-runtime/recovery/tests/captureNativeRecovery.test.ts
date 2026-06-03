import {describe, expect, it} from 'vitest'
import {captureNativeRecoveryHandle} from '../captureNativeRecovery'
import {resumePersistedAgentSession, type ResumePersistedDeps} from '../resumePersistedAgentSession'
import type {NativeSessionRequest, NativeSessionResult} from '../resolvers/resolveNativeSession'
import type {RecoverableAgentSession} from '../types'
import type {TmuxTerminalMetadata} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/terminal-metadata.ts'
import type {TerminalData, TerminalId} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts'
import {makeTerminalData, TERMINAL_A, SESSION_A, PROJECT_PATH} from './classifier.test-fixtures'

const TERMINAL_ID_A: TerminalId = TERMINAL_A as TerminalId

function makeMetadata(overrides: Partial<TmuxTerminalMetadata> = {}): TmuxTerminalMetadata {
    return {
        name: TERMINAL_A,
        status: 'running',
        session: SESSION_A,
        terminalData: makeTerminalData({initialCommand: 'claude'}),
        ...overrides,
    }
}

function recordingResolver(
    impl: (req: NativeSessionRequest) => NativeSessionResult,
): {resolve: (req: NativeSessionRequest) => Promise<NativeSessionResult>; calls: NativeSessionRequest[]} {
    const calls: NativeSessionRequest[] = []
    return {
        calls,
        resolve: async (req: NativeSessionRequest): Promise<NativeSessionResult> => {
            calls.push(req)
            return impl(req)
        },
    }
}

// ---------------------------------------------------------------------------
// captureNativeRecoveryHandle — the D3 capture primitive
// ---------------------------------------------------------------------------

describe('captureNativeRecoveryHandle', () => {
    it('resolves and returns a complete native handle for a Claude record with no prior recovery', async () => {
        const {resolve, calls} = recordingResolver(() => ({
            kind: 'found',
            sessionId: 'sess-claude-1',
            providerStorePath: '/Users/bob/.claude/projects/p/t.jsonl',
        }))

        const handle = await captureNativeRecoveryHandle(TERMINAL_ID_A, makeMetadata(), resolve)

        expect(handle).toEqual({
            cli: 'claude',
            mode: 'interactive',
            sessionId: 'sess-claude-1',
            capturedAt: expect.any(String),
            source: 'claude-project-transcript',
            providerStorePath: '/Users/bob/.claude/projects/p/t.jsonl',
        })
        expect(calls).toEqual([{cliType: 'claude', terminalId: TERMINAL_ID_A, projectRoot: PROJECT_PATH, taskNodePath: ''}])
    })

    it('captures a headless Codex handle with the codex-state-index source and headless mode', async () => {
        const {resolve} = recordingResolver(() => ({kind: 'found', sessionId: 'thread-codex-1'}))
        const metadata = makeMetadata({
            terminalData: makeTerminalData({initialCommand: 'codex exec --full-auto "$AGENT_PROMPT"', isHeadless: true}),
        })

        const handle = await captureNativeRecoveryHandle(TERMINAL_ID_A, metadata, resolve)

        expect(handle).toEqual({
            cli: 'codex',
            mode: 'headless',
            sessionId: 'thread-codex-1',
            capturedAt: expect.any(String),
            source: 'codex-state-index',
        })
    })

    it('forwards TASK_NODE_PATH into the resolver request when present', async () => {
        const {resolve, calls} = recordingResolver(() => ({kind: 'found', sessionId: 's'}))
        const metadata = makeMetadata({
            terminalData: makeTerminalData({
                initialCommand: 'claude',
                initialEnvVars: {VOICETREE_PROJECT_PATH: PROJECT_PATH, TASK_NODE_PATH: '/project/.voicetree/tasks/T.md'},
            }),
        })

        await captureNativeRecoveryHandle(TERMINAL_ID_A, metadata, resolve)

        expect(calls[0].taskNodePath).toBe('/project/.voicetree/tasks/T.md')
    })

    it('returns null and never calls the resolver when recovery.native is already present (preserve)', async () => {
        const {resolve, calls} = recordingResolver(() => ({kind: 'found', sessionId: 'should-not-happen'}))
        const metadata = makeMetadata({
            recovery: {native: {cli: 'claude', mode: 'interactive', sessionId: 'already-here', capturedAt: '2026-01-01T00:00:00.000Z', source: 'claude-project-transcript'}},
        })

        const handle = await captureNativeRecoveryHandle(TERMINAL_ID_A, metadata, resolve)

        expect(handle).toBeNull()
        expect(calls).toHaveLength(0)
    })

    it('returns null without resolving for an unsupported CLI', async () => {
        const {resolve, calls} = recordingResolver(() => ({kind: 'found', sessionId: 'x'}))
        const metadata = makeMetadata({terminalData: makeTerminalData({initialCommand: 'gemini'})})

        expect(await captureNativeRecoveryHandle(TERMINAL_ID_A, metadata, resolve)).toBeNull()
        expect(calls).toHaveLength(0)
    })

    it('returns null without resolving when VOICETREE_PROJECT_PATH is missing', async () => {
        const {resolve, calls} = recordingResolver(() => ({kind: 'found', sessionId: 'x'}))
        const metadata = makeMetadata({
            terminalData: makeTerminalData({initialCommand: 'claude', initialEnvVars: {VOICETREE_TERMINAL_ID: TERMINAL_A}}),
        })

        expect(await captureNativeRecoveryHandle(TERMINAL_ID_A, metadata, resolve)).toBeNull()
        expect(calls).toHaveLength(0)
    })

    it('returns null when the resolver cannot deterministically locate a provider session', async () => {
        const {resolve, calls} = recordingResolver(() => ({kind: 'not-found', reason: 'no-jsonl-matches'}))

        expect(await captureNativeRecoveryHandle(TERMINAL_ID_A, makeMetadata(), resolve)).toBeNull()
        expect(calls).toHaveLength(1)
    })
})

// ---------------------------------------------------------------------------
// Regression: a captured handle makes resume JSON-driven — no resolver scan.
// This is the end-to-end shape of BF-455 + BF-457: exit captures the handle,
// resume consumes it straight from the persisted record.
// ---------------------------------------------------------------------------

describe('captured handle → resume reads it without the resolver scan', () => {
    it('resumes from the persisted nativeSessionId and never invokes the resolver', async () => {
        const captured = await captureNativeRecoveryHandle(
            TERMINAL_ID_A,
            makeMetadata(),
            async () => ({kind: 'found', sessionId: 'sess-captured-at-exit'}),
        )
        expect(captured?.sessionId).toBe('sess-captured-at-exit')

        const row: RecoverableAgentSession = {
            terminalId: TERMINAL_ID_A,
            agentName: 'Ari',
            metadataPath: '/project/.voicetree/terminals/A.json',
            terminalData: makeTerminalData({initialCommand: 'claude'}),
            isClaimed: false,
            status: 'exited',
            // discovery surfaces recovery.native.sessionId into resume.nativeSessionId
            resume: {cliType: 'claude', nativeSessionId: captured!.sessionId},
        }

        const resolveCalls: NativeSessionRequest[] = []
        const spawnCalls: {command: string}[] = []
        const deps: ResumePersistedDeps = {
            discover: async () => [row],
            resolveNativeSession: async (req: NativeSessionRequest): Promise<NativeSessionResult> => {
                resolveCalls.push(req)
                return {kind: 'found', sessionId: 'resolver-should-not-run'}
            },
            spawn: async (_id: TerminalId, _data: TerminalData, command: string) => {
                spawnCalls.push({command})
                return {pid: 4242}
            },
        }

        const result = await resumePersistedAgentSession(TERMINAL_ID_A, deps)

        expect(result.kind).toBe('spawned')
        expect(spawnCalls).toHaveLength(1)
        expect(spawnCalls[0].command).toContain('claude --resume sess-captured-at-exit')
        expect(resolveCalls).toHaveLength(0)
    })
})
