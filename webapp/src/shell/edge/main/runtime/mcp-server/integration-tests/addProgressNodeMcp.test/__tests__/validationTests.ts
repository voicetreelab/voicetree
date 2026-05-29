import {describe, expect, it, vi} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import {createAddProgressNodeMcpTestHarness} from './testHarness'

type McpToolResponse = {
    content: Array<{type: 'text'; text: string}>
    isError?: boolean
}

type ErrorPayload = {
    success: false
    error: string
}

const {
    CALLER_TERMINAL_ID,
    createGraphTool,
    getGraph,
    getTerminalRecords,
    getWriteFolderPath,
    mockCallerTerminal,
    parsePayload,
    setupStandardMocks,
    WRITE_PATH,
} = createAddProgressNodeMcpTestHarness()

export function describeCreateGraphToolValidationTests(): void {
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

        it('returns error when no project is loaded', async () => {
            mockCallerTerminal()
            vi.mocked(getWriteFolderPath).mockResolvedValue(O.none)

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [{filename:'a', title: 'Test', summary: 'Summary'}]
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('No project loaded')
        })

        it('returns error when outputPath resolves outside loaded project paths', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                outputPath: '../outside',
                nodes: [{filename: 'a', title: 'Test', summary: 'Summary'}]
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('outside the loaded project paths')
        })

        it('returns error when parent node is not found', async () => {
            mockCallerTerminal()
            vi.mocked(getWriteFolderPath).mockResolvedValue(O.some(WRITE_PATH))
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
}
