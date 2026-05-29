// Step 9d — HTTP round-trip for createLiveTransport (client side).
// Bin integration lives in liveTransport.bin.test.ts (separate file so each
// stays under the file-size hook). Shared fixtures: _fixtures/liveTransportHarness.

import {mkdir, mkdtemp, realpath, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {writeAuthTokenFile, writeRpcPortFile} from '@vt/vt-rpc'

import {
    CatalogValidationError,
    type Catalog,
    type ToolResult,
} from '../../src/live/headlessServer'
import {
    createLiveTransport,
    DaemonAuthRequired,
    DaemonUnreachable,
} from '../../src/live/liveTransport'

import {
    FIXTURE_SERIALIZED_STATE,
    SAMPLE_NODE,
    TASKS_FOLDER,
    VAULT_ROOT,
    buildHappyCatalog,
    initialMockServer,
    restoreEnv,
    snapshotEnv,
    startStubDaemon,
    type MockServer,
    type StubDaemon,
} from '../_fixtures/liveTransportHarness'

// ── happy path ─────────────────────────────────────────────────────────────

describe('createLiveTransport — happy path over HTTP', () => {
    let envSnapshot: Record<string, string | undefined>
    let daemon: StubDaemon
    let mock: MockServer

    beforeEach(async () => {
        envSnapshot = snapshotEnv()
        mock = initialMockServer()
        daemon = await startStubDaemon(buildHappyCatalog(mock))
        process.env.VOICETREE_PROJECT_PATH = daemon.projectPath
    })

    afterEach(async () => {
        await daemon.stop()
        await rm(daemon.projectPath, {recursive: true, force: true})
        restoreEnv(envSnapshot)
    })

    it('getLiveState() returns a hydrated State via HTTP JSON-RPC', async () => {
        const transport = createLiveTransport()
        const state = await transport.getLiveState()

        expect(state.meta.revision).toBe(3)
        expect(state.meta.schemaVersion).toBe(1)
        expect(state.roots.loaded.has(VAULT_ROOT)).toBe(true)
        expect(state.collapseSet.size).toBe(0)
        expect(Object.keys(state.graph.nodes)).toContain(SAMPLE_NODE)
        expect(state.layout.positions.get(SAMPLE_NODE)).toEqual({x: 1, y: 2})
    })

    it('dispatchLiveCommand(SetFolderState) returns Delta with collapseAdded', async () => {
        const transport = createLiveTransport()
        const delta = await transport.dispatchLiveCommand({
            type: 'SetFolderState',
            viewId: 'main',
            path: TASKS_FOLDER.slice(0, -1),
            state: 'collapsed',
        })

        expect(delta.revision).toBe(4)
        expect(delta.collapseAdded).toContain(TASKS_FOLDER)
        expect(delta.cause).toEqual({
            type: 'SetFolderState',
            viewId: 'main',
            path: TASKS_FOLDER.slice(0, -1),
            state: 'collapsed',
        })
    })

    it('dispatchLiveCommand preserves layoutChanged from the daemon delta', async () => {
        const transport = createLiveTransport()
        const delta = await transport.dispatchLiveCommand({type: 'SetZoom', zoom: 1.45})

        expect(delta.revision).toBe(4)
        expect(delta.layoutChanged).toEqual({zoom: 1.45})
        expect(delta.cause).toEqual({type: 'SetZoom', zoom: 1.45})
    })

    it('round-trip: dispatch then re-read sees the mutation', async () => {
        const transport = createLiveTransport()
        const before = await transport.getLiveState()
        expect(before.collapseSet.size).toBe(0)

        await transport.dispatchLiveCommand({
            type: 'SetFolderState',
            viewId: 'main',
            path: TASKS_FOLDER.slice(0, -1),
            state: 'collapsed',
        })

        const after = await transport.getLiveState()
        expect(after.collapseSet.has(TASKS_FOLDER)).toBe(true)
        expect(after.meta.revision).toBeGreaterThan(before.meta.revision)
    })

    it('honors an explicit projectPath argument (no cwd up-walk needed)', async () => {
        delete process.env.VOICETREE_PROJECT_PATH
        const transport = createLiveTransport(daemon.projectPath)
        const state = await transport.getLiveState()
        expect(state.meta.revision).toBe(3)
    })
})

// ── error envelopes (mapping harmonized with 9c daemon-client) ─────────────

describe('createLiveTransport — error envelopes', () => {
    let envSnapshot: Record<string, string | undefined>
    let daemon: StubDaemon | null

    beforeEach(() => {
        envSnapshot = snapshotEnv()
        daemon = null
    })

    afterEach(async () => {
        if (daemon) {
            await daemon.stop()
            await rm(daemon.projectPath, {recursive: true, force: true})
        }
        restoreEnv(envSnapshot)
    })

    it('-32003 tool_handler_failed → Error with JSON.stringify(error.data)', async () => {
        const catalog: Catalog = new Map([
            ['vt_get_live_state', async (): Promise<ToolResult> => ({
                ok: false,
                payload: {error: 'Requires an Electron renderer'},
            })],
        ])
        daemon = await startStubDaemon(catalog)
        process.env.VOICETREE_PROJECT_PATH = daemon.projectPath

        const transport = createLiveTransport()
        await expect(transport.getLiveState()).rejects.toThrow(
            /\{"error":"Requires an Electron renderer"\}/,
        )
    })

    it('-32602 validation_failed → Error whose message parses back to kind:validation_failed', async () => {
        const catalog: Catalog = new Map([
            ['vt_get_live_state', async () => {
                throw new CatalogValidationError('vt_get_live_state', [
                    {path: 'viewId', message: 'Required', code: 'invalid_type'},
                ])
            }],
        ])
        daemon = await startStubDaemon(catalog)
        process.env.VOICETREE_PROJECT_PATH = daemon.projectPath

        const transport = createLiveTransport()
        try {
            await transport.getLiveState()
            expect.unreachable('should have thrown')
        } catch (err) {
            expect(err).toBeInstanceOf(Error)
            const parsed: unknown = JSON.parse((err as Error).message)
            expect(parsed).toMatchObject({kind: 'validation_failed', tool: 'vt_get_live_state'})
        }
    })

    it('other JSON-RPC errors surface error.message (unknown method)', async () => {
        daemon = await startStubDaemon(new Map())
        process.env.VOICETREE_PROJECT_PATH = daemon.projectPath

        const transport = createLiveTransport()
        await expect(transport.getLiveState()).rejects.toThrow(
            /Unknown method: vt_get_live_state/,
        )
    })
})

// ── transport failures ─────────────────────────────────────────────────────

describe('createLiveTransport — transport failures', () => {
    let envSnapshot: Record<string, string | undefined>
    let daemon: StubDaemon | null

    beforeEach(() => {
        envSnapshot = snapshotEnv()
        daemon = null
    })

    afterEach(async () => {
        if (daemon) {
            await daemon.stop()
            await rm(daemon.projectPath, {recursive: true, force: true})
        }
        restoreEnv(envSnapshot)
    })

    it("401 bad token → DaemonAuthRequired (no retry — 9c's concern)", async () => {
        const catalog: Catalog = new Map([
            ['vt_get_live_state', async (): Promise<ToolResult> => ({ok: true, payload: FIXTURE_SERIALIZED_STATE})],
        ])
        daemon = await startStubDaemon(catalog)
        // Stale the on-disk token so the client sends a mismatched bearer
        // and the daemon (which still holds the original) rejects with 401.
        await writeAuthTokenFile(daemon.projectPath, 'wrong-token-not-the-real-one')
        process.env.VOICETREE_PROJECT_PATH = daemon.projectPath

        const transport = createLiveTransport()
        await expect(transport.getLiveState()).rejects.toBeInstanceOf(DaemonAuthRequired)
    })

    it('timeout exceeded → DaemonUnreachable; underlying fetch aborts', async () => {
        // Daemon stalls 5s; client times out at 100ms. If abort works, the
        // assertion resolves well before the 2s vitest timeout below.
        const catalog: Catalog = new Map([
            ['vt_get_live_state', async (): Promise<ToolResult> => {
                await new Promise<void>((r) => {
                    const t = setTimeout(r, 5_000)
                    t.unref()
                })
                return {ok: true, payload: FIXTURE_SERIALIZED_STATE}
            }],
        ])
        daemon = await startStubDaemon(catalog)
        process.env.VOICETREE_PROJECT_PATH = daemon.projectPath
        process.env.VOICETREE_DAEMON_TIMEOUT_MS = '100'

        const transport = createLiveTransport()
        const startedAt: number = Date.now()
        await expect(transport.getLiveState()).rejects.toBeInstanceOf(DaemonUnreachable)
        expect(Date.now() - startedAt).toBeLessThan(1_000) // proves abort, not 5s wait
    }, 2_000)

    it('ECONNREFUSED → DaemonUnreachable', async () => {
        const projectPath: string = await realpath(await mkdtemp(join(tmpdir(), 'vt-noport-')))
        await mkdir(join(projectPath, '.voicetree'), {recursive: true})
        await writeAuthTokenFile(projectPath, 'irrelevant-no-listener-anyway')
        // Port 1 is reserved on most OSes — TCP connect rejects with ECONNREFUSED.
        await writeRpcPortFile(projectPath, 1)
        process.env.VOICETREE_PROJECT_PATH = projectPath

        try {
            const transport = createLiveTransport()
            await expect(transport.getLiveState()).rejects.toBeInstanceOf(DaemonUnreachable)
        } finally {
            await rm(projectPath, {recursive: true, force: true})
        }
    })
})

// ── discovery chain (design doc §2.7) ──────────────────────────────────────

describe('createLiveTransport — discovery chain', () => {
    let envSnapshot: Record<string, string | undefined>
    let daemon: StubDaemon | null
    let cwdSnapshot: string

    beforeEach(() => {
        envSnapshot = snapshotEnv()
        cwdSnapshot = process.cwd()
        daemon = null
    })

    afterEach(async () => {
        process.chdir(cwdSnapshot)
        if (daemon) {
            await daemon.stop()
            await rm(daemon.projectPath, {recursive: true, force: true})
        }
        restoreEnv(envSnapshot)
    })

    it('VOICETREE_DAEMON_URL wins over a stale project rpc.port', async () => {
        // Live daemon at A; misleading rpc.port at B pointing at port 2.
        const catalog: Catalog = new Map([
            ['vt_get_live_state', async (): Promise<ToolResult> => ({
                ok: true,
                payload: {
                    ...FIXTURE_SERIALIZED_STATE,
                    meta: {...FIXTURE_SERIALIZED_STATE.meta, revision: 99},
                },
            })],
        ])
        daemon = await startStubDaemon(catalog)

        const fakeVault: string = await realpath(await mkdtemp(join(tmpdir(), 'vt-fake-')))
        await mkdir(join(fakeVault, '.voicetree'), {recursive: true})
        await writeRpcPortFile(fakeVault, 2)
        await writeAuthTokenFile(fakeVault, 'stale-token')

        try {
            // Env URL aimed at the real daemon; VAULT_PATH at the real project
            // (so the client reads the *correct* token, not the stale one).
            process.env.VOICETREE_DAEMON_URL = daemon.url
            process.env.VOICETREE_PROJECT_PATH = daemon.projectPath

            const state = await createLiveTransport().getLiveState()
            expect(state.meta.revision).toBe(99)
        } finally {
            await rm(fakeVault, {recursive: true, force: true})
        }
    })

    it('project rpc.port resolves when VOICETREE_DAEMON_URL is absent', async () => {
        const catalog: Catalog = new Map([
            ['vt_get_live_state', async (): Promise<ToolResult> => ({ok: true, payload: FIXTURE_SERIALIZED_STATE})],
        ])
        daemon = await startStubDaemon(catalog)

        delete process.env.VOICETREE_DAEMON_URL
        process.env.VOICETREE_PROJECT_PATH = daemon.projectPath

        const state = await createLiveTransport().getLiveState()
        expect(state.meta.revision).toBe(3)
    })

    it('throws DaemonUnreachable when nothing resolves', async () => {
        const isolated: string = await realpath(await mkdtemp(join(tmpdir(), 'vt-no-project-')))
        try {
            delete process.env.VOICETREE_DAEMON_URL
            delete process.env.VOICETREE_PROJECT_PATH
            process.chdir(isolated)

            const transport = createLiveTransport()
            await expect(transport.getLiveState()).rejects.toBeInstanceOf(DaemonUnreachable)
        } finally {
            await rm(isolated, {recursive: true, force: true})
        }
    })
})
