import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import express, {type Express} from 'express'
import type {Server} from 'http'
import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphNode, NodeIdAndFilePath} from '@vt/graph-model/pure/graph'

import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js'

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
    rootsWereExplicitlySet: vi.fn().mockReturnValue(false),
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

const EXPECTED_TOOL_NAMES: readonly string[] = [
    'close_agent',
    'create_graph',
    'get_unseen_nodes_nearby',
    'graph_structure',
    'list_agents',
    'read_terminal_output',
    'send_message',
    'spawn_agent',
    'vt_dispatch_live_command',
    'vt_get_live_state',
    'wait_for_agents',
]

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

    const port: number = await findAvailablePort(4_140)
    const httpServer: Server = await new Promise<Server>((resolve) => {
        const srv: Server = app.listen(port, '127.0.0.1', () => resolve(srv))
    })

    return {
        port,
        close: () => new Promise<void>((resolve) => httpServer.close(() => resolve())),
    }
}

describe('MCP tool registration manifest', () => {
    let server: TestServer

    beforeEach(async () => {
        vi.clearAllMocks()
        server = await startTestMcpServer()

        const graph: Graph = buildFixtureGraph()
        vi.mocked(getCurrentLiveState).mockResolvedValue({
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

    it('registers orchestration and live tools on the same MCP surface', async () => {
        const client: Client = new Client({name: 'mcp-manifest-test', version: '1.0.0'})
        const transport: StreamableHTTPClientTransport = new StreamableHTTPClientTransport(
            new URL(`http://127.0.0.1:${server.port}/mcp`),
        )
        await client.connect(transport)

        try {
            const toolList: {tools: Array<{name: string}>} = await client.listTools()
            const toolNames: string[] = toolList.tools.map((tool) => tool.name).sort()
            expect(toolNames).toEqual([...EXPECTED_TOOL_NAMES].sort())
        } finally {
            await client.close()
        }
    })
})
