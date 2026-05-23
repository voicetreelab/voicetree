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

vi.mock('@vt/agent-runtime', async (importOriginal) => {
    const actual: typeof import('@vt/agent-runtime') = await importOriginal()
    const overrides = {
        closeHeadlessAgent: vi.fn(),
        enqueuePendingMessage: vi.fn(),
        getHeadlessAgentOutput: vi.fn(),
        getIdleSince: vi.fn(),
        getOutput: vi.fn(),
        getPendingTerminal: vi.fn(),
        getRuntimeUI: vi.fn(),
        getTerminalRecords: vi.fn(),
        registerChild: vi.fn(),
        resetAuditRetryCount: vi.fn(),
        runStopHooks: vi.fn(),
        sendTextToTerminal: vi.fn(),
        spawnTerminalWithContextNode: vi.fn(),
        tryConsumeAndSplitBudget: vi.fn(() => ({allowed: true, childBudget: undefined})),
    }
    return {
        ...actual,
        ...overrides,
        agentRuntime: {...actual.agentRuntime, ...overrides},
    }
})

vi.mock('@vt/graph-db-server/graph/applyGraphDelta', () => ({
    applyGraphDeltaToDBThroughMemAndUIAndEditors: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@vt/app-config/settings', () => ({
    loadSettings: vi.fn().mockResolvedValue({nodeLineLimit: 70})
}))

vi.mock('@mermaid-js/parser', () => ({
    parse: vi.fn()
}))

import {createGraphTool} from '@vt/vt-daemon'
import {getWritePath, getVaultPaths} from '@vt/graph-db-server/watch-folder/vault-allowlist'
import {getGraph} from '@vt/graph-db-server/state/graph-store'
import {applyGraphDeltaToDBThroughMemAndUIAndEditors} from '@vt/graph-db-server/graph/applyGraphDelta'
import {parse as mermaidParse} from '@mermaid-js/parser'
import {
    CALLER_TERMINAL_ID,
    READ_PATH,
    WRITE_PATH,
    buildGraph,
    buildGraphNode,
    configureCreateGraphServer,
    mockCallerTerminal,
    parsePayload,
    setupStandardMocks,
    type McpToolResponse,
    type SuccessPayload,
} from './__tests__/addProgressNodeMcp.testHelpers'

describe('MCP create_graph tool — node creation', () => {
    beforeEach(async () => {
        vi.clearAllMocks()
        await configureCreateGraphServer()
    })

    describe('single node creation', () => {
        it('creates a single node successfully', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [{filename: 'my-progress', title: 'My Progress', summary: 'Did some work.'}]
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload

            expect(payload.success).toBe(true)
            expect(payload.nodes).toHaveLength(1)
            expect(payload.nodes[0].path).toContain('my-progress')
            expect(payload.nodes[0].status).toBe('ok')
        })

        it('uses agent color and name from terminal record', async () => {
            mockCallerTerminal({agentName: 'my-agent', color: 'green'})
            vi.mocked(getWritePath).mockResolvedValue(O.some(WRITE_PATH))
            vi.mocked(getGraph).mockReturnValue(buildGraph())
            vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mockResolvedValue(undefined)

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [{filename:'a', title: 'Colored Node', summary: 'Work.'}]
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload

            expect(payload.success).toBe(true)

            const deltaCalls: GraphDelta[] = vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mock.calls.map(
                (call: [delta: GraphDelta, recordForUndo?: boolean | undefined]) => call[0]
            )
            const firstDelta: GraphDelta = deltaCalls[0]
            const upsertedNode: GraphNode = firstDelta[0].type === 'UpsertNode'
                ? firstDelta[0].nodeToUpsert
                : (() => { throw new Error('Expected UpsertNode delta') })()

            expect(upsertedNode.nodeUIMetadata.color).toEqual(O.some('green'))
            expect(upsertedNode.nodeUIMetadata.additionalYAMLProps['agent_name']).toBe('my-agent')
        })

        it('creates a node in a relative outputPath under the write path', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                outputPath: 'deliverables/progress',
                nodes: [{filename: 'my-progress', title: 'My Progress', summary: 'Did some work.'}]
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload

            expect(payload.success).toBe(true)
            expect(payload.nodes[0].path).toBe(`${WRITE_PATH}/deliverables/progress/my-progress.md`)
        })

        it('creates a node in an absolute outputPath when it is within a loaded read path', async () => {
            setupStandardMocks()
            vi.mocked(getVaultPaths).mockResolvedValue([WRITE_PATH, READ_PATH])

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                outputPath: `${READ_PATH}/deliverables`,
                nodes: [{filename: 'my-progress', title: 'My Progress', summary: 'Did some work.'}]
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload

            expect(payload.success).toBe(true)
            expect(payload.nodes[0].path).toBe(`${READ_PATH}/deliverables/my-progress.md`)
        })
    })

    describe('multi-node tree creation', () => {
        it('creates a tree of nodes with parent references', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [
                    {filename:'root', title: 'Root Node', summary: 'Root.'},
                    {filename:'child1', title: 'Child One', summary: 'First child.', content: '- parent [[root]]'},
                    {filename:'child2', title: 'Child Two', summary: 'Second child.', content: '- parent [[root]]'}
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
                    {filename:'child', title: 'Child', summary: 'Child.', content: '- parent [[parent]]'},
                    {filename:'parent', title: 'Parent', summary: 'Parent.'}
                ]
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload

            expect(payload.success).toBe(true)
            expect(payload.nodes).toHaveLength(2)

            const firstDelta: GraphDelta = vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mock.calls[0][0]
            const firstNode: GraphNode = firstDelta[0].type === 'UpsertNode'
                ? firstDelta[0].nodeToUpsert
                : (() => { throw new Error('Expected UpsertNode delta') })()
            expect(firstNode.absoluteFilePathIsID).toContain('parent')
        })

        it('preserves labeled parent edges via the | syntax', async () => {
            setupStandardMocks()

            await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [
                    {filename:'parent', title: 'Parent', summary: 'Parent.'},
                    {filename:'child', title: 'Child', summary: 'Child.', content: '- parent [[parent|implements]]'},
                ]
            })

            const calls: Array<[GraphDelta, boolean | undefined]> =
                vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mock.calls as Array<[GraphDelta, boolean | undefined]>
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
                    {filename:'b', title: 'Child One', summary: 'C1.', content: '- parent [[a]]'},
                    {filename:'c', title: 'Child Two', summary: 'C2.', content: '- parent [[a]]'}
                ]
            })

            const calls: Array<[GraphDelta, boolean | undefined]> = vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mock.calls as Array<[GraphDelta, boolean | undefined]>
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

            const calls: Array<[GraphDelta, boolean | undefined]> = vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mock.calls as Array<[GraphDelta, boolean | undefined]>
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

    describe('mermaid validation', () => {
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

    describe('slug and unique ID', () => {
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
            vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mockResolvedValue(undefined)

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [{filename: 'Colliding Title', title: 'Colliding Title', summary: 'Content.'}]
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload

            expect(payload.success).toBe(true)
            expect(payload.nodes[0].path).toBe(`${WRITE_PATH}/colliding-title_2.md`)
        })
    })
})
