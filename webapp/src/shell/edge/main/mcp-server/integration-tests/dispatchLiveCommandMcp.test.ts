/**
 * BF-162 · Real MCP roundtrip test for `vt_dispatch_live_command`.
 *
 * Mirrors the BF-161 integration harness: spins up the same express +
 * StreamableHTTPServerTransport stack the Electron app uses, dispatches a
 * `Collapse` command via the MCP client, then calls `vt_get_live_state` to
 * assert the folder landed in `collapseSet`. This is the unit-of-work
 * equivalent of the spec's real-instance verify (no need for a live
 * Electron binary here — the MCP roundtrip is what we actually need to
 * prove).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express, { type Express } from 'express'
import type { Server } from 'http'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Graph } from '@vt/graph-model/pure/graph'

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

let rendererCollapseSet: Set<string> = new Set()
let rendererSelection: Set<string> = new Set()

function resetRendererState(): void {
    rendererCollapseSet = new Set()
    rendererSelection = new Set()
}

vi.mock('@/shell/edge/main/state/renderer-live-state-proxy', () => ({
    readRendererLiveState: vi.fn(async () => ({
        collapseSet: new Set(rendererCollapseSet),
        selection: new Set(rendererSelection),
    })),
    applyRendererLiveCommand: vi.fn(async (command: {
        type: string
        folder?: string
        ids?: readonly string[]
        additive?: boolean
    }) => {
        switch (command.type) {
            case 'Collapse':
                if (typeof command.folder === 'string') {
                    rendererCollapseSet = new Set([...rendererCollapseSet, command.folder])
                }
                break
            case 'Expand':
                if (typeof command.folder === 'string') {
                    rendererCollapseSet = new Set(
                        [...rendererCollapseSet].filter((folder) => folder !== command.folder),
                    )
                }
                break
            case 'Select': {
                const next: Set<string> =
                    command.additive === true ? new Set(rendererSelection) : new Set()
                for (const id of command.ids ?? []) {
                    next.add(id)
                }
                rendererSelection = next
                break
            }
            case 'Deselect': {
                const next: Set<string> = new Set(rendererSelection)
                for (const id of command.ids ?? []) {
                    next.delete(id)
                }
                rendererSelection = next
                break
            }
            default:
                break
        }
        return {
            collapseSet: new Set(rendererCollapseSet),
            selection: new Set(rendererSelection),
        }
    }),
    isRendererOwnedLiveCommand: (command: { type: string }): boolean =>
        command.type === 'Collapse'
        || command.type === 'Expand'
        || command.type === 'Select'
        || command.type === 'Deselect',
}))

vi.mock('@/shell/edge/main/settings/settings_IO', () => ({
    loadSettings: vi.fn().mockResolvedValue({ nodeLineLimit: 70, agents: [] }),
    saveSettings: vi.fn(),
}))

vi.mock('@/shell/edge/main/mcp-server/mcp-client-config', () => ({
    enableMcpJsonIntegration: vi.fn().mockResolvedValue(undefined),
    isMcpIntegrationEnabled: vi.fn().mockReturnValue(false),
    setMcpIntegration: vi.fn(),
}))

import { getGraph as mockedGetGraph } from '@vt/graph-model'
import { createMcpServer } from '@/shell/edge/main/mcp-server/mcp-server'
import { findAvailablePort } from '@/shell/edge/main/electron/port-utils'
import { __resetLiveStoreForTests } from '@/shell/edge/main/state/live-state-store'

function emptyGraph(): Graph {
    return {
        nodes: {},
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
            if (!res.headersSent) res.status(500).json({ error: String(error) })
        }
    })

    const port: number = await findAvailablePort(4_200)
    const httpServer: Server = await new Promise<Server>((resolve) => {
        const srv: Server = app.listen(port, '127.0.0.1', () => resolve(srv))
    })
    return {
        port,
        close: () => new Promise<void>((resolve) => httpServer.close(() => resolve())),
    }
}

interface ToolCallResult {
    readonly isError?: boolean
    readonly content?: ReadonlyArray<{ readonly type: string; readonly text?: string }>
}

function parseTextBlock(result: ToolCallResult): Record<string, unknown> {
    const textBlock: { readonly type: string; readonly text?: string } | undefined =
        (result.content ?? []).find((c) => c.type === 'text')
    return JSON.parse(textBlock?.text ?? '{}') as Record<string, unknown>
}

describe('vt_dispatch_live_command real MCP roundtrip', () => {
    let server: TestServer

    beforeEach(async () => {
        vi.clearAllMocks()
        __resetLiveStoreForTests()
        resetRendererState()
        server = await startTestMcpServer()
        vi.mocked(mockedGetGraph).mockReturnValue(emptyGraph())
    })

    afterEach(async () => {
        await server?.close()
        __resetLiveStoreForTests()
    })

    it('dispatch Collapse → vt_get_live_state: folder in collapseSet + not-yet-wired sentinel works', async () => {
        const client: Client = new Client({ name: 'bf162-test', version: '1.0.0' })
        const transport: StreamableHTTPClientTransport = new StreamableHTTPClientTransport(
            new URL(`http://127.0.0.1:${server.port}/mcp`),
        )
        await client.connect(transport)

        try {
            const toolList: { tools: Array<{ name: string }> } = await client.listTools()
            const toolNames: string[] = toolList.tools.map((t) => t.name)
            expect(toolNames).toContain('vt_dispatch_live_command')
            expect(toolNames).toContain('vt_get_live_state')

            const folder: string = '/tmp/vault/brain/working-memory/tasks/'
            const dispatchResult: ToolCallResult = await client.callTool({
                name: 'vt_dispatch_live_command',
                arguments: { command: { type: 'Collapse', folder } },
            })
            expect(dispatchResult.isError).not.toBe(true)
            const dispatchPayload: Record<string, unknown> = parseTextBlock(dispatchResult)
            expect(dispatchPayload.revision).toBe(1)
            const delta: { collapseAdded?: readonly string[] } =
                dispatchPayload.delta as { collapseAdded?: readonly string[] }
            expect(delta.collapseAdded).toEqual([folder])

            // Verify the command round-tripped into the live state.
            const stateResult: ToolCallResult = await client.callTool({
                name: 'vt_get_live_state',
                arguments: {},
            })
            expect(stateResult.isError).not.toBe(true)
            const statePayload: Record<string, unknown> = parseTextBlock(stateResult)
            expect(statePayload.collapseSet).toContain(folder)
            expect(statePayload.meta).toMatchObject({ schemaVersion: 1, revision: 1 })

            // Persist verbatim payloads for the progress node to embed.
            const outFile: string = path.join(os.tmpdir(), 'bf162-vt-dispatch-live-command-roundtrip.json')
            fs.writeFileSync(
                outFile,
                JSON.stringify({ dispatch: dispatchPayload, state: statePayload }, null, 2),
                'utf8',
            )

            // L3-BF-186: Move (and every other Command variant) is now wired —
            // dispatch must NOT return the legacy `not-yet-wired` sentinel.
            const moveResult: ToolCallResult = await client.callTool({
                name: 'vt_dispatch_live_command',
                arguments: { command: { type: 'Move', id: '/tmp/x', to: { x: 1, y: 2 } } },
            })
            const movePayload: Record<string, unknown> = parseTextBlock(moveResult)
            expect(JSON.stringify(movePayload)).not.toContain('not-yet-wired')
            expect(movePayload.revision).toBe(2) // Collapse = 1, Move = 2
        } finally {
            await client.close()
        }
    })
})
