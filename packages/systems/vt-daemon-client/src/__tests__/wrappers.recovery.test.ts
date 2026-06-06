/**
 * Black-box integration test for the `recovery` wrapper facade
 * (3 routes: discoverRecoverableAgentSessions, resumePersistedAgentSession,
 * forkAgentSession). Real loopback HTTP server + real JSON-RPC wire.
 */

import {Option} from 'fp-ts/lib/Option.js'
import * as O from 'fp-ts/lib/Option.js'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import type {NodeIdAndFilePath} from '@vt/graph-model/graph'
import type {
    ForkAgentSessionResult,
    RecoverableAgentSession,
    ResumePersistedResult,
    TerminalData,
    TerminalId,
    UnclaimedTmuxSession,
} from '@vt/vt-daemon-protocol'

import {bindVtDaemonClient} from '../wrappers/index.ts'
import {startFakeRpcServer, type FakeRpcServerHandle} from './fixtures/fakeRpcServer.ts'

function makeTerminalData(id: string): TerminalData {
    const noneOption: Option<NodeIdAndFilePath> = O.none
    return {
        type: 'Terminal',
        terminalId: id as TerminalId,
        attachedToContextNodeId: '/ctx.md' as NodeIdAndFilePath,
        terminalCount: 1,
        anchoredToNodeId: noneOption,
        title: id,
        resizable: true,
        shadowNodeDimensions: {width: 100, height: 100},
        isPinned: false,
        isDone: false,
        lifecycle: 'completed',
        statusPhrase: '',
        lastOutputTime: 0,
        activityCount: 0,
        parentTerminalId: null,
        agentName: id,
        worktreeName: undefined,
        isHeadless: false,
        isMinimized: false,
        contextContent: '',
        agentTypeName: 'claude',
    }
}

describe('vt-daemon-client wrappers — recovery facade', (): void => {
    let server: FakeRpcServerHandle
    const attachSession: UnclaimedTmuxSession = {
        sessionName: 'voicetree-recover-1',
        terminalId: 'recover-1',
        hash: 'aaaaaaaaaa',
        classification: 'this-project',
        attachable: true,
        createdAt: 1_700_000_000_000,
        panePid: 4242,
        agentName: 'agent-recover-1',
        projectRoot: '/var/voicetree',
    }

    const sessionRows: readonly RecoverableAgentSession[] = [
        {
            terminalId: 'recover-1' as TerminalId,
            agentName: 'agent-recover-1',
            metadataPath: '/var/voicetree/recover-1.json',
            terminalData: makeTerminalData('recover-1'),
            isClaimed: false,
            status: 'running',
            attach: {session: attachSession},
            resume: {cliType: 'claude'},
        },
    ]
    const resumeResult: ResumePersistedResult = {kind: 'spawned', pid: 4242, command: 'claude --resume', terminalData: makeTerminalData('resume-1')}
    const forkResult: ForkAgentSessionResult = {
        kind: 'spawned',
        forkedTerminalId: 'forked-1' as TerminalId,
        pid: 4243,
        command: 'claude --resume --fork',
        terminalData: makeTerminalData('forked-1'),
    }

    beforeEach(async (): Promise<void> => {
        server = await startFakeRpcServer({
            discoverRecoverableAgentSessions: () => sessionRows,
            resumePersistedAgentSession: () => resumeResult,
            forkAgentSession: () => forkResult,
        })
    })

    afterEach(async (): Promise<void> => {
        await server.stop()
    })

    it('discoverRecoverableAgentSessions returns the typed session rows', async (): Promise<void> => {
        const vtd = bindVtDaemonClient(server.client)
        const sessions = await vtd.recovery.discoverRecoverableAgentSessions()
        expect(sessions).toHaveLength(1)
        expect(sessions[0].terminalId).toBe('recover-1')
        expect(sessions[0].attach?.session.sessionName).toBe('voicetree-recover-1')
        expect(sessions[0].attach?.session.classification).toBe('this-project')
        expect(sessions[0].resume?.cliType).toBe('claude')
        expect(server.received[0].method).toBe('discoverRecoverableAgentSessions')
        expect(server.received[0].params).toEqual({})
    })

    it('resumePersistedAgentSession threads the {kind:"spawned",pid,command} response', async (): Promise<void> => {
        const vtd = bindVtDaemonClient(server.client)
        const result = await vtd.recovery.resumePersistedAgentSession({
            terminalId: 'recover-1' as TerminalId,
        })
        expect(result).toEqual(resumeResult)
        expect(server.received[0].method).toBe('resumePersistedAgentSession')
        expect(server.received[0].params).toEqual({terminalId: 'recover-1'})
    })

    it('forkAgentSession returns the typed fork-result discriminated union', async (): Promise<void> => {
        const vtd = bindVtDaemonClient(server.client)
        const result = await vtd.recovery.forkAgentSession({
            sourceTerminalId: 'recover-1' as TerminalId,
        })
        expect(result).toEqual(forkResult)
        if (result.kind === 'spawned') {
            expect(result.forkedTerminalId).toBe('forked-1')
            expect(result.pid).toBe(4243)
        } else {
            throw new Error('expected spawned outcome')
        }
        expect(server.received[0].method).toBe('forkAgentSession')
        expect(server.received[0].params).toEqual({sourceTerminalId: 'recover-1'})
    })
})
