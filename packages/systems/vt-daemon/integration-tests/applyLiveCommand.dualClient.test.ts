// BF-379 — the C4 principle, made executable.
//
// Anything VTD owns must be reachable identically by every client. Electron
// Main and the CLI are just two clients. This test boots the full daemon
// stack (real vt-graphd + real vt-daemon HTTP server) against a tmpdir
// vault, constructs two JSON-RPC clients via `createRpcClientForProject` (the
// same constructor both Main and CLI use), and asserts that:
//
//   1. A Move dispatched on one client lands at revision 1 with the post-state
//      visible to the other client's `vt_get_live_state`.
//   2. Two no-op reads from different clients return byte-identical
//      `SerializedState` envelopes.
//   3. A malformed command is rejected with the same JSON-RPC validation
//      error shape on both clients.
//
// No internal mocks: real HTTP, real fetch, real tmpdir vault. The harness
// here mirrors `bin/vt-mcpd.ts` minus the agent-runtime tmux wiring — the
// live-state surface does not require terminal management.

import {beforeAll, afterAll, describe, expect, it} from 'vitest'
import {mkdir, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {createEmptyGraph} from '@vt/graph-model'
import {saveVaultConfigForDirectory} from '@vt/app-config/vault-config'
import {setGraph} from '@vt/graph-db-server/state/graph-store'
import {clearWatchFolderState} from '@vt/graph-db-server/state/watch-folder-store'
import {startDaemon, type DaemonHandle} from '@vt/graph-db-server/server'
import {createRpcClientForProject, generateAuthToken, writeAuthTokenFile, writeRpcPortFile, type DaemonRpcClient, type JsonRpcResponse} from '@vt/vt-rpc'
import type {SerializedCommand} from '@vt/graph-state'

import {buildDefaultToolCatalog} from '../src/transport/toolCatalog.ts'
import {setCurrentVault} from '../src/state/currentVault.ts'
import {startHttpDaemonServer, type HttpDaemonServerHandle} from '../src/transport/httpServer.ts'
import {__resetSessionStateForTests} from '../src/state/sessionStateStore.ts'
import {buildDisabledMcpBridges} from './__helpers__/disabledMcpBridges.ts'

interface FullStack {
    readonly vault: string
    readonly fixtureNodeId: string
    readonly graphd: DaemonHandle
    readonly rpc: HttpDaemonServerHandle
    readonly stop: () => Promise<void>
}

const FIXTURE_BASENAME: string = 'fixture.md'

async function startFullStack(): Promise<FullStack> {
    const root: string = await realpath(await mkdtemp(join(tmpdir(), 'vt-dualclient-')))
    const voicetreeHomePath: string = join(root, 'app-support')
    const vault: string = join(root, 'vault')
    await mkdir(voicetreeHomePath, {recursive: true})
    await mkdir(vault, {recursive: true})
    process.env.VOICETREE_HOME_PATH = voicetreeHomePath
    clearWatchFolderState()
    setGraph(createEmptyGraph())

    const fixturePath: string = join(vault, FIXTURE_BASENAME)
    await writeFile(fixturePath, '# fixture\n', 'utf-8')
    await saveVaultConfigForDirectory(vault, {writeFolder: '.'})

    const graphd: DaemonHandle = await startDaemon({
        vault,
        voicetreeHomePath,
        createStarterIfEmpty: false,
    })

    setCurrentVault(vault)

    const token: string = generateAuthToken()
    await writeAuthTokenFile(vault, token)

    const rpc: HttpDaemonServerHandle = await startHttpDaemonServer({
        catalog: buildDefaultToolCatalog(buildDisabledMcpBridges()),
        hookHandler: (): unknown => ({ok: true}),
        token,
        bindHost: '127.0.0.1',
        logger: {logRequest: (): void => {}, logError: (): void => {}},
    })
    await writeRpcPortFile(vault, rpc.port)

    return {
        vault,
        fixtureNodeId: fixturePath,
        graphd,
        rpc,
        stop: async (): Promise<void> => {
            __resetSessionStateForTests()
            setCurrentVault(null)
            await rpc.stop().catch((): void => {})
            await graphd.stop().catch((): void => {})
            clearWatchFolderState()
            setGraph(createEmptyGraph())
            await rm(root, {recursive: true, force: true})
        },
    }
}

// Polls vt-graphd until its in-memory graph reflects the on-disk fixture;
// chokidar's discovery is async even after `startDaemon` resolves.
async function waitForFixtureIndexed(client: DaemonRpcClient, fixtureNodeId: string): Promise<void> {
    const deadline: number = Date.now() + 5000
    while (Date.now() < deadline) {
        // Force a re-bootstrap so we re-read graphd until it has the file.
        __resetSessionStateForTests()
        const res: JsonRpcResponse = await client.call('vt_get_live_state', {})
        if ('result' in res) {
            const state: {graph: {nodes: Record<string, unknown>}} = res.result as {graph: {nodes: Record<string, unknown>}}
            if (Object.prototype.hasOwnProperty.call(state.graph.nodes, fixtureNodeId)) {
                return
            }
        }
        await new Promise<void>((r) => setTimeout(r, 50))
    }
    throw new Error(`fixture node ${fixtureNodeId} not indexed by vt-graphd within 5s`)
}

describe('vt_dispatch_live_command + vt_get_live_state — identical client surface (C4)', (): void => {
    let stack: FullStack
    let clientMain: DaemonRpcClient
    let clientCli: DaemonRpcClient

    beforeAll(async (): Promise<void> => {
        stack = await startFullStack()
        clientMain = await createRpcClientForProject(stack.vault, {env: process.env})
        clientCli = await createRpcClientForProject(stack.vault, {env: process.env})
        await waitForFixtureIndexed(clientMain, stack.fixtureNodeId)
    }, 30_000)

    afterAll(async (): Promise<void> => {
        await stack.stop()
    })

    it('Main-as-client Move surfaces to CLI-as-client get_live_state with revision 1', async (): Promise<void> => {
        const moveCommand: SerializedCommand = {
            type: 'Move',
            id: stack.fixtureNodeId,
            to: {x: 42, y: 84},
        }
        const dispatchResponse: JsonRpcResponse = await clientMain.call(
            'vt_dispatch_live_command',
            {command: moveCommand as unknown as Record<string, unknown>},
        )
        if ('error' in dispatchResponse) {
            throw new Error(`dispatch unexpectedly failed: ${JSON.stringify(dispatchResponse.error)}`)
        }
        const dispatchResult: {delta: {revision: number}; revision: number} = dispatchResponse.result as {
            delta: {revision: number}
            revision: number
        }
        expect(dispatchResult.revision).toBe(1)
        expect(dispatchResult.delta.revision).toBe(1)

        const readResponse: JsonRpcResponse = await clientCli.call('vt_get_live_state', {})
        if ('error' in readResponse) {
            throw new Error(`read unexpectedly failed: ${JSON.stringify(readResponse.error)}`)
        }
        const state: {
            meta: {revision: number}
            layout: {positions: ReadonlyArray<readonly [string, {x: number; y: number}]>}
        } = readResponse.result as {
            meta: {revision: number}
            layout: {positions: ReadonlyArray<readonly [string, {x: number; y: number}]>}
        }
        expect(state.meta.revision).toBe(1)
        const positionEntry: readonly [string, {x: number; y: number}] | undefined = state.layout.positions.find(
            ([id]: readonly [string, {x: number; y: number}]) => id === stack.fixtureNodeId,
        )
        expect(positionEntry?.[1]).toEqual({x: 42, y: 84})
    })

    it('two no-op reads from different clients return byte-identical SerializedState', async (): Promise<void> => {
        const a: JsonRpcResponse = await clientMain.call('vt_get_live_state', {})
        const b: JsonRpcResponse = await clientCli.call('vt_get_live_state', {})
        if ('error' in a || 'error' in b) {
            throw new Error('read unexpectedly failed')
        }
        expect(JSON.stringify(a.result)).toBe(JSON.stringify(b.result))
    })

    it('malformed command surfaces the identical JSON-RPC validation_failed shape on both clients', async (): Promise<void> => {
        // Missing `command` param triggers the catalog's zod validation path,
        // returning a JSON-RPC error with code = ERROR_CODES.validation_failed.
        const fromMain: JsonRpcResponse = await clientMain.call('vt_dispatch_live_command', {})
        const fromCli: JsonRpcResponse = await clientCli.call('vt_dispatch_live_command', {})
        if (!('error' in fromMain) || !('error' in fromCli)) {
            throw new Error('expected JSON-RPC error from both clients')
        }
        expect(fromMain.error.code).toBe(fromCli.error.code)
        expect(fromMain.error.message).toBe(fromCli.error.message)
        // The `data` envelope echoes the structured zod issues — same shape
        // on both clients.
        expect(JSON.stringify(fromMain.error.data)).toBe(JSON.stringify(fromCli.error.data))
    })
})
