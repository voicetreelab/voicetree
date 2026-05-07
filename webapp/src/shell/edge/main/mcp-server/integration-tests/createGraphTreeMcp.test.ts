import {describe, it, expect, vi, beforeEach} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphDelta, GraphNode, NodeDelta, NodeIdAndFilePath} from '@vt/graph-model/graph'

vi.mock('@vt/graph-db-server/watch-folder/vault-allowlist', () => ({
    getWritePath: vi.fn(),
    getVaultPaths: vi.fn()
}))

vi.mock('@vt/graph-db-server/state/graph-store', () => ({
    getGraph: vi.fn()
}))

vi.mock('@vt/agent-runtime', () => ({
    getTerminalRecords: vi.fn(),
    resetAuditRetryCount: vi.fn()
}))

vi.mock('@vt/graph-db-server/graph/applyGraphDelta', () => ({
    applyGraphDeltaToDBThroughMemAndUIAndEditors: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@vt/app-config/settings', () => ({
    loadSettings: vi.fn().mockResolvedValue({nodeLineLimit: 70})
}))

vi.mock('@mermaid-js/parser', () => ({
    parse: vi.fn()
}))

const mockPostDelta = vi.fn(async () => undefined)

vi.mock('@vt/voicetree-mcp/graphDbClientProvider', async () => {
    const graphStore: typeof import('@vt/graph-db-server/state/graph-store') = await import('@vt/graph-db-server/state/graph-store')
    const vaultAllowlist: typeof import('@vt/graph-db-server/watch-folder/vault-allowlist') = await import('@vt/graph-db-server/watch-folder/vault-allowlist')
    return {
        configureGraphDbClient: vi.fn(),
        getConfiguredGraphDbClient: vi.fn(() => ({
            getGraph: vi.fn(async () => ({ nodes: graphStore.getGraph().nodes })),
            getVault: vi.fn(async () => {
                const wp = await vaultAllowlist.getWritePath()
                const vaultPaths: string[] = (await vaultAllowlist.getVaultPaths()) ?? []
                const writePath: string | undefined = wp._tag === 'Some' ? wp.value : undefined
                return { writePath, readPaths: vaultPaths.filter((p: string) => p !== writePath), vaultPath: writePath ?? '' }
            }),
            postDelta: mockPostDelta,
        })),
        getConfiguredGraph: vi.fn(async () => graphStore.getGraph()),
    }
})

import {createGraphTool} from '@vt/voicetree-mcp'
import {getWritePath} from '@vt/graph-db-server/watch-folder/vault-allowlist'
import {getGraph} from '@vt/graph-db-server/state/graph-store'
import {parse as mermaidParse} from '@mermaid-js/parser'
import {
    type McpToolResponse, type SuccessPayload, parsePayload,
    WRITE_PATH, CALLER_TERMINAL_ID,
    buildGraphNode, buildGraph, mockCallerTerminal, setupStandardMocks,
} from './createGraphMcp.helpers'

describe('MCP create_graph tool — multi-node tree', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('creates a tree of nodes with parent references', async () => {
        setupStandardMocks()

        const response: McpToolResponse = await createGraphTool({
            callerTerminalId: CALLER_TERMINAL_ID,
            nodes: [
                {filename:'root', title: 'Root Node', summary: 'Root.'},
                {filename:'child1', title: 'Child One', summary: 'First child.', parents: [{filename: 'root', edgeLabel: ''}]},
                {filename:'child2', title: 'Child Two', summary: 'Second child.', parents: [{filename: 'root', edgeLabel: ''}]}
            ]
        })
        const payload: SuccessPayload = parsePayload(response) as SuccessPayload

        expect(payload.success).toBe(true)
        expect(payload.nodes).toHaveLength(3)
        expect(payload.nodes.every((n: {status: string}) => n.status === 'ok')).toBe(true)
    })

    it('creates parents before children (topological order)', async () => {
        setupStandardMocks()

        const response: McpToolResponse = await createGraphTool({
            callerTerminalId: CALLER_TERMINAL_ID,
            nodes: [
                {filename:'child', title: 'Child', summary: 'Child.', parents: [{filename: 'parent', edgeLabel: ''}]},
                {filename:'parent', title: 'Parent', summary: 'Parent.'}
            ]
        })
        const payload: SuccessPayload = parsePayload(response) as SuccessPayload

        expect(payload.success).toBe(true)
        expect(payload.nodes).toHaveLength(2)

        const firstDelta: GraphDelta = mockPostDelta.mock.calls[0][0]
        const firstNode: GraphNode = firstDelta[0].type === 'UpsertNode'
            ? firstDelta[0].nodeToUpsert
            : (() => { throw new Error('Expected UpsertNode delta') })()
        expect(firstNode.absoluteFilePathIsID).toContain('parent')
    })

    it('preserves labeled parent edges for locally created nodes', async () => {
        setupStandardMocks()

        await createGraphTool({
            callerTerminalId: CALLER_TERMINAL_ID,
            nodes: [
                {filename:'parent', title: 'Parent', summary: 'Parent.'},
                {filename:'child', title: 'Child', summary: 'Child.', parents: [{filename: 'parent', edgeLabel: 'implements'}]},
            ]
        })

        const calls: Array<[GraphDelta, boolean | undefined]> =
            mockPostDelta.mock.calls as Array<[GraphDelta, boolean | undefined]>
        const creationDelta: GraphDelta = calls[0][0]
        const childDelta: NodeDelta | undefined = creationDelta.find(
            (entry) => entry.type === 'UpsertNode' && entry.nodeToUpsert.absoluteFilePathIsID === `${WRITE_PATH}/child.md`
        )

        if (!childDelta || childDelta.type !== 'UpsertNode') {
            throw new Error('Expected child node in creation delta')
        }

        expect(childDelta.nodeToUpsert.outgoingEdges).toContainEqual({
            targetId: `${WRITE_PATH}/parent.md`,
            label: 'implements',
        })
    })

    it('positions children spread vertically from parent', async () => {
        setupStandardMocks()

        await createGraphTool({
            callerTerminalId: CALLER_TERMINAL_ID,
            nodes: [
                {filename:'a', title: 'Root', summary: 'Root.'},
                {filename:'b', title: 'Child One', summary: 'C1.', parents: [{filename: 'a', edgeLabel: ''}]},
                {filename:'c', title: 'Child Two', summary: 'C2.', parents: [{filename: 'a', edgeLabel: ''}]}
            ]
        })

        const calls: Array<[GraphDelta, boolean | undefined]> = mockPostDelta.mock.calls as Array<[GraphDelta, boolean | undefined]>
        const creationDelta: GraphDelta = calls[0][0]
        expect(creationDelta).toHaveLength(3)
        expect(calls.length).toBeGreaterThanOrEqual(2)
    })

    it('updates context node with all new node IDs', async () => {
        setupStandardMocks()

        await createGraphTool({
            callerTerminalId: CALLER_TERMINAL_ID,
            nodes: [
                {filename:'a', title: 'Node A', summary: 'A.'},
                {filename:'b', title: 'Node B', summary: 'B.'}
            ]
        })

        const calls: Array<[GraphDelta, boolean | undefined]> = mockPostDelta.mock.calls as Array<[GraphDelta, boolean | undefined]>
        const lastDelta: GraphDelta = calls[calls.length - 1][0]
        expect(lastDelta[0].type).toBe('UpsertNode')

        if (lastDelta[0].type === 'UpsertNode') {
            const contextNode: GraphNode = lastDelta[0].nodeToUpsert
            const containedIds: readonly string[] = contextNode.nodeUIMetadata.containedNodeIds ?? []
            expect(containedIds).toContain('existing-node.md')
            expect(containedIds.length).toBeGreaterThanOrEqual(3)
        }
    })
})

describe('MCP create_graph tool — mermaid validation', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('creates node with warning when mermaid is invalid', async () => {
        setupStandardMocks()
        vi.mocked(mermaidParse).mockRejectedValueOnce(new Error('Parse error'))

        const response: McpToolResponse = await createGraphTool({
            callerTerminalId: CALLER_TERMINAL_ID,
            nodes: [{
                filename: 'a',
                title: 'Bad Mermaid',
                summary: 'Testing.',
                diagram: 'pie\ninvalid syntax'
            }]
        })
        const payload: SuccessPayload = parsePayload(response) as SuccessPayload

        expect(payload.success).toBe(true)
        expect(payload.nodes[0].status).toBe('warning')
        expect(payload.nodes[0].warning).toContain('Mermaid')
    })

    it('creates node without warning when mermaid is valid', async () => {
        setupStandardMocks()
        vi.mocked(mermaidParse).mockResolvedValueOnce({} as Awaited<ReturnType<typeof mermaidParse>>)

        const response: McpToolResponse = await createGraphTool({
            callerTerminalId: CALLER_TERMINAL_ID,
            nodes: [{
                filename: 'a',
                title: 'Valid Mermaid',
                summary: 'Testing.',
                diagram: 'pie\n"A" : 30\n"B" : 70'
            }]
        })
        const payload: SuccessPayload = parsePayload(response) as SuccessPayload

        expect(payload.success).toBe(true)
        expect(payload.nodes[0].status).toBe('ok')
    })
})

describe('MCP create_graph tool — slug and unique ID', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('slugifies filename into file path', async () => {
        setupStandardMocks()

        const response: McpToolResponse = await createGraphTool({
            callerTerminalId: CALLER_TERMINAL_ID,
            nodes: [{filename: 'My Progress Node Title!', title: 'Title', summary: 'Content.'}]
        })
        const payload: SuccessPayload = parsePayload(response) as SuccessPayload

        expect(payload.success).toBe(true)
        expect(payload.nodes[0].path).toBe(`${WRITE_PATH}/my-progress-node-title.md`)
    })

    it('uses ensureUniqueNodeId when slug collides', async () => {
        const collidingNodeId: NodeIdAndFilePath = `${WRITE_PATH}/colliding-title.md`
        const graph: Graph = buildGraph({
            [collidingNodeId]: buildGraphNode(collidingNodeId, '# Existing')
        })
        mockCallerTerminal()
        vi.mocked(getWritePath).mockResolvedValue(O.some(WRITE_PATH))
        vi.mocked(getGraph).mockReturnValue(graph)

        const response: McpToolResponse = await createGraphTool({
            callerTerminalId: CALLER_TERMINAL_ID,
            nodes: [{filename: 'Colliding Title', title: 'Colliding Title', summary: 'Content.'}]
        })
        const payload: SuccessPayload = parsePayload(response) as SuccessPayload

        expect(payload.success).toBe(true)
        expect(payload.nodes[0].path).toBe(`${WRITE_PATH}/colliding-title_2.md`)
    })
})
