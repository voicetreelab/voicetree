/**
 * BF-188 — integration test for vt-headless serve (Step 7c, UDS).
 *
 * Boots the headless UDS daemon in-process on a temp socket and verifies
 * createLiveTransport round-trips state + commands. No HTTP port.
 */
import {mkdtemp, realpath, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, it, expect, afterEach, beforeEach} from 'vitest'
import {createHeadlessServer, type HeadlessServer} from '../src/live/headlessServer'
import {createLiveTransport} from '../src/live/liveTransport'

describe('vt-headless serve (UDS)', () => {
    let workDir: string
    let envSock: string | undefined

    beforeEach(async () => {
        envSock = process.env.VOICETREE_SOCK_PATH
        workDir = await realpath(await mkdtemp(join(tmpdir(), 'vt-headless-')))
    })

    afterEach(async () => {
        await rm(workDir, {recursive: true, force: true})
        if (envSock === undefined) delete process.env.VOICETREE_SOCK_PATH
        else process.env.VOICETREE_SOCK_PATH = envSock
    })

    async function startServer(name: string): Promise<HeadlessServer> {
        return createHeadlessServer({socketPath: join(workDir, `${name}.sock`)})
    }

    it('boots on a UDS socket and responds to vt_get_live_state', async () => {
        const server = await startServer('server')
        try {
            expect(server.socketPath.endsWith('.sock')).toBe(true)

            process.env.VOICETREE_SOCK_PATH = server.socketPath
            const transport = createLiveTransport()
            const state = await transport.getLiveState()

            expect(state.meta.schemaVersion).toBe(1)
            expect(state.meta.revision).toBe(0)
            expect(Object.keys(state.graph.nodes).length).toBe(0)
            expect(state.collapseSet.size).toBe(0)
        } finally {
            await server.close()
        }
    })

    it('dispatchLiveCommand(SetFolderState) returns Delta with collapseAdded + bumped revision', async () => {
        const server = await startServer('server')
        try {
            process.env.VOICETREE_SOCK_PATH = server.socketPath
            const transport = createLiveTransport()
            const FOLDER = '/tmp/test-headless/tasks/'

            const delta = await transport.dispatchLiveCommand({
                type: 'SetFolderState',
                viewId: 'main',
                path: FOLDER.slice(0, -1),
                state: 'collapsed',
            })

            expect(delta.revision).toBe(1)
            expect(delta.collapseAdded).toContain(FOLDER)
        } finally {
            await server.close()
        }
    })

    it('round-trip: SetFolderState → getLiveState reflects collapse and bumped revision', async () => {
        const server = await startServer('server')
        try {
            process.env.VOICETREE_SOCK_PATH = server.socketPath
            const transport = createLiveTransport()
            const FOLDER = '/tmp/test-headless/tasks/'

            const stateBefore = await transport.getLiveState()
            expect(stateBefore.collapseSet.size).toBe(0)
            const revBefore = stateBefore.meta.revision

            await transport.dispatchLiveCommand({
                type: 'SetFolderState',
                viewId: 'main',
                path: FOLDER.slice(0, -1),
                state: 'collapsed',
            })

            const stateAfter = await transport.getLiveState()
            expect(stateAfter.collapseSet.has(FOLDER)).toBe(true)
            expect(stateAfter.meta.revision).toBeGreaterThan(revBefore)
        } finally {
            await server.close()
        }
    })

    it('two concurrent servers bind distinct sockets — mutations are isolated', async () => {
        const srv1 = await startServer('one')
        const srv2 = await startServer('two')
        try {
            expect(srv1.socketPath).not.toBe(srv2.socketPath)

            process.env.VOICETREE_SOCK_PATH = srv1.socketPath
            const t1 = createLiveTransport()
            process.env.VOICETREE_SOCK_PATH = srv2.socketPath
            const t2 = createLiveTransport()

            const [s1, s2] = await Promise.all([t1.getLiveState(), t2.getLiveState()])
            expect(s1.meta.revision).toBe(0)
            expect(s2.meta.revision).toBe(0)

            await t1.dispatchLiveCommand({
                type: 'SetFolderState',
                viewId: 'main',
                path: '/tmp/test-headless/tasks',
                state: 'collapsed',
            })

            const [s1After, s2After] = await Promise.all([t1.getLiveState(), t2.getLiveState()])
            expect(s1After.collapseSet.size).toBe(1)
            expect(s2After.collapseSet.size).toBe(0)
        } finally {
            await Promise.all([srv1.close(), srv2.close()])
        }
    })
})
