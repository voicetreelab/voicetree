/**
 * BF-161 · Real MCP roundtrip test for `vt_get_live_state`.
 *
 * Goal: exercise the full stack — createMcpServer → StreamableHTTPServerTransport
 * over express → StreamableHTTPClientTransport — the same transport the
 * running Electron app uses. Confirms the tool is registered and that the
 * returned payload hydrates into a well-formed SerializedState.
 */
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import express, {type Express} from 'express'
import type {Server} from 'http'
import * as O from 'fp-ts/lib/Option.js'
import fs from 'fs'
import os from 'os'
import path from 'path'

import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type {Graph, GraphNode, NodeIdAndFilePath} from '@vt/graph-model/pure/graph'

vi.mock('@vt/graph-model', async () => {
    const actual: Record<string, unknown> = await vi.importActual('@vt/graph-model')
    return {
        ...actual,
        getGraph: vi.fn(),
        getProjectRootWatchedDirectory: vi.fn(),
        getVaultPaths: vi.fn(),
        getReadPaths: vi.fn(),
        getWritePath: vi.fn(),
        getDirectoryTree: vi.fn(),
    }
})

vi.mock('@/shell/edge/main/state/graph-store', () => ({
    getGraph: vi.fn(),
    setGraph: vi.fn(),
    getNode: vi.fn(),
}))

vi.mock('@/shell/edge/main/state/live-state-store', () => ({
    getCurrentLiveState: vi.fn(),
    applyLiveCommand: vi.fn(),
}))

vi.mock('@/shell/edge/main/settings/settings_IO', () => ({
    loadSettings: vi.fn().mockResolvedValue({nodeLineLimit: 70, agents: []}),
    saveSettings: vi.fn(),
}))

vi.mock('@/shell/edge/main/mcp-server/mcp-client-config', () => ({
    enableMcpJsonIntegration: vi.fn().mockResolvedValue(undefined),
    isMcpIntegrationEnabled: vi.fn().mockReturnValue(false),
    setMcpIntegration: vi.fn(),
}))

import {
    getGraph as mockedGetGraph,
    getProjectRootWatchedDirectory,
    getVaultPaths,
    getReadPaths,
    getWritePath,
    getDirectoryTree,
} from '@vt/graph-model'
import {getCurrentLiveState} from '@/shell/edge/main/state/live-state-store'
import {createMcpServer} from '@/shell/edge/main/mcp-server/mcp-server'
import {findAvailablePort} from '@/shell/edge/main/electron/port-utils'

function buildFixtureGraph(): Graph {
    const id: NodeIdAndFilePath = '/tmp/vault/sample.md' as NodeIdAndFilePath
    const node: GraphNode = {
        outgoingEdges: [],
        absoluteFilePathIsID: id,
        contentWithoutYamlOrLinks: 'hello',
        nodeUIMetadata: {
            color: O.none,
            position: O.some({x: 1, y: 2}),
            additionalYAMLProps: new Map(),
            isContextNode: false,
        },
    }
    return {
        nodes: {[id]: node},
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map(),
    }
}

interface TestServer {
    port: number
    close(): Promise<void>
}

async function startTestMcpServer(): Promise<TestServer> {
    const app: Express = express()
    app.use(express.json())

    app.post('/mcp', async (req, res) => {
        const server: Awaited<ReturnType<typeof createMcpServer>> = await createMcpServer()
        const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        })
        res.on('close', () => {
            void transport.close()
            void server.close()
        })
        try {
            await server.connect(transport)
            await transport.handleRequest(req, res, req.body as Record<string, unknown>)
        } catch (error) {
            if (!res.headersSent) res.status(500).json({error: String(error)})
        }
    })

    const port: number = await findAvailablePort(4_100)
    const httpServer: Server = await new Promise<Server>((resolve) => {
        const srv: Server = app.listen(port, '127.0.0.1', () => resolve(srv))
    })

    return {
        port,
        close: () => new Promise<void>((resolve) => httpServer.close(() => resolve())),
    }
}

describe('vt_get_live_state real MCP roundtrip', () => {
    let server: TestServer

    beforeEach(async () => {
        vi.clearAllMocks()
        server = await startTestMcpServer()

        const graph: Graph = buildFixtureGraph()
        vi.mocked(getCurrentLiveState).mockReturnValue({
            graph,
            roots: {loaded: new Set(), folderTree: []},
            collapseSet: new Set(['/tmp/vault/tasks/']),
            selection: new Set(['/tmp/vault/sample.md' as NodeIdAndFilePath]),
            layout: {positions: new Map()},
            meta: {schemaVersion: 1, revision: 7},
        })
        vi.mocked(mockedGetGraph).mockReturnValue(graph)
        vi.mocked(getProjectRootWatchedDirectory).mockReturnValue('/tmp/vault' as never)
        vi.mocked(getVaultPaths).mockResolvedValue(['/tmp/vault'] as never)
        vi.mocked(getReadPaths).mockResolvedValue([])
        vi.mocked(getWritePath).mockResolvedValue(O.some('/tmp/vault') as never)
        vi.mocked(getDirectoryTree).mockResolvedValue({
            absolutePath: '/tmp/vault' as never,
            name: 'vault',
            isDirectory: true,
            children: [],
        })
    })

    afterEach(async () => {
        await server?.close()
    })

    it('roundtrips the SerializedState over HTTP/MCP', async () => {
        const client: Client = new Client({name: 'bf161-test', version: '1.0.0'})
        const transport: StreamableHTTPClientTransport = new StreamableHTTPClientTransport(
            new URL(`http://127.0.0.1:${server.port}/mcp`),
        )
        await client.connect(transport)

        try {
            const toolList: {tools: Array<{name: string}>} = await client.listTools()
            const toolNames: string[] = toolList.tools.map((t) => t.name)
            expect(toolNames).toContain('vt_get_live_state')

            const result: {
                isError?: boolean
                content?: Array<{type: string; text?: string}>
            } = await client.callTool({name: 'vt_get_live_state', arguments: {}})

            expect(result.isError).not.toBe(true)
            const textBlock: {type: string; text?: string} | undefined = (result.content ?? []).find(
                (c) => c.type === 'text',
            )
            expect(textBlock?.text).toBeTruthy()

            const payload: Record<string, unknown> = JSON.parse(textBlock?.text ?? '{}') as Record<string, unknown>

            // Persist verbatim payload for the progress node to embed.
            const outFile: string = path.join(os.tmpdir(), 'bf161-vt-get-live-state-roundtrip.json')
            fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8')

            expect(payload.meta).toMatchObject({schemaVersion: 1, revision: 7})
            expect(payload.collapseSet).toEqual(['/tmp/vault/tasks/'])
            expect(payload.selection).toEqual(['/tmp/vault/sample.md'])
            const layout = payload.layout as {positions: Array<[string, {x: number; y: number}]>}
            expect(layout.positions).toContainEqual(['/tmp/vault/sample.md', {x: 1, y: 2}])
            const roots = payload.roots as {loaded: string[]; folderTree: unknown[]}
            expect(roots.loaded).toContain('/tmp/vault')
            expect(roots.folderTree.length).toBe(1)
        } finally {
            await client.close()
        }
    })
})
