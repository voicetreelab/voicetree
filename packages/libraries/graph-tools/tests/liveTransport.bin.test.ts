// Step 9d — vt-headless bin integration.
//
// Spawns the real `vt-headless serve` binary, parses the announced
// `Listening on http://…` URL, then exercises a live `createLiveTransport`
// round-trip against the spawned daemon. Verifies the bin wrote `rpc.port`
// and `auth-token` into the vault so the client's standard discovery chain
// resolves correctly.

import {mkdtemp, readFile, realpath, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {createLiveTransport} from '../src/live/liveTransport'

import {
    restoreEnv,
    snapshotEnv,
    spawnVtHeadless,
    type SpawnedHeadless,
} from './_fixtures/liveTransportHarness'

describe('vt-headless serve — bin integration', () => {
    let envSnapshot: Record<string, string | undefined>
    let vaultPath: string
    let headless: SpawnedHeadless | null

    beforeEach(async () => {
        envSnapshot = snapshotEnv()
        vaultPath = await realpath(await mkdtemp(join(tmpdir(), 'vt-headless-bin-')))
        headless = null
    })

    afterEach(async () => {
        if (headless) await headless.stop()
        await rm(vaultPath, {recursive: true, force: true})
        restoreEnv(envSnapshot)
    })

    it('announces an http URL and serves /rpc to a real liveTransport call', async () => {
        headless = await spawnVtHeadless(vaultPath)
        expect(headless.url.startsWith('http://')).toBe(true)

        // The bin wrote vault discovery files.
        const portText: string = await readFile(join(vaultPath, '.voicetree', 'rpc.port'), 'utf8')
        expect(Number.parseInt(portText.trim(), 10)).toBeGreaterThan(0)
        const tokenText: string = await readFile(join(vaultPath, '.voicetree', 'auth-token'), 'utf8')
        expect(tokenText.trim().length).toBeGreaterThan(0)

        process.env.VOICETREE_PROJECT_PATH = vaultPath
        const transport = createLiveTransport()
        const state = await transport.getLiveState()
        // Empty headless vault: schemaVersion 1, revision 0, no nodes.
        expect(state.meta.schemaVersion).toBe(1)
        expect(state.meta.revision).toBe(0)
        expect(Object.keys(state.graph.nodes).length).toBe(0)
    }, 30_000)
})
