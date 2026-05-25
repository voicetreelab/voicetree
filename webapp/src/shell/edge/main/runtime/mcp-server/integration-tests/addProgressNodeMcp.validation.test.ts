import {describe, it, expect, vi, beforeEach} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'

vi.mock('@vt/graph-db-server/watch-folder/vault-allowlist', () => ({
    getWriteFolder: vi.fn(),
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
import {getWriteFolder} from '@vt/graph-db-server/watch-folder/vault-allowlist'
import {getGraph} from '@vt/graph-db-server/state/graph-store'
import {getTerminalRecords} from '@vt/agent-runtime'
import {applyGraphDeltaToDBThroughMemAndUIAndEditors} from '@vt/graph-db-server/graph/applyGraphDelta'
import {
    CALLER_TERMINAL_ID,
    WRITE_FOLDER,
    type ErrorPayload,
    type McpToolResponse,
    type SuccessPayload,
    configureCreateGraphServer,
    mockCallerTerminal,
    parsePayload,
    setupStandardMocks,
} from './__tests__/addProgressNodeMcp.testHelpers'

describe('MCP create_graph tool — validation + line length', () => {
    beforeEach(async () => {
        vi.clearAllMocks()
        await configureCreateGraphServer()
    })

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
            vi.mocked(getWriteFolder).mockResolvedValue(O.none)

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
            vi.mocked(getWriteFolder).mockResolvedValue(O.some(WRITE_FOLDER))
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

        it('returns error when cycle detected in parent references', async () => {
            setupStandardMocks()

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [
                    {filename:'a', title: 'A', summary: 'S', content: '- parent [[b]]'},
                    {filename:'b', title: 'B', summary: 'S', content: '- parent [[a]]'}
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
                    {filename:'b', title: 'Long', summary: 'Summary.', content: `- parent [[a]]\n${longContent}`}
                ]
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('"b"')
            expect(applyGraphDeltaToDBThroughMemAndUIAndEditors).not.toHaveBeenCalled()
        })
    })
})
