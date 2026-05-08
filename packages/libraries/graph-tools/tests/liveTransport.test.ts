/**
 * BF-163 · Integration test for liveTransport.ts.
 *
 * Spins up an in-process MCP server (McpServer + StreamableHTTPServerTransport)
 * serving mock vt_get_live_state and vt_dispatch_live_command tools, then
 * exercises createLiveTransport against it. Same transport stack as production.
 *
 * V-L1-15/16 pass criterion: real MCP roundtrip demonstrated.
 */
import express, {type Express} from 'express'
import type {Server} from 'http'
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import {z} from 'zod'

import {createLiveTransport} from '../src/liveTransport'

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

// ── mock MCP server ────────────────────────────────────────────────────────

interface TestServer {
    port: number
    close(): Promise<void>
}

let mockCollapseSet: string[] = []
let mockRevision: number = FIXTURE_SERIALIZED_STATE.meta.revision
let mockRootsLoaded: string[] = [...FIXTURE_SERIALIZED_STATE.roots.loaded]
let mockZoom: number | undefined

function buildCurrentState() {
    return {
        ...FIXTURE_SERIALIZED_STATE,
        roots: {
            ...FIXTURE_SERIALIZED_STATE.roots,
            loaded: [...mockRootsLoaded],
        },
        collapseSet: [...mockCollapseSet],
        layout: {
            ...FIXTURE_SERIALIZED_STATE.layout,
            ...(mockZoom !== undefined ? {zoom: mockZoom} : {}),
        },
        meta: {...FIXTURE_SERIALIZED_STATE.meta, revision: mockRevision},
    }
}

async function startTestServer(): Promise<TestServer> {
    const app: Express = express()
    app.use(express.json())

    app.post('/mcp', async (req, res) => {
        const mcpServer = new McpServer({name: 'bf163-test-server', version: '1.0.0'})

        mcpServer.tool('vt_get_live_state', 'Returns the live state', async () => ({
            content: [{type: 'text' as const, text: JSON.stringify(buildCurrentState())}],
        }))

        mcpServer.tool(
            'vt_dispatch_live_command',
            'Dispatches a live command',
            {command: z.object({type: z.string()}).passthrough()},
            async ({command}) => {
                const cmd = command as {
                    type: string
                    folder?: string
                    root?: string
                    zoom?: number
                }
                const delta = {
                    revision: mockRevision,
                    cause: command,
                } as {
                    revision: number
                    cause: unknown
                    collapseAdded?: string[]
                    rootsUnloaded?: string[]
                    layoutChanged?: {zoom?: number}
                }

                if (cmd.type === 'Collapse' && cmd.folder) {
                    if (!mockCollapseSet.includes(cmd.folder)) {
                        mockCollapseSet = [...mockCollapseSet, cmd.folder]
                    }
                    mockRevision += 1
                    delta.revision = mockRevision
                    delta.collapseAdded = [cmd.folder]
                }

                if (cmd.type === 'UnloadRoot' && cmd.root) {
                    mockRootsLoaded = mockRootsLoaded.filter((root) => root !== cmd.root)
                    mockRevision += 1
                    delta.revision = mockRevision
                    delta.rootsUnloaded = [cmd.root]
                }

                if (cmd.type === 'SetZoom' && typeof cmd.zoom === 'number') {
                    mockZoom = cmd.zoom
                    mockRevision += 1
                    delta.revision = mockRevision
                    delta.layoutChanged = {zoom: cmd.zoom}
                }
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({delta, revision: mockRevision}),
                    }],
                }
            },
        )

        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        })
        res.on('close', () => {
            void transport.close()
            void mcpServer.close()
        })
        try {
            await mcpServer.connect(transport)
            await transport.handleRequest(req, res, req.body as Record<string, unknown>)
        } catch (error) {
            if (!res.headersSent) res.status(500).json({error: String(error)})
        }
    })

    // Find a free port
    const port: number = await new Promise<number>((resolve) => {
        const srv = app.listen(0, '127.0.0.1', () => {
            const addr = srv.address()
            srv.close(() => {
                resolve(typeof addr === 'object' && addr ? addr.port : 4200)
            })
        })
    })

    const httpServer: Server = await new Promise<Server>((resolve) => {
        const srv: Server = app.listen(port, '127.0.0.1', () => resolve(srv))
    })

    return {
        port,
        close: () => new Promise<void>((resolve) => httpServer.close(() => resolve())),
    }
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('createLiveTransport — MCP roundtrip', () => {
    let server: TestServer

    beforeEach(async () => {
        mockCollapseSet = []
        mockRevision = FIXTURE_SERIALIZED_STATE.meta.revision
        mockRootsLoaded = [...FIXTURE_SERIALIZED_STATE.roots.loaded]
        mockZoom = undefined
        server = await startTestServer()
    })

    afterEach(async () => {
        await server?.close()
    })

    it('getLiveState() returns a hydrated State via real MCP HTTP transport', async () => {
        const transport = createLiveTransport(server.port)
        const state = await transport.getLiveState()

        expect(state.meta.revision).toBe(3)
        expect(state.meta.schemaVersion).toBe(1)
        expect(state.roots.loaded.has(VAULT_ROOT)).toBe(true)
        expect(state.collapseSet.size).toBe(0)
        expect(state.selection.size).toBe(0)
        expect(Object.keys(state.graph.nodes)).toContain(SAMPLE_NODE)
        expect(state.layout.positions.get(SAMPLE_NODE)).toEqual({x: 1, y: 2})
    })

    it('dispatchLiveCommand() sends Collapse and returns a Delta', async () => {
        const transport = createLiveTransport(server.port)
        const delta = await transport.dispatchLiveCommand({
            type: 'Collapse',
            folder: TASKS_FOLDER,
        })

        expect(delta.revision).toBe(4)
        expect(delta.collapseAdded).toContain(TASKS_FOLDER)
        expect(delta.cause).toEqual({type: 'Collapse', folder: TASKS_FOLDER})
    })

    it('dispatchLiveCommand() preserves rootsUnloaded from the MCP delta', async () => {
        const transport = createLiveTransport(server.port)
        const delta = await transport.dispatchLiveCommand({
            type: 'UnloadRoot',
            root: VAULT_ROOT,
        })

        expect(delta.revision).toBe(4)
        expect(delta.rootsUnloaded).toEqual([VAULT_ROOT])
        expect(delta.cause).toEqual({type: 'UnloadRoot', root: VAULT_ROOT})
    })

    it('dispatchLiveCommand() preserves layoutChanged from the MCP delta', async () => {
        const transport = createLiveTransport(server.port)
        const delta = await transport.dispatchLiveCommand({
            type: 'SetZoom',
            zoom: 1.45,
        })

        expect(delta.revision).toBe(4)
        expect(delta.layoutChanged).toEqual({zoom: 1.45})
        expect(delta.cause).toEqual({type: 'SetZoom', zoom: 1.45})
    })

    it('round-trip: Collapse → getLiveState shows folder in collapseSet + revision bumped', async () => {
        const transport = createLiveTransport(server.port)

        const stateBefore = await transport.getLiveState()
        expect(stateBefore.collapseSet.size).toBe(0)
        const revBefore = stateBefore.meta.revision

        await transport.dispatchLiveCommand({type: 'Collapse', folder: TASKS_FOLDER})

        const stateAfter = await transport.getLiveState()
        expect(stateAfter.collapseSet.has(TASKS_FOLDER)).toBe(true)
        expect(stateAfter.meta.revision).toBeGreaterThan(revBefore)
    })

    it('round-trip: UnloadRoot → getLiveState removes the root from roots.loaded', async () => {
        const transport = createLiveTransport(server.port)

        expect((await transport.getLiveState()).roots.loaded.has(VAULT_ROOT)).toBe(true)

        await transport.dispatchLiveCommand({type: 'UnloadRoot', root: VAULT_ROOT})

        const stateAfter = await transport.getLiveState()
        expect(stateAfter.roots.loaded.has(VAULT_ROOT)).toBe(false)
        expect(stateAfter.meta.revision).toBe(4)
    })
})
