import type {NodeIdAndFilePath} from '@vt/graph-model/graph'
import {describe, expect, it, vi} from 'vitest'
import type {TerminalRecord} from '../../terminal-registry'
import {createTerminalData, type TerminalId} from '../../terminal-registry/types'
import {
    buildTmuxNamespaceHash,
    buildTmuxSessionName,
    type TmuxListedSession,
} from '../../tmux/tmux-session-manager'
import {
    killUnclaimedTmuxSession,
    listUnclaimedTmuxSessions,
    parseVoicetreeTmuxSessionName,
    type KillUnclaimedTmuxDeps,
    type ListUnclaimedTmuxDeps,
    type UnclaimedTmuxSession,
} from '../../tmux/unclaimed-tmux'

function makeRecord(terminalId: string, initialEnvVars: Record<string, string> = {}): TerminalRecord {
    return {
        terminalId,
        terminalData: createTerminalData({
            terminalId: terminalId as TerminalId,
            attachedToNodeId: '/project/task.md' as NodeIdAndFilePath,
            terminalCount: 0,
            title: terminalId,
            agentName: terminalId,
            initialEnvVars,
        }),
        status: 'running',
        exitCode: null,
        exitSignal: null,
        killReason: null,
        auditRetryCount: 0,
        spawnedAt: 0,
    }
}

function makeDeps(params: {
    readonly sessions: readonly TmuxListedSession[]
    readonly envBySession?: ReadonlyMap<string, Record<string, string>>
    readonly records?: readonly TerminalRecord[]
    readonly currentNamespace?: string
    readonly throwForEnvSession?: string
}): ListUnclaimedTmuxDeps {
    return {
        listSessions: async () => params.sessions,
        getSessionEnvironment: async (sessionName: string) => {
            if (sessionName === params.throwForEnvSession) throw new Error('tmux env unavailable')
            return params.envBySession?.get(sessionName) ?? {}
        },
        getTerminalRecords: () => [...(params.records ?? [])],
        getCurrentNamespaceHash: async () => params.currentNamespace
            ? buildTmuxNamespaceHash(params.currentNamespace)
            : null,
    }
}

describe('unclaimed tmux discovery', () => {
    it('parses only Voicetree namespace-prefixed tmux sessions', () => {
        expect(parseVoicetreeTmuxSessionName('vt-0123abcd90-Ivy')).toEqual({
            hash: '0123abcd90',
            terminalId: 'Ivy',
        })
        expect(parseVoicetreeTmuxSessionName('manual-session')).toBeNull()
        expect(parseVoicetreeTmuxSessionName('vt-nothex-Ivy')).toBeNull()
    })

    it('lists unclaimed vt sessions, classifies by namespace hash, enriches env, and sorts newest first', async () => {
        const currentNamespace: string = '/repo/.voicetree'
        const foreignNamespace: string = '/other/.voicetree'
        const currentSession: string = buildTmuxSessionName('Ivy', {VOICETREE_PROJECT_DIR: currentNamespace})
        const foreignSession: string = buildTmuxSessionName('Jay', {VOICETREE_PROJECT_DIR: foreignNamespace})
        const nonVtSession: string = 'manual'
        const envBySession: Map<string, Record<string, string>> = new Map([
            [currentSession, {
                AGENT_NAME: 'Ivy',
                VOICETREE_PROJECT_PATH: '/repo/project',
                CONTEXT_NODE_PATH: '/repo/project/ctx.md',
                TASK_NODE_PATH: '/repo/project/task.md',
            }],
            [foreignSession, {
                AGENT_NAME: 'Jay',
                VOICETREE_PROJECT_PATH: '/other/project',
            }],
        ])

        const listed = await listUnclaimedTmuxSessions(makeDeps({
            currentNamespace,
            envBySession,
            sessions: [
                {sessionName: nonVtSession, createdAtSeconds: 300, panePid: 1},
                {sessionName: currentSession, createdAtSeconds: 100, panePid: 2},
                {sessionName: foreignSession, createdAtSeconds: 200, panePid: 3},
            ],
        }))

        expect(listed).toEqual([
            expect.objectContaining({
                sessionName: foreignSession,
                terminalId: 'Jay',
                classification: 'foreign-project',
                attachable: false,
                createdAt: 200000,
                panePid: 3,
                agentName: 'Jay',
                projectRoot: '/other/project',
            }),
            expect.objectContaining({
                sessionName: currentSession,
                terminalId: 'Ivy',
                classification: 'this-project',
                attachable: true,
                createdAt: 100000,
                panePid: 2,
                agentName: 'Ivy',
                projectRoot: '/repo/project',
                contextNodePath: '/repo/project/ctx.md',
                taskNodePath: '/repo/project/task.md',
            }),
        ])
    })

    it('filters sessions already represented by the registry, including sanitized tmux names', async () => {
        const currentNamespace: string = '/repo/.voicetree'
        const claimedTerminalId: string = '/repo/task.md-terminal-0'
        const claimedSession: string = buildTmuxSessionName(claimedTerminalId, {
            VOICETREE_PROJECT_DIR: currentNamespace,
        })
        const claimedByEnvTerminalId: string = '/repo/other task.md-terminal-1'
        const claimedByEnvSession: string = buildTmuxSessionName(claimedByEnvTerminalId, {
            VOICETREE_PROJECT_DIR: currentNamespace,
        })
        const unclaimedSession: string = buildTmuxSessionName('Ivy', {
            VOICETREE_PROJECT_DIR: currentNamespace,
        })

        const listed = await listUnclaimedTmuxSessions(makeDeps({
            currentNamespace,
            envBySession: new Map([
                [claimedByEnvSession, {VOICETREE_TERMINAL_ID: claimedByEnvTerminalId}],
            ]),
            records: [
                makeRecord(claimedTerminalId, {VOICETREE_PROJECT_DIR: currentNamespace}),
                makeRecord(claimedByEnvTerminalId),
            ],
            sessions: [
                {sessionName: claimedSession, createdAtSeconds: 100, panePid: 2},
                {sessionName: claimedByEnvSession, createdAtSeconds: 200, panePid: 3},
                {sessionName: unclaimedSession, createdAtSeconds: 300, panePid: 4},
            ],
        }))

        expect(listed.map((session) => session.sessionName)).toEqual([unclaimedSession])
    })

    it('uses VOICETREE_TERMINAL_ID as the canonical id when tmux session suffix is lossy', async () => {
        const currentNamespace: string = '/repo/.voicetree'
        const terminalId: string = '/repo/task with spaces.md-terminal-0'
        const sessionName: string = buildTmuxSessionName(terminalId, {
            VOICETREE_PROJECT_DIR: currentNamespace,
        })

        const listed = await listUnclaimedTmuxSessions(makeDeps({
            currentNamespace,
            envBySession: new Map([
                [sessionName, {VOICETREE_TERMINAL_ID: terminalId}],
            ]),
            sessions: [{sessionName, createdAtSeconds: 100, panePid: 2}],
        }))

        expect(listed).toEqual([
            expect.objectContaining({
                sessionName,
                terminalId,
            }),
        ])
    })

    it('keeps listing when tmux environment lookup fails and falls back to terminal id as agent name', async () => {
        const currentNamespace: string = '/repo/.voicetree'
        const sessionName: string = buildTmuxSessionName('Ivy', {VOICETREE_PROJECT_DIR: currentNamespace})

        const listed = await listUnclaimedTmuxSessions(makeDeps({
            currentNamespace,
            throwForEnvSession: sessionName,
            sessions: [{sessionName, createdAtSeconds: 100, panePid: 2}],
        }))

        expect(listed).toEqual([
            expect.objectContaining({
                sessionName,
                terminalId: 'Ivy',
                agentName: 'Ivy',
                classification: 'this-project',
            }),
        ])
    })

    it('kills only sessions that are still unclaimed', async () => {
        const sessionName: string = 'vt-1234567890-Ivy'
        const killSession = vi.fn(async (_sessionName: string): Promise<void> => undefined)
        const deps: KillUnclaimedTmuxDeps = {
            listUnclaimedTmuxSessions: async () => [],
            killSession,
        }

        await expect(killUnclaimedTmuxSession(sessionName, deps)).resolves.toEqual({
            success: false,
            error: 'Tmux session is already claimed or no longer exists',
        })
        expect(killSession).not.toHaveBeenCalled()

        const unclaimedSession: UnclaimedTmuxSession = {
            sessionName,
            terminalId: 'Ivy',
            hash: '1234567890',
            classification: 'this-project',
            attachable: true,
            createdAt: 1000,
            panePid: 123,
            agentName: 'Ivy',
        }
        const allowedDeps: KillUnclaimedTmuxDeps = {
            listUnclaimedTmuxSessions: async () => [unclaimedSession],
            killSession,
        }

        await expect(killUnclaimedTmuxSession(sessionName, allowedDeps)).resolves.toEqual({success: true})
        expect(killSession).toHaveBeenCalledWith(sessionName)
    })
})
