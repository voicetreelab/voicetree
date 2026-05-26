/**
 * Real-deps integration test for the create_graph MCP tool (validation +
 * line-length blocking). Mirrors the moved creation tests in setup style:
 * real terminal-registry, real settings (per-test temp app-support),
 * capturing GraphBridge. No vi.mock of @vt/agent-runtime.
 */

import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import type {NodeIdAndFilePath} from '@vt/graph-model/graph'

import {createGraphTool} from '@vt/vt-daemon'
import {clearTerminalRecords} from '@vt/agent-runtime'
import {
    CALLER_TERMINAL_ID,
    WRITE_FOLDER,
    buildGraph,
    cleanupAppSupport,
    parsePayload,
    setupRealDeps,
    type BridgeState,
    type ErrorPayload,
    type McpToolResponse,
    type SuccessPayload,
} from './__helpers__/addProgressNodeMcp.testHelpers'

let appSupport: string
let state: BridgeState

beforeEach(async () => {
    ({appSupport, state} = await setupRealDeps())
})

afterEach(async () => {
    await cleanupAppSupport(appSupport)
})

describe('MCP create_graph tool — validation + line length', () => {
    describe('validation', () => {
        it('returns error when caller terminal ID is unknown', async () => {
            clearTerminalRecords() // erase the caller setupRealDeps recorded

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: 'unknown-terminal',
                nodes: [{filename: 'a', title: 'Test', summary: 'Summary'}],
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('Unknown caller terminal')
        })

        it('returns error when no vault is loaded', async () => {
            state.writeFolder = null

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [{filename: 'a', title: 'Test', summary: 'Summary'}],
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('No vault loaded')
        })

        it('returns error when outputPath resolves outside loaded vault paths', async () => {
            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                outputPath: '../outside',
                nodes: [{filename: 'a', title: 'Test', summary: 'Summary'}],
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('outside the loaded vault paths')
        })

        it('returns error when parent node is not found', async () => {
            // Replace the default graph with an empty one so the lookup misses.
            state.current = {
                nodes: {},
                incomingEdgesIndex: new Map(),
                nodeByBaseName: new Map(),
                unresolvedLinksIndex: new Map(),
            }

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                parentNodeId: 'nonexistent-node.md',
                nodes: [{filename: 'a', title: 'Test', summary: 'Summary'}],
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('not found')
        })

        it('returns error when nodes array is empty', async () => {
            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [],
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('at least 1')
        })

        it('returns error when nodes have duplicate filenames', async () => {
            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [
                    {filename: 'a', title: 'First', summary: 'Summary'},
                    {filename: 'a', title: 'Second', summary: 'Summary'},
                ],
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('Duplicate filename')
        })

        it('returns error when cycle detected in parent references', async () => {
            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [
                    {filename: 'a', title: 'A', summary: 'S', content: '- parent [[b]]'},
                    {filename: 'b', title: 'B', summary: 'S', content: '- parent [[a]]'},
                ],
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('Cycle detected')
        })

        it('returns error when codeDiffs provided without complexity', async () => {
            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [{filename: 'a', title: 'Test', summary: 'Summary', codeDiffs: ['- old\n+ new']}],
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('complexityScore')
        })
    })

    describe('line length blocking', () => {
        it('blocks creation when a node exceeds configured line limit', async () => {
            const longContent: string = Array.from({length: 75}, (_, i) => `Line ${i + 1}`).join('\n')

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [{filename: 'a', title: 'Long Node', summary: 'Summary.', content: longContent}],
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('too long')
            expect(payload.error).toContain('limit is 70')
        })

        it('exempts codeDiffs from line count', async () => {
            const largeDiff: string = Array.from({length: 40}, (_, i) => `- old ${i}\n+ new ${i}`).join('\n')

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [{
                    filename: 'a',
                    title: 'With Diffs',
                    summary: 'Short summary.',
                    codeDiffs: [largeDiff],
                    complexityScore: 'low',
                    complexityExplanation: 'Simple',
                }],
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload
            expect(payload.success).toBe(true)
        })

        it('exempts diagram from line count', async () => {
            const largeDiagram: string = Array.from({length: 40}, (_, i) => `A${i} --> B${i}`).join('\n')

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [{
                    filename: 'a',
                    title: 'With Diagram',
                    summary: 'Short summary.',
                    diagram: `flowchart TD\n${largeDiagram}`,
                }],
            })
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload
            expect(payload.success).toBe(true)
        })

        it('blocks all nodes if any single node is too long, and applies no deltas', async () => {
            const longContent: string = Array.from({length: 75}, (_, i) => `Line ${i + 1}`).join('\n')

            const response: McpToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [
                    {filename: 'a', title: 'Short', summary: 'OK.'},
                    {filename: 'b', title: 'Long', summary: 'Summary.', content: `- parent [[a]]\n${longContent}`},
                ],
            })
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('"b"')
            // Observable side-effect: no deltas applied.
            expect(state.deltas).toHaveLength(0)
        })
    })
})

// Silence "unused" lint for buildGraph + WRITE_FOLDER imports — kept here so the
// test file is self-contained when future cases want to swap the graph.
void buildGraph
void WRITE_FOLDER
void ({} as NodeIdAndFilePath)
