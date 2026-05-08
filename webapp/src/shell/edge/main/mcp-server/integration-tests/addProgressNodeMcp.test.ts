import {describe, it, expect, vi, beforeEach} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath} from '@vt/graph-model/graph'

// Mock shell/edge dependencies
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
import {getVaultPaths, getWritePath} from '@vt/graph-db-server/watch-folder/vault-allowlist'
import {getGraph} from '@vt/graph-db-server/state/graph-store'
import {getTerminalRecords} from '@vt/agent-runtime'
import {applyGraphDeltaToDBThroughMemAndUIAndEditors} from '@vt/graph-db-server/graph/applyGraphDelta'
import {
    type McpToolResponse, type SuccessPayload, type ErrorPayload, parsePayload,
    WRITE_PATH, READ_PATH, CALLER_TERMINAL_ID,
    buildGraph, mockCallerTerminal, setupStandardMocks,
} from './createGraphMcp.helpers'

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

        it('returns error when outputPath resolves outside loaded vault paths', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                outputPath: '../outside',
                nodes: [{filename: 'a', title: 'Test', summary: 'Summary'}]
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('outside the loaded vault paths')
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
                    {filename:'a', title: 'Child', summary: 'Summary', parents: [{filename: 'nonexistent', edgeLabel: ''}]}
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
                    {filename:'a', title: 'A', summary: 'S', parents: [{filename: 'b', edgeLabel: ''}]},
                    {filename:'b', title: 'B', summary: 'S', parents: [{filename: 'a', edgeLabel: ''}]}
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
                    {filename:'b', title: 'Long', summary: 'Summary.', content: longContent, parents: [{filename: 'a', edgeLabel: ''}]}
                ]
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('"b"')
            expect(mockPostDelta).not.toHaveBeenCalled()
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

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [{filename:'a', title: 'Colored Node', summary: 'Work.'}]
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload

            expect(payload.success).toBe(true)

            const firstDelta: GraphDelta = mockPostDelta.mock.calls[0][0] as GraphDelta
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
})
