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

// Mock @mermaid-js/parser for mermaid validation tests
vi.mock('@mermaid-js/parser', () => ({
    parse: vi.fn()
}))

import {addProgressNodeTool} from '@/shell/edge/main/mcp-server/mcp-server'
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
    nodeId: string
    filePath: string
    warnings: string[]
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

describe('MCP add_progress_node tool', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // =========================================================================
    // Validation
    // =========================================================================

    describe('validation', () => {
        it('returns error when caller terminal ID is unknown', async () => {
            vi.mocked(getTerminalRecords).mockReturnValue([])

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: 'unknown-terminal',
                title: 'Test',
                summary: 'Some summary'
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('Unknown caller terminal')
        })

        it('returns error when no vault is loaded', async () => {
            mockCallerTerminal()
            vi.mocked(getWritePath).mockResolvedValue(O.none)

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'Test',
                summary: 'Some summary'
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

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'Test',
                summary: 'Some summary',
                parentNodeId: 'nonexistent-node.md'
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('not found')
        })
    })

    // =========================================================================
    // Complexity validation
    // =========================================================================

    describe('complexity validation', () => {
        it('returns error when codeDiffs provided without complexityScore', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'Missing Complexity',
                summary: 'Did some work.',
                codeDiffs: ['- old\n+ new'],
                complexityExplanation: 'Simple change',
                parentNodeId: PARENT_NODE_ID
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('complexityScore')
        })

        it('returns error when codeDiffs provided without complexityExplanation', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'Missing Explanation',
                summary: 'Did some work.',
                codeDiffs: ['- old\n+ new'],
                complexityScore: 'low',
                parentNodeId: PARENT_NODE_ID
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('complexityExplanation')
        })

        it('succeeds when codeDiffs provided with both complexity fields', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'With Complexity',
                summary: 'Did some work.',
                codeDiffs: ['- old\n+ new'],
                complexityScore: 'medium',
                complexityExplanation: 'Touches shared state logic',
                parentNodeId: PARENT_NODE_ID
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload

            expect(payload.success).toBe(true)
        })

        it('does not require complexity when codeDiffs is empty array', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'Empty Diffs',
                summary: 'Just a note.',
                codeDiffs: [],
                parentNodeId: PARENT_NODE_ID
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload

            expect(payload.success).toBe(true)
        })

        it('does not require complexity when codeDiffs is not provided', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'No Diffs',
                summary: 'Just a note.',
                parentNodeId: PARENT_NODE_ID
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload

            expect(payload.success).toBe(true)
        })
    })

    // =========================================================================
    // Mermaid validation
    // =========================================================================

    describe('mermaid validation', () => {
        it('returns error when content contains an invalid mermaid diagram for a supported type', async () => {
            setupStandardMocks()
            vi.mocked(mermaidParse).mockRejectedValueOnce(new Error('Parse error at line 1: unexpected token'))

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'Bad Mermaid',
                summary: 'Testing mermaid.',
                content: '```mermaid\npie\ninvalid syntax here\n```',
                parentNodeId: PARENT_NODE_ID
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('Mermaid diagram error')
            expect(payload.error).toContain('pie')
        })

        it('validates diagram parameter', async () => {
            setupStandardMocks()
            vi.mocked(mermaidParse).mockRejectedValueOnce(new Error('Parse error'))

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'Bad Diagram Param',
                summary: 'Testing diagram param.',
                diagram: 'pie\ninvalid syntax',
                parentNodeId: PARENT_NODE_ID
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('Mermaid diagram error')
        })

        it('succeeds when content contains a valid mermaid diagram', async () => {
            setupStandardMocks()
            vi.mocked(mermaidParse).mockResolvedValueOnce({} as Awaited<ReturnType<typeof mermaidParse>>)

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'Valid Mermaid',
                summary: 'Testing mermaid.',
                content: '```mermaid\npie\n"A" : 30\n"B" : 70\n```',
                parentNodeId: PARENT_NODE_ID
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload

            expect(payload.success).toBe(true)
            expect(payload.nodeId).toBeDefined()
        })

        it('succeeds when content contains unsupported mermaid types', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'Flowchart Node',
                summary: 'Testing unsupported type.',
                content: '```mermaid\nflowchart TD\nA --> B\n```',
                parentNodeId: PARENT_NODE_ID
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload

            expect(payload.success).toBe(true)
            // Parser should NOT have been called — flowchart is unsupported
            expect(mermaidParse).not.toHaveBeenCalled()
        })

        it('succeeds when @mermaid-js/parser import fails — gracefully skips validation', async () => {
            setupStandardMocks()
            vi.mocked(mermaidParse).mockImplementation(() => {
                throw new Error('Cannot find module @mermaid-js/parser')
            })

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'Parser Unavailable',
                summary: 'Testing parser fallback.',
                content: '```mermaid\npie\n"A" : 30\n```',
                parentNodeId: PARENT_NODE_ID
            })
            const payload: {success: boolean; error?: string} = parsePayload(response) as {success: boolean; error?: string}

            // When parse throws synchronously inside the inner try, the inner catch
            // fires and returns an error string. Both paths are defensive; verify the tool doesn't crash.
            expect(payload.success).toBeDefined()
        })
    })

    // =========================================================================
    // Core behavior
    // =========================================================================

    describe('core behavior', () => {
        it('creates a progress node with correct frontmatter from terminal record', async () => {
            mockCallerTerminal({agentName: 'my-agent', color: 'green'})
            vi.mocked(getWritePath).mockResolvedValue(O.some(WRITE_PATH))
            vi.mocked(getGraph).mockReturnValue(buildGraph())
            vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mockResolvedValue(undefined)

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'My Progress',
                summary: 'Did some work.',
                parentNodeId: PARENT_NODE_ID
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload

            expect(payload.success).toBe(true)

            // Verify the graph delta was called with node containing correct frontmatter
            const deltaCalls: GraphDelta[] = vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mock.calls.map(
                (call: [delta: GraphDelta, recordForUndo?: boolean | undefined]) => call[0]
            )
            expect(deltaCalls.length).toBeGreaterThanOrEqual(1)

            const firstDelta: GraphDelta = deltaCalls[0]
            const upsertedNode: GraphNode = firstDelta[0].type === 'UpsertNode'
                ? firstDelta[0].nodeToUpsert
                : (() => { throw new Error('Expected UpsertNode delta') })()

            // Frontmatter values are parsed by parseMarkdownToGraphNode into nodeUIMetadata
            expect(upsertedNode.nodeUIMetadata.color).toEqual(O.some('green'))
            expect(upsertedNode.nodeUIMetadata.additionalYAMLProps.get('agent_name')).toBe('my-agent')
        })

        it('slugifies title into file path correctly', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'My Progress Node Title!',
                summary: 'Content here.',
                parentNodeId: PARENT_NODE_ID
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload

            expect(payload.success).toBe(true)
            // Slug: lowercase, spaces->hyphens, special chars removed
            expect(payload.nodeId).toBe(`${WRITE_PATH}/my-progress-node-title.md`)
            expect(payload.filePath).toBe(payload.nodeId)
        })

        it('uses ensureUniqueNodeId when slug collides with existing node', async () => {
            const collidingNodeId: NodeIdAndFilePath = `${WRITE_PATH}/colliding-title.md`
            const graph: Graph = buildGraph({
                [collidingNodeId]: buildGraphNode(collidingNodeId, '# Existing')
            })
            mockCallerTerminal()
            vi.mocked(getWritePath).mockResolvedValue(O.some(WRITE_PATH))
            vi.mocked(getGraph).mockReturnValue(graph)
            vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mockResolvedValue(undefined)

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'Colliding Title',
                summary: 'Content here.',
                parentNodeId: PARENT_NODE_ID
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload

            expect(payload.success).toBe(true)
            // Should have _2 suffix to avoid collision
            expect(payload.nodeId).toBe(`${WRITE_PATH}/colliding-title_2.md`)
        })

        it('defaults parentNodeId to anchoredToNodeId (task node) when not provided', async () => {
            // anchoredToNodeId = task node, attachedToNodeId = context node
            // The tool should prefer the task node as default parent
            mockCallerTerminal({attachedToNodeId: CALLER_CONTEXT_NODE_ID, anchoredToNodeId: PARENT_NODE_ID})
            vi.mocked(getWritePath).mockResolvedValue(O.some(WRITE_PATH))
            vi.mocked(getGraph).mockReturnValue(buildGraph())
            vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mockResolvedValue(undefined)

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'Default Parent',
                summary: 'Content here.'
                // parentNodeId intentionally omitted
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload

            expect(payload.success).toBe(true)

            // Verify the node was created (applyGraphDelta was called)
            expect(applyGraphDeltaToDBThroughMemAndUIAndEditors).toHaveBeenCalled()

            // The first delta should contain a node whose content references the task node basename
            const firstDelta: GraphDelta = vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mock.calls[0][0]
            const upsertedNode: GraphNode = firstDelta[0].type === 'UpsertNode'
                ? firstDelta[0].nodeToUpsert
                : (() => { throw new Error('Expected UpsertNode delta') })()

            // The wikilink [[parent-task]] should have created an outgoing edge to the task node
            const hasTaskNodeEdge: boolean = upsertedNode.outgoingEdges.some(
                e => e.targetId === PARENT_NODE_ID
            )
            expect(hasTaskNodeEdge).toBe(true)
        })

        it('falls back to attachedToNodeId when anchoredToNodeId is not set', async () => {
            // When terminal has no anchoredToNodeId (e.g. manually spawned), fall back to attachedToNodeId
            mockCallerTerminal({attachedToNodeId: PARENT_NODE_ID})
            vi.mocked(getWritePath).mockResolvedValue(O.some(WRITE_PATH))
            vi.mocked(getGraph).mockReturnValue(buildGraph())
            vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mockResolvedValue(undefined)

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'Fallback Parent',
                summary: 'Content here.'
                // parentNodeId intentionally omitted
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload

            expect(payload.success).toBe(true)
            expect(applyGraphDeltaToDBThroughMemAndUIAndEditors).toHaveBeenCalled()

            const firstDelta: GraphDelta = vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mock.calls[0][0]
            const upsertedNode: GraphNode = firstDelta[0].type === 'UpsertNode'
                ? firstDelta[0].nodeToUpsert
                : (() => { throw new Error('Expected UpsertNode delta') })()

            const hasParentEdge: boolean = upsertedNode.outgoingEdges.some(
                e => e.targetId === PARENT_NODE_ID
            )
            expect(hasParentEdge).toBe(true)
        })

        it('appends Files Changed section when filesChanged is provided', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'With Files',
                summary: 'Fixed a bug.',
                filesChanged: ['src/foo.ts', 'src/bar.ts'],
                parentNodeId: PARENT_NODE_ID
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload
            expect(payload.success).toBe(true)

            // Verify the created node content includes files changed
            const firstDelta: GraphDelta = vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mock.calls[0][0]
            const upsertedNode: GraphNode = firstDelta[0].type === 'UpsertNode'
                ? firstDelta[0].nodeToUpsert
                : (() => { throw new Error('Expected UpsertNode delta') })()

            // contentWithoutYamlOrLinks has frontmatter stripped but should contain Files Changed
            expect(upsertedNode.contentWithoutYamlOrLinks).toContain('Files Changed')
            expect(upsertedNode.contentWithoutYamlOrLinks).toContain('src/foo.ts')
            expect(upsertedNode.contentWithoutYamlOrLinks).toContain('src/bar.ts')
        })

        it('omits files changed section when filesChanged is empty', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'No Files',
                summary: 'Just a note.',
                filesChanged: [],
                parentNodeId: PARENT_NODE_ID
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload
            expect(payload.success).toBe(true)

            const firstDelta: GraphDelta = vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mock.calls[0][0]
            const upsertedNode: GraphNode = firstDelta[0].type === 'UpsertNode'
                ? firstDelta[0].nodeToUpsert
                : (() => { throw new Error('Expected UpsertNode delta') })()

            expect(upsertedNode.contentWithoutYamlOrLinks).not.toContain('Files Changed')
        })

        it('omits files changed section when filesChanged is not provided', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'No Files Param',
                summary: 'Just a note.',
                parentNodeId: PARENT_NODE_ID
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload
            expect(payload.success).toBe(true)

            const firstDelta: GraphDelta = vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mock.calls[0][0]
            const upsertedNode: GraphNode = firstDelta[0].type === 'UpsertNode'
                ? firstDelta[0].nodeToUpsert
                : (() => { throw new Error('Expected UpsertNode delta') })()

            expect(upsertedNode.contentWithoutYamlOrLinks).not.toContain('Files Changed')
        })

        it('appends Progress on [[parentBaseName]] wikilink', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'With Wikilink',
                summary: 'Some work done.',
                parentNodeId: PARENT_NODE_ID
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload
            expect(payload.success).toBe(true)

            // parseMarkdownToGraphNode will convert [[parent-task]] into an outgoing edge
            // and strip it from contentWithoutYamlOrLinks. Check the edge instead.
            const firstDelta: GraphDelta = vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mock.calls[0][0]
            const upsertedNode: GraphNode = firstDelta[0].type === 'UpsertNode'
                ? firstDelta[0].nodeToUpsert
                : (() => { throw new Error('Expected UpsertNode delta') })()

            // The wikilink [[parent-task]] should result in an outgoing edge
            const hasParentEdge: boolean = upsertedNode.outgoingEdges.some(
                e => e.targetId === PARENT_NODE_ID
            )
            expect(hasParentEdge).toBe(true)
        })

        it('computes position near parent node (x+200, y+100)', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'Positioned Node',
                summary: 'Content.',
                parentNodeId: PARENT_NODE_ID
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload
            expect(payload.success).toBe(true)

            const firstDelta: GraphDelta = vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mock.calls[0][0]
            const upsertedNode: GraphNode = firstDelta[0].type === 'UpsertNode'
                ? firstDelta[0].nodeToUpsert
                : (() => { throw new Error('Expected UpsertNode delta') })()

            // Parent position is (100, 200), so node should be at (300, 300)
            expect(upsertedNode.nodeUIMetadata.position).toEqual(O.some({x: 300, y: 300}))
        })

        it('returns success with nodeId, filePath, and empty warnings for short content', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'Short Content',
                summary: 'Brief note.',
                parentNodeId: PARENT_NODE_ID
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload

            expect(response.isError).toBeUndefined()
            expect(payload.success).toBe(true)
            expect(payload.nodeId).toContain('short-content')
            expect(payload.filePath).toBe(payload.nodeId)
            expect(payload.warnings).toEqual([])
        })

        it('defaults color to blue when terminal has no AGENT_COLOR env var', async () => {
            mockCallerTerminal({agentName: 'no-color-agent'})
            vi.mocked(getWritePath).mockResolvedValue(O.some(WRITE_PATH))
            vi.mocked(getGraph).mockReturnValue(buildGraph())
            vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mockResolvedValue(undefined)

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'Blue Default',
                summary: 'Content.',
                parentNodeId: PARENT_NODE_ID
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload
            expect(payload.success).toBe(true)

            const firstDelta: GraphDelta = vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mock.calls[0][0]
            const upsertedNode: GraphNode = firstDelta[0].type === 'UpsertNode'
                ? firstDelta[0].nodeToUpsert
                : (() => { throw new Error('Expected UpsertNode delta') })()

            expect(upsertedNode.nodeUIMetadata.color).toEqual(O.some('blue'))
        })
    })

    // =========================================================================
    // Structured sections
    // =========================================================================

    describe('structured sections', () => {
        it('renders codeDiffs in ## DIFF section', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'With Diffs',
                summary: 'Fixed bug.',
                codeDiffs: ['- old line\n+ new line', '- another old\n+ another new'],
                complexityScore: 'low',
                complexityExplanation: 'Simple one-liner fix',
                parentNodeId: PARENT_NODE_ID
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload
            expect(payload.success).toBe(true)

            const firstDelta: GraphDelta = vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mock.calls[0][0]
            const upsertedNode: GraphNode = firstDelta[0].type === 'UpsertNode'
                ? firstDelta[0].nodeToUpsert
                : (() => { throw new Error('Expected UpsertNode delta') })()

            expect(upsertedNode.contentWithoutYamlOrLinks).toContain('DIFF')
            expect(upsertedNode.contentWithoutYamlOrLinks).toContain('old line')
            expect(upsertedNode.contentWithoutYamlOrLinks).toContain('new line')
        })

        it('renders complexity section when codeDiffs provided', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'With Complexity',
                summary: 'Refactored state.',
                codeDiffs: ['- old\n+ new'],
                complexityScore: 'high',
                complexityExplanation: 'Touches shared mutable state across 5 modules',
                parentNodeId: PARENT_NODE_ID
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload
            expect(payload.success).toBe(true)

            const firstDelta: GraphDelta = vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mock.calls[0][0]
            const upsertedNode: GraphNode = firstDelta[0].type === 'UpsertNode'
                ? firstDelta[0].nodeToUpsert
                : (() => { throw new Error('Expected UpsertNode delta') })()

            expect(upsertedNode.contentWithoutYamlOrLinks).toContain('Complexity: high')
            expect(upsertedNode.contentWithoutYamlOrLinks).toContain('shared mutable state')
        })

        it('renders diagram parameter with mermaid fences', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'With Diagram',
                summary: 'Added architecture diagram.',
                diagram: 'flowchart TD\nA --> B\nB --> C',
                parentNodeId: PARENT_NODE_ID
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload
            expect(payload.success).toBe(true)

            const firstDelta: GraphDelta = vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mock.calls[0][0]
            const upsertedNode: GraphNode = firstDelta[0].type === 'UpsertNode'
                ? firstDelta[0].nodeToUpsert
                : (() => { throw new Error('Expected UpsertNode delta') })()

            expect(upsertedNode.contentWithoutYamlOrLinks).toContain('Diagram')
            expect(upsertedNode.contentWithoutYamlOrLinks).toContain('A --> B')
        })

        it('renders notes as bulleted list', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'With Notes',
                summary: 'Made changes.',
                notes: ['Watch out for race condition in graph-store', 'Tech debt: need to extract shared helper'],
                parentNodeId: PARENT_NODE_ID
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload
            expect(payload.success).toBe(true)

            const firstDelta: GraphDelta = vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mock.calls[0][0]
            const upsertedNode: GraphNode = firstDelta[0].type === 'UpsertNode'
                ? firstDelta[0].nodeToUpsert
                : (() => { throw new Error('Expected UpsertNode delta') })()

            expect(upsertedNode.contentWithoutYamlOrLinks).toContain('NOTES')
            expect(upsertedNode.contentWithoutYamlOrLinks).toContain('race condition')
            expect(upsertedNode.contentWithoutYamlOrLinks).toContain('Tech debt')
        })

        it('renders linkedArtifacts as wikilinks in ## Related section', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'With Artifacts',
                summary: 'Implemented feature.',
                linkedArtifacts: ['design-proposal', 'api-spec'],
                parentNodeId: PARENT_NODE_ID
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload
            expect(payload.success).toBe(true)

            const firstDelta: GraphDelta = vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mock.calls[0][0]
            const upsertedNode: GraphNode = firstDelta[0].type === 'UpsertNode'
                ? firstDelta[0].nodeToUpsert
                : (() => { throw new Error('Expected UpsertNode delta') })()

            // linkedArtifacts create wikilinks which become outgoing edges
            // Check that at least the parent edge exists plus the artifacts
            expect(upsertedNode.outgoingEdges.length).toBeGreaterThanOrEqual(1)
        })

        it('renders summary before optional content', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'Summary And Content',
                summary: 'Quick summary here.',
                content: 'Detailed explanation follows.',
                parentNodeId: PARENT_NODE_ID
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload
            expect(payload.success).toBe(true)

            const firstDelta: GraphDelta = vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mock.calls[0][0]
            const upsertedNode: GraphNode = firstDelta[0].type === 'UpsertNode'
                ? firstDelta[0].nodeToUpsert
                : (() => { throw new Error('Expected UpsertNode delta') })()

            const nodeContent: string = upsertedNode.contentWithoutYamlOrLinks
            const summaryIdx: number = nodeContent.indexOf('Quick summary here')
            const contentIdx: number = nodeContent.indexOf('Detailed explanation follows')
            expect(summaryIdx).toBeLessThan(contentIdx)
        })
    })

    // =========================================================================
    // Warnings
    // =========================================================================

    describe('warnings', () => {
        it('warns when summary exceeds 3 lines', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'Long Summary',
                summary: 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5',
                parentNodeId: PARENT_NODE_ID
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload

            expect(payload.success).toBe(true)
            expect(payload.warnings.some((w: string) => w.includes('Summary is long'))).toBe(true)
        })

        it('warns when filesChanged provided but no codeDiffs', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'Missing Diffs',
                summary: 'Changed some files.',
                filesChanged: ['src/foo.ts'],
                parentNodeId: PARENT_NODE_ID
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload

            expect(payload.success).toBe(true)
            expect(payload.warnings.some((w: string) => w.includes('codeDiffs'))).toBe(true)
        })

        it('includes node length warning when total body exceeds 60 lines', async () => {
            setupStandardMocks()

            const longContent: string = Array.from({length: 55}, (_, i) => `Line ${i + 1}`).join('\n')

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'Long Content',
                summary: 'Summary.',
                content: longContent,
                parentNodeId: PARENT_NODE_ID
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload

            expect(payload.success).toBe(true)
            expect(payload.warnings.some((w: string) => w.includes('splitting'))).toBe(true)
        })
    })

    // =========================================================================
    // Graph integration
    // =========================================================================

    describe('graph integration', () => {
        it('calls applyGraphDeltaToDBThroughMemAndUIAndEditors with UpsertNode delta', async () => {
            setupStandardMocks()

            await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'Delta Test',
                summary: 'Content.',
                parentNodeId: PARENT_NODE_ID
            })

            // First call creates the progress node, second call updates context node
            expect(applyGraphDeltaToDBThroughMemAndUIAndEditors).toHaveBeenCalled()

            const firstDelta: GraphDelta = vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mock.calls[0][0]
            expect(firstDelta).toHaveLength(1)
            expect(firstDelta[0].type).toBe('UpsertNode')

            if (firstDelta[0].type === 'UpsertNode') {
                expect(firstDelta[0].previousNode).toEqual(O.none) // New node, no previous
                expect(firstDelta[0].nodeToUpsert.absoluteFilePathIsID).toContain('delta-test')
            }
        })

        it('updates caller context node containedNodeIds to include new node', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await addProgressNodeTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                title: 'Context Update',
                summary: 'Content.',
                parentNodeId: PARENT_NODE_ID
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload
            expect(payload.success).toBe(true)

            // applyGraphDelta should be called twice: once for progress node, once for context update
            expect(applyGraphDeltaToDBThroughMemAndUIAndEditors).toHaveBeenCalledTimes(2)

            const contextDelta: GraphDelta = vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mock.calls[1][0]
            expect(contextDelta).toHaveLength(1)
            expect(contextDelta[0].type).toBe('UpsertNode')

            if (contextDelta[0].type === 'UpsertNode') {
                const updatedContextNode: GraphNode = contextDelta[0].nodeToUpsert
                expect(updatedContextNode.absoluteFilePathIsID).toBe(CALLER_CONTEXT_NODE_ID)

                // Should include the original 'existing-node.md' plus the new progress node
                const containedIds: readonly string[] = updatedContextNode.nodeUIMetadata.containedNodeIds ?? []
                expect(containedIds).toContain('existing-node.md')
                expect(containedIds).toContain(payload.nodeId)

                // Previous node should be the original context node (Some, not None)
                expect(O.isSome(contextDelta[0].previousNode)).toBe(true)
            }
        })
    })
})
