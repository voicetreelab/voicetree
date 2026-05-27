import {describe, it, expect, vi, beforeEach} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphDelta, GraphNode, NodeDelta, NodeIdAndFilePath} from '@vt/graph-model/graph'
import {createAddProgressNodeMcpTestHarness} from './addProgressNodeMcp.test/__tests__/testHarness'
import {describeCreateGraphToolValidationTests} from './addProgressNodeMcp.test/__tests__/validationTests'

type McpToolResponse = {
    content: Array<{type: 'text'; text: string}>
    isError?: boolean
}

type SuccessPayload = {
    success: true
    nodes: Array<{id: string; path: string; status: 'ok' | 'warning'; warning?: string}>
}

type ErrorPayload = {
    success: false
    error: string
}

const {
    applyGraphDeltaToDBThroughMemAndUIAndEditors,
    buildGraph,
    buildGraphNode,
    CALLER_TERMINAL_ID,
    configureCreateGraphToolTestServer,
    createGraphTool,
    getGraph,
    getVaultPaths,
    getWriteFolder,
    mermaidParse,
    mockCallerTerminal,
    parsePayload,
    READ_PATH,
    setupStandardMocks,
    WRITE_PATH,
} = createAddProgressNodeMcpTestHarness()

describe('MCP create_graph tool', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        configureCreateGraphToolTestServer()
    })

    describeCreateGraphToolValidationTests()

    // =========================================================================
    // Line length blocking
    // =========================================================================

    describe('line length blocking', () => {
        it('blocks creation when a node exceeds configured line limit', async () => {
            setupStandardMocks()
            const longContent: string = Array.from({length: 75}, (_, i) => `Line ${i + 1}`).join('\n')

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [{filename: 'a', title: 'Long Node', summary: 'Summary.', content: longContent}]
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('too long')
            expect(payload.error).toContain('limit is 70')
        })

        it('exempts codeDiffs from line count', async () => {
            setupStandardMocks()
            const largeDiff: string = Array.from({length: 40}, (_, i) => `- old ${i}\n+ new ${i}`).join('\n')

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [{
                    filename: 'a',
                    title: 'With Diffs',
                    summary: 'Short summary.',
                    codeDiffs: [largeDiff],
                    complexityScore: 'low',
                    complexityExplanation: 'Simple'
                }]
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload

            expect(payload.success).toBe(true)
        })

        it('exempts diagram from line count', async () => {
            setupStandardMocks()
            const largeDiagram: string = Array.from({length: 40}, (_, i) => `A${i} --> B${i}`).join('\n')

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [{
                    filename: 'a',
                    title: 'With Diagram',
                    summary: 'Short summary.',
                    diagram: `flowchart TD\n${largeDiagram}`
                }]
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload

            expect(payload.success).toBe(true)
        })

        it('blocks all nodes if any single node is too long', async () => {
            setupStandardMocks()
            const longContent: string = Array.from({length: 75}, (_, i) => `Line ${i + 1}`).join('\n')

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [
                    {filename:'a', title: 'Short', summary: 'OK.'},
                    {filename:'b', title: 'Long', summary: 'Summary.', content: longContent, parents: [{filename: 'a', edgeLabel: ''}]}
                ]
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('"b"')
            // No nodes should have been created
            expect(applyGraphDeltaToDBThroughMemAndUIAndEditors).not.toHaveBeenCalled()
        })
    })

    // =========================================================================
    // Single node creation (replaces add_progress_node)
    // =========================================================================

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
            vi.mocked(getWriteFolder).mockResolvedValue(O.some(WRITE_PATH))
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
            expect(upsertedNode.nodeUIMetadata.additionalYAMLProps.get('agent_name')).toBe('my-agent')
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

    // =========================================================================
    // Multi-node tree creation
    // =========================================================================

    describe('multi-node tree creation', () => {
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

            // Provide nodes in reverse order — children before parent
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

            // Parent should be created first (first applyGraphDelta call)
            const firstDelta: GraphDelta = vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mock.calls[0][0]
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
                    {filename:'b', title: 'Child One', summary: 'C1.', parents: [{filename: 'a', edgeLabel: ''}]},
                    {filename:'c', title: 'Child Two', summary: 'C2.', parents: [{filename: 'a', edgeLabel: ''}]}
                ]
            })

            // Root is at graphParent (100,200) + offset (200, 0)
            // Child 1: root position + (200, 0)
            // Child 2: root position + (200, 150)
            const calls: Array<[GraphDelta, boolean | undefined]> = vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mock.calls as Array<[GraphDelta, boolean | undefined]>
            const creationDelta: GraphDelta = calls[0][0]
            expect(creationDelta).toHaveLength(3)
            expect(calls.length).toBeGreaterThanOrEqual(2)
        })

        it('reads graph, vault paths, and write folder once through the per-call snapshot', async () => {
            setupStandardMocks()

            await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [
                    {filename:'a', title: 'Node A', summary: 'A.'},
                    {filename:'b', title: 'Node B', summary: 'B.'},
                ]
            })

            expect(getGraph).toHaveBeenCalledTimes(1)
            expect(getVaultPaths).toHaveBeenCalledTimes(1)
            expect(getWriteFolder).toHaveBeenCalledTimes(1)
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

            // Last call should be context node update
            const calls: Array<[GraphDelta, boolean | undefined]> = vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mock.calls as Array<[GraphDelta, boolean | undefined]>
            const lastDelta: GraphDelta = calls[calls.length - 1][0]
            expect(lastDelta[0].type).toBe('UpsertNode')

            if (lastDelta[0].type === 'UpsertNode') {
                const contextNode: GraphNode = lastDelta[0].nodeToUpsert
                const containedIds: readonly string[] = contextNode.nodeUIMetadata.containedNodeIds ?? []
                // Should have original 'existing-node.md' plus both new nodes
                expect(containedIds).toContain('existing-node.md')
                expect(containedIds.length).toBeGreaterThanOrEqual(3)
            }
        })
    })

    // =========================================================================
    // Mermaid validation (non-blocking)
    // =========================================================================

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

    // =========================================================================
    // Slug and unique ID
    // =========================================================================

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
            vi.mocked(getWriteFolder).mockResolvedValue(O.some(WRITE_PATH))
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
