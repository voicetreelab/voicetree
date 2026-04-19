import express, {type Express} from 'express'
import type {Server} from 'http'
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {liveView} from '../src/live'

const VAULT_ROOT = '/tmp/vt-live-view-no-disk'
const ROOT_NODE = `${VAULT_ROOT}/root.md`
const TASKS_FOLDER = `${VAULT_ROOT}/tasks/`
const TASK_ONE = `${TASKS_FOLDER}task-1.md`
const TASK_TWO = `${TASKS_FOLDER}task-2.md`

const FIXTURE_SERIALIZED_STATE = {
    graph: {
        nodes: {
            [ROOT_NODE]: {
                outgoingEdges: [{targetId: TASK_ONE, label: ''}],
                absoluteFilePathIsID: ROOT_NODE,
                contentWithoutYamlOrLinks: '# Root\n',
                nodeUIMetadata: {
                    color: {_tag: 'None'},
                    position: {_tag: 'None'},
                    additionalYAMLProps: [],
                },
            },
            [TASK_ONE]: {
                outgoingEdges: [{targetId: ROOT_NODE, label: ''}],
                absoluteFilePathIsID: TASK_ONE,
                contentWithoutYamlOrLinks: '# Task 1\n',
                nodeUIMetadata: {
                    color: {_tag: 'None'},
                    position: {_tag: 'None'},
                    additionalYAMLProps: [],
                },
            },
            [TASK_TWO]: {
                outgoingEdges: [],
                absoluteFilePathIsID: TASK_TWO,
                contentWithoutYamlOrLinks: '# Task 2\n',
                nodeUIMetadata: {
                    color: {_tag: 'None'},
                    position: {_tag: 'None'},
                    additionalYAMLProps: [],
                },
            },
        },
        incomingEdgesIndex: [],
        nodeByBaseName: [],
        unresolvedLinksIndex: [],
    },
    roots: {
        loaded: [VAULT_ROOT],
        folderTree: [{
            name: 'vt-live-view-no-disk',
            absolutePath: VAULT_ROOT,
            children: [{
                name: 'tasks',
                absolutePath: TASKS_FOLDER.slice(0, -1),
                children: [],
                loadState: 'loaded' as const,
                isWriteTarget: true,
            }],
            loadState: 'loaded' as const,
            isWriteTarget: true,
        }],
    },
    collapseSet: [TASKS_FOLDER],
    selection: [],
    layout: {positions: [] as [string, {x: number; y: number}][]},
    meta: {schemaVersion: 1 as const, revision: 7, mutatedAt: '2026-04-19T00:00:00.000Z'},
}

interface TestServer {
    readonly port: number
    close(): Promise<void>
}

async function startTestServer(): Promise<TestServer> {
    const app: Express = express()
    app.use(express.json())

    app.post('/mcp', async (req, res) => {
        const mcpServer = new McpServer({name: 'live-view-test-server', version: '1.0.0'})

        mcpServer.tool('vt_get_live_state', 'Returns the live state', async () => ({
            content: [{type: 'text' as const, text: JSON.stringify(FIXTURE_SERIALIZED_STATE)}],
        }))

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

    const port: number = await new Promise<number>((resolve) => {
        const srv = app.listen(0, '127.0.0.1', () => {
            const address = srv.address()
            srv.close(() => {
                resolve(typeof address === 'object' && address ? address.port : 4200)
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

describe('liveView', () => {
    let server: TestServer

    beforeEach(async () => {
        server = await startTestServer()
    })

    afterEach(async () => {
        await server?.close()
    })

    it('renders from projected live state without rescanning the filesystem', async () => {
        const result = await liveView({port: server.port})

        expect(result.output).toContain('▢ tasks/ [collapsed ⊟ 2 descendants, 1 outgoing]')
        expect(result.output).toContain('· Root')
        expect(result.output).toContain(`${TASKS_FOLDER} -> ${ROOT_NODE}`)
        expect(result.virtualFolderCount).toBe(1)
        expect(result.fileNodeCount).toBe(1)
    })
})
