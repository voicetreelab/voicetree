// Step 9d — in-process integration for vt-headless serve.
//
// Boots `createHeadlessServer` against a per-test temp vault (where it
// writes `rpc.port` + `auth-token` atomically), then drives
// `createLiveTransport` through real HTTP.

import {mkdtemp, realpath, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {createHeadlessServer, type HeadlessServer} from '../../src/live/headlessServer'
import {createLiveTransport} from '../../src/live/liveTransport'

const TRACKED_ENV_KEYS: readonly string[] = ['VOICETREE_DAEMON_URL', 'VOICETREE_PROJECT_PATH']

function snapshotEnv(): Record<string, string | undefined> {
    const snap: Record<string, string | undefined> = {}
    for (const key of TRACKED_ENV_KEYS) snap[key] = process.env[key]
    return snap
}

function restoreEnv(snap: Record<string, string | undefined>): void {
    for (const key of TRACKED_ENV_KEYS) {
        const value = snap[key]
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
}

describe('vt-headless serve (HTTP)', () => {
    let envSnapshot: Record<string, string | undefined>
    let vaults: string[]

    beforeEach(() => {
        envSnapshot = snapshotEnv()
        vaults = []
    })

    afterEach(async () => {
        restoreEnv(envSnapshot)
        for (const vault of vaults.splice(0)) {
            await rm(vault, {recursive: true, force: true})
        }
    })

    async function startServer(): Promise<HeadlessServer> {
        const vaultPath: string = await realpath(await mkdtemp(join(tmpdir(), 'vt-headless-')))
        vaults.push(vaultPath)
        return createHeadlessServer({vaultPath})
    }

    it('boots on an HTTP port and responds to vt_get_live_state', async () => {
        const server = await startServer()
        try {
            expect(server.url.startsWith('http://')).toBe(true)
            expect(server.port).toBeGreaterThan(0)
            expect(server.token.length).toBeGreaterThan(0)

            process.env.VOICETREE_PROJECT_PATH = server.vaultPath
            const state = await createLiveTransport().getLiveState()

            expect(state.meta.schemaVersion).toBe(1)
            expect(state.meta.revision).toBe(0)
            expect(Object.keys(state.graph.nodes).length).toBe(0)
            expect(state.collapseSet.size).toBe(0)
        } finally {
            await server.close()
        }
    })

    it('dispatchLiveCommand(SetFolderState) returns Delta with collapseAdded + bumped revision', async () => {
        const server = await startServer()
        try {
            process.env.VOICETREE_PROJECT_PATH = server.vaultPath
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

    it('round-trip: SetFolderState → getLiveState reflects collapse + bumped revision', async () => {
        const server = await startServer()
        try {
            process.env.VOICETREE_PROJECT_PATH = server.vaultPath
            const transport = createLiveTransport()
            const FOLDER = '/tmp/test-headless/tasks/'

            const before = await transport.getLiveState()
            expect(before.collapseSet.size).toBe(0)

            await transport.dispatchLiveCommand({
                type: 'SetFolderState',
                viewId: 'main',
                path: FOLDER.slice(0, -1),
                state: 'collapsed',
            })

            const after = await transport.getLiveState()
            expect(after.collapseSet.has(FOLDER)).toBe(true)
            expect(after.meta.revision).toBeGreaterThan(before.meta.revision)
        } finally {
            await server.close()
        }
    })

    it('two concurrent servers bind distinct ports — mutations are isolated', async () => {
        const srv1 = await startServer()
        const srv2 = await startServer()
        try {
            expect(srv1.port).not.toBe(srv2.port)
            expect(srv1.token).not.toBe(srv2.token)

            process.env.VOICETREE_PROJECT_PATH = srv1.vaultPath
            const t1 = createLiveTransport()
            process.env.VOICETREE_PROJECT_PATH = srv2.vaultPath
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
