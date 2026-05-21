/**
 * Step 7c — UDS round-trip for createLiveTransport.
 *
 * Spins up a tiny in-process UDS JSON-RPC server using udsServer.ts from
 * voicetree-mcp, registers mock vt_get_live_state / vt_dispatch_live_command
 * tools, then exercises createLiveTransport against it. Same wire as
 * production after 7c.
 */
import {mkdtemp, realpath, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

// Relative path import (not package alias) breaks an ESM circular-init cycle:
// @vt/voicetree-mcp imports @vt/graph-tools, so loading voicetree-mcp from
// inside graph-tools' own test set leaves voicetree-mcp's exports undefined.
// filesystemAuthoring.test.ts uses the same pattern.
import {buildJsonResponse} from '../../../systems/voicetree-mcp/src/tools/toolResponse'
import {
    startUdsServer,
    type ToolCatalog,
    type UdsServerHandle,
} from '../../../systems/voicetree-mcp/src/transport/udsServer'
import {createLiveTransport} from '../src/live/liveTransport'

// ── fixture state ──────────────────────────────────────────────────────────

const VAULT_ROOT = '/tmp/vault'
const SAMPLE_NODE = `${VAULT_ROOT}/sample.md`
const TASKS_FOLDER = `${VAULT_ROOT}/tasks/`

const FIXTURE_SERIALIZED_STATE = {
    graph: {
        nodes: {
            [SAMPLE_NODE]: {
                outgoingEdges: [],
                absoluteFilePathIsID: SAMPLE_NODE,
                contentWithoutYamlOrLinks: 'hello',
                nodeUIMetadata: {
                    color: {_tag: 'None'},
                    position: {_tag: 'Some', value: {x: 1, y: 2}},
                    additionalYAMLProps: [],
                },
            },
        },
        incomingEdgesIndex: [],
        nodeByBaseName: [['sample.md', [SAMPLE_NODE]]],
        unresolvedLinksIndex: [],
    },
    roots: {
        loaded: [VAULT_ROOT],
        folderTree: [
            {
                name: 'vault',
                absolutePath: VAULT_ROOT,
                children: [],
                loadState: 'loaded' as const,
                isWriteTarget: true,
            },
        ],
    },
    collapseSet: [] as string[],
    selection: [] as string[],
    layout: {positions: [[SAMPLE_NODE, {x: 1, y: 2}]] as [string, {x: number; y: number}][]},
    meta: {schemaVersion: 1 as const, revision: 3, mutatedAt: '2026-04-17T00:00:00.000Z'},
}

// ── mock catalog backing the daemon ────────────────────────────────────────

interface MockServer {
    collapseSet: string[]
    revision: number
    rootsLoaded: string[]
    zoom: number | undefined
}

function buildCurrentState(mock: MockServer) {
    return {
        ...FIXTURE_SERIALIZED_STATE,
        roots: {
            ...FIXTURE_SERIALIZED_STATE.roots,
            loaded: [...mock.rootsLoaded],
        },
        collapseSet: [...mock.collapseSet],
        layout: {
            ...FIXTURE_SERIALIZED_STATE.layout,
            ...(mock.zoom !== undefined ? {zoom: mock.zoom} : {}),
        },
        meta: {...FIXTURE_SERIALIZED_STATE.meta, revision: mock.revision},
    }
}

interface DispatchedCommand {
    readonly type: string
    readonly path?: string
    readonly state?: string
    readonly zoom?: number
}

function buildCatalog(mock: MockServer): ToolCatalog {
    return new Map([
        ['vt_get_live_state', async () => buildJsonResponse(buildCurrentState(mock))],
        ['vt_dispatch_live_command', async (args: Record<string, unknown>) => {
            const command = args.command as DispatchedCommand
            const delta: {
                revision: number
                cause: unknown
                collapseAdded?: string[]
                rootsUnloaded?: string[]
                layoutChanged?: {zoom?: number}
            } = {revision: mock.revision, cause: command}

            if (command.type === 'SetFolderState'
                && command.state === 'collapsed'
                && typeof command.path === 'string'
            ) {
                const folder = `${command.path}/`
                if (!mock.collapseSet.includes(folder)) {
                    mock.collapseSet.push(folder)
                }
                mock.revision += 1
                delta.revision = mock.revision
                delta.collapseAdded = [folder]
            }

            if (command.type === 'SetZoom' && typeof command.zoom === 'number') {
                mock.zoom = command.zoom
                mock.revision += 1
                delta.revision = mock.revision
                delta.layoutChanged = {zoom: command.zoom}
            }

            return buildJsonResponse({delta, revision: mock.revision})
        }],
    ])
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('createLiveTransport — UDS round-trip', () => {
    let workDir: string
    let socketPath: string
    let handle: UdsServerHandle | null
    let envSock: string | undefined
    let mock: MockServer

    beforeEach(async () => {
        envSock = process.env.VOICETREE_SOCK_PATH
        workDir = await realpath(await mkdtemp(join(tmpdir(), 'vt-live-transport-')))
        socketPath = join(workDir, 'vt.sock')
        handle = null
        mock = {
            collapseSet: [],
            revision: FIXTURE_SERIALIZED_STATE.meta.revision,
            rootsLoaded: [...FIXTURE_SERIALIZED_STATE.roots.loaded],
            zoom: undefined,
        }
        handle = await startUdsServer({
            socketPath,
            catalog: buildCatalog(mock),
            logger: {log: () => {}, error: () => {}},
        })
        process.env.VOICETREE_SOCK_PATH = socketPath
    })

    afterEach(async () => {
        if (handle) await handle.stop()
        await rm(workDir, {recursive: true, force: true})
        if (envSock === undefined) delete process.env.VOICETREE_SOCK_PATH
        else process.env.VOICETREE_SOCK_PATH = envSock
    })

    it('getLiveState() returns a hydrated State via UDS JSON-RPC', async () => {
        const transport = createLiveTransport()
        const state = await transport.getLiveState()

        expect(state.meta.revision).toBe(3)
        expect(state.meta.schemaVersion).toBe(1)
        expect(state.roots.loaded.has(VAULT_ROOT)).toBe(true)
        expect(state.collapseSet.size).toBe(0)
        expect(state.selection.size).toBe(0)
        expect(Object.keys(state.graph.nodes)).toContain(SAMPLE_NODE)
        expect(state.layout.positions.get(SAMPLE_NODE)).toEqual({x: 1, y: 2})
    })

    it('dispatchLiveCommand() sends SetFolderState and returns a Delta', async () => {
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

    it('dispatchLiveCommand() preserves layoutChanged from the daemon delta', async () => {
        const transport = createLiveTransport()
        const delta = await transport.dispatchLiveCommand({
            type: 'SetZoom',
            zoom: 1.45,
        })

        expect(delta.revision).toBe(4)
        expect(delta.layoutChanged).toEqual({zoom: 1.45})
        expect(delta.cause).toEqual({type: 'SetZoom', zoom: 1.45})
    })

    it('round-trip: SetFolderState → getLiveState shows folder in collapseSet + revision bumped', async () => {
        const transport = createLiveTransport()

        const stateBefore = await transport.getLiveState()
        expect(stateBefore.collapseSet.size).toBe(0)
        const revBefore = stateBefore.meta.revision

        await transport.dispatchLiveCommand({
            type: 'SetFolderState',
            viewId: 'main',
            path: TASKS_FOLDER.slice(0, -1),
            state: 'collapsed',
        })

        const stateAfter = await transport.getLiveState()
        expect(stateAfter.collapseSet.has(TASKS_FOLDER)).toBe(true)
        expect(stateAfter.meta.revision).toBeGreaterThan(revBefore)
    })
})

describe('createLiveTransport — error surfaces', () => {
    let workDir: string
    let socketPath: string
    let handle: UdsServerHandle | null
    let envSock: string | undefined

    beforeEach(async () => {
        envSock = process.env.VOICETREE_SOCK_PATH
        workDir = await realpath(await mkdtemp(join(tmpdir(), 'vt-live-transport-errs-')))
        socketPath = join(workDir, 'vt.sock')
        handle = null
    })

    afterEach(async () => {
        if (handle) await handle.stop()
        await rm(workDir, {recursive: true, force: true})
        if (envSock === undefined) delete process.env.VOICETREE_SOCK_PATH
        else process.env.VOICETREE_SOCK_PATH = envSock
    })

    it('surfaces a renderer-required-style error from the tool handler', async () => {
        // Simulates `vt serve` (headless) — getLiveStateBridge returning no
        // bridge causes the live tool to respond with isError + the operational
        // reason in the JSON payload. Our client must surface that reason
        // intelligibly, not as a generic fetch-style failure.
        const catalog: ToolCatalog = new Map([
            ['vt_get_live_state', async () =>
                buildJsonResponse({error: 'Requires an Electron renderer'}, true),
            ],
        ])
        handle = await startUdsServer({
            socketPath,
            catalog,
            logger: {log: () => {}, error: () => {}},
        })
        process.env.VOICETREE_SOCK_PATH = socketPath

        const transport = createLiveTransport()
        await expect(transport.getLiveState())
            .rejects.toThrow(/Requires an Electron renderer/)
    })

    it('throws DaemonUnreachable when the socket path env var points nowhere', async () => {
        process.env.VOICETREE_SOCK_PATH = join(workDir, 'missing.sock')

        const transport = (): ReturnType<typeof createLiveTransport> => createLiveTransport()
        expect(transport).toThrow(/VOICETREE_SOCK_PATH/)
    })
})
