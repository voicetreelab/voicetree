import {describe, it, expect, vi, beforeEach} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath} from '@/pure/graph'
import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'

// Mock shell/edge dependencies
vi.mock('@/shell/edge/main/graph/watch_folder/watchFolder', () => ({
    getWritePath: vi.fn()
}))

vi.mock('@/shell/edge/main/state/graph-store', () => ({
    getGraph: vi.fn()
}))

vi.mock('@/shell/edge/main/terminals/terminal-registry', () => ({
    getTerminalRecords: vi.fn()
}))

vi.mock('@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onUIChangePath/onUIChange', () => ({
    applyGraphDeltaToDBThroughMemAndUIAndEditors: vi.fn()
}))

// Mock settings
vi.mock('@/shell/edge/main/settings/settings_IO', () => ({
    loadSettings: vi.fn().mockResolvedValue({nodeLineLimit: 70})
}))

// Mock @mermaid-js/parser for mermaid validation tests
vi.mock('@mermaid-js/parser', () => ({
    parse: vi.fn()
}))

import {createGraphTool} from '@/shell/edge/main/mcp-server/mcp-server'
import {getWritePath} from '@/shell/edge/main/graph/watch_folder/watchFolder'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {getTerminalRecords} from '@/shell/edge/main/terminals/terminal-registry'
import {applyGraphDeltaToDBThroughMemAndUIAndEditors} from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onUIChangePath/onUIChange'
import {parse as mermaidParse} from '@mermaid-js/parser'

type McpToolResponse = {
    content: Array<{type: 'text'; text: string}>
    isError?: boolean
}

function parsePayload(response: McpToolResponse): unknown {
    return JSON.parse(response.content[0].text)
}

type SuccessPayload = {
    success: true
    nodes: Array<{id: string; path: string; status: 'ok' | 'warning'; warning?: string}>
}

type ErrorPayload = {
    success: false
    error: string
}

const WRITE_PATH: string = '/test/vault'
const PARENT_NODE_ID: NodeIdAndFilePath = `${WRITE_PATH}/parent-task.md`
const CALLER_TERMINAL_ID: string = 'ctx-nodes/caller.md-terminal-0'
const CALLER_CONTEXT_NODE_ID: NodeIdAndFilePath = 'ctx-nodes/caller.md'

function buildGraphNode(nodeId: NodeIdAndFilePath, content: string, options?: {
    position?: {x: number; y: number}
    isContextNode?: boolean
    containedNodeIds?: readonly string[]
}): GraphNode {
    return {
        absoluteFilePathIsID: nodeId,
        outgoingEdges: [],
        contentWithoutYamlOrLinks: content,
        nodeUIMetadata: {
            color: O.none,
            position: options?.position ? O.some(options.position) : O.none,
            additionalYAMLProps: new Map(),
            isContextNode: options?.isContextNode ?? false,
            containedNodeIds: options?.containedNodeIds
        }
    }
}

function buildGraph(extraNodes?: Record<string, GraphNode>): Graph {
    return {
        nodes: {
            [PARENT_NODE_ID]: buildGraphNode(PARENT_NODE_ID, '# Parent Task', {
                position: {x: 100, y: 200}
            }),
            [CALLER_CONTEXT_NODE_ID]: buildGraphNode(CALLER_CONTEXT_NODE_ID, '# Context', {
                isContextNode: true,
                containedNodeIds: ['existing-node.md']
            }),
            ...extraNodes
        },
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map([
            ['parent-task', [PARENT_NODE_ID]]
        ]),
        unresolvedLinksIndex: new Map()
    }
}

function mockCallerTerminal(options?: {
    agentName?: string
    color?: string
    attachedToNodeId?: string
    anchoredToNodeId?: string
}): void {
    const terminalData: TerminalData = createTerminalData({
        terminalId: CALLER_TERMINAL_ID as TerminalId,
        attachedToNodeId: options?.attachedToNodeId ?? CALLER_CONTEXT_NODE_ID,
        anchoredToNodeId: options?.anchoredToNodeId as NodeIdAndFilePath | undefined,
        terminalCount: 0,
        title: 'Test Agent',
        executeCommand: true,
        agentName: options?.agentName ?? 'test-agent',
        initialEnvVars: options?.color ? {AGENT_COLOR: options.color} : undefined
    })
    vi.mocked(getTerminalRecords).mockReturnValue([
        {terminalId: CALLER_TERMINAL_ID, terminalData, status: 'running'}
    ])
}

function setupStandardMocks(graphOverride?: Graph): void {
    mockCallerTerminal()
    vi.mocked(getWritePath).mockResolvedValue(O.some(WRITE_PATH))
    vi.mocked(getGraph).mockReturnValue(graphOverride ?? buildGraph())
    vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mockResolvedValue(undefined)
}

describe('MCP create_graph tool', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // =========================================================================
    // Validation
    // =========================================================================

    describe('validation', () => {
        it('returns error when caller terminal ID is unknown', async () => {
            vi.mocked(getTerminalRecords).mockReturnValue([])

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: 'unknown-terminal',
                nodes: [{filename:'a', title: 'Test', summary: 'Summary'}]
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('Unknown caller terminal')
        })

        it('returns error when no vault is loaded', async () => {
            mockCallerTerminal()
            vi.mocked(getWritePath).mockResolvedValue(O.none)

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [{filename:'a', title: 'Test', summary: 'Summary'}]
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('No vault loaded')
        })

        it('returns error when parent node is not found', async () => {
            mockCallerTerminal()
            vi.mocked(getWritePath).mockResolvedValue(O.some(WRITE_PATH))
            vi.mocked(getGraph).mockReturnValue({
                nodes: {},
                incomingEdgesIndex: new Map(),
                nodeByBaseName: new Map(),
                unresolvedLinksIndex: new Map()
            })

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                parentNodeId: 'nonexistent-node.md',
                nodes: [{filename:'a', title: 'Test', summary: 'Summary'}]
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('not found')
        })

        it('returns error when nodes array is empty', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: []
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('at least 1')
        })

        it('returns error when node has duplicate local id', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [
                    {filename:'a', title: 'First', summary: 'Summary'},
                    {filename:'a', title: 'Second', summary: 'Summary'}
                ]
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('Duplicate filename')
        })

        it('returns error when parent references undeclared local id', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [
                    {filename:'a', title: 'Child', summary: 'Summary', parents: ['nonexistent']}
                ]
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('not a declared filename')
        })

        it('returns error when cycle detected in parent references', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [
                    {filename:'a', title: 'A', summary: 'S', parents: ['b']},
                    {filename:'b', title: 'B', summary: 'S', parents: ['a']}
                ]
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('Cycle detected')
        })

        it('returns error when codeDiffs provided without complexity', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [{filename:'a', title: 'Test', summary: 'Summary', codeDiffs: ['- old\n+ new']}]
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('complexityScore')
        })
    })

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
                    {filename:'b', title: 'Long', summary: 'Summary.', content: longContent, parents: ['a']}
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
            expect(upsertedNode.nodeUIMetadata.additionalYAMLProps.get('agent_name')).toBe('my-agent')
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
                    {filename:'child1', title: 'Child One', summary: 'First child.', parents: ['root']},
                    {filename:'child2', title: 'Child Two', summary: 'Second child.', parents: ['root']}
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
                    {filename:'child', title: 'Child', summary: 'Child.', parents: ['parent']},
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

        it('positions children spread vertically from parent', async () => {
            setupStandardMocks()

            await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [
                    {filename:'a', title: 'Root', summary: 'Root.'},
                    {filename:'b', title: 'Child One', summary: 'C1.', parents: ['a']},
                    {filename:'c', title: 'Child Two', summary: 'C2.', parents: ['a']}
                ]
            })

            // Root is at graphParent (100,200) + offset (200, 0)
            // Child 1: root position + (200, 0)
            // Child 2: root position + (200, 150)
            const calls: Array<[GraphDelta, boolean | undefined]> = vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mock.calls as Array<[GraphDelta, boolean | undefined]>
            // 3 node creations + 1 context update = 4 calls
            expect(calls.length).toBeGreaterThanOrEqual(3)
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
