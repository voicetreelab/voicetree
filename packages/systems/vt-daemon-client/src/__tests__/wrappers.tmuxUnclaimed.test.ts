/**
 * Black-box integration test for the `tmuxUnclaimed` wrapper facade
 * (3 routes: list / attach / kill). Real loopback HTTP server + real
 * JSON-RPC wire.
 */

import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import type {
    AttachUnclaimedTmuxResult,
    KillUnclaimedTmuxResult,
    UnclaimedTmuxSession,
} from '@vt/vt-daemon-protocol'

import {bindVtDaemonClient} from '../wrappers/index.ts'
import {startFakeRpcServer, type FakeRpcServerHandle} from './fixtures/fakeRpcServer.ts'

describe('vt-daemon-client wrappers — tmuxUnclaimed facade', (): void => {
    let server: FakeRpcServerHandle

    const sessions: readonly UnclaimedTmuxSession[] = [
        {
            sessionName: 'voicetree-orphan-1',
            terminalId: 'orphan-1',
            hash: 'deadbeef',
            classification: 'this-vault',
            attachable: true,
            createdAt: 1700000000000,
            panePid: 999,
            agentName: 'orphan-1',
        },
    ]
    const attachResult: AttachUnclaimedTmuxResult = {
        success: true,
        terminalId: 'attached-1',
    }
    const killResult: KillUnclaimedTmuxResult = {success: true}

    beforeEach(async (): Promise<void> => {
        server = await startFakeRpcServer({
            listUnclaimedTmuxSessions: () => sessions,
            attachUnclaimedTmuxSession: () => attachResult,
            killUnclaimedTmuxSession: () => killResult,
        })
    })

    afterEach(async (): Promise<void> => {
        await server.stop()
    })

    it('listUnclaimedTmuxSessions returns the typed array of UnclaimedTmuxSession', async (): Promise<void> => {
        const vtd = bindVtDaemonClient(server.client)
        const result = await vtd.tmuxUnclaimed.listUnclaimedTmuxSessions()
        expect(result).toHaveLength(1)
        expect(result[0].sessionName).toBe('voicetree-orphan-1')
        expect(result[0].classification).toBe('this-vault')
        expect(server.received[0].method).toBe('listUnclaimedTmuxSessions')
        expect(server.received[0].params).toEqual({})
    })

    it('attachUnclaimedTmuxSession threads {success, terminalId} through', async (): Promise<void> => {
        const vtd = bindVtDaemonClient(server.client)
        const result = await vtd.tmuxUnclaimed.attachUnclaimedTmuxSession({
            sessionName: 'voicetree-orphan-1',
        })
        expect(result).toEqual(attachResult)
        expect(server.received[0].method).toBe('attachUnclaimedTmuxSession')
        expect(server.received[0].params).toEqual({sessionName: 'voicetree-orphan-1'})
    })

    it('killUnclaimedTmuxSession returns {success: true}', async (): Promise<void> => {
        const vtd = bindVtDaemonClient(server.client)
        const result = await vtd.tmuxUnclaimed.killUnclaimedTmuxSession({
            sessionName: 'voicetree-orphan-1',
        })
        expect(result).toEqual(killResult)
        expect(server.received[0].method).toBe('killUnclaimedTmuxSession')
        expect(server.received[0].params).toEqual({sessionName: 'voicetree-orphan-1'})
    })
})
