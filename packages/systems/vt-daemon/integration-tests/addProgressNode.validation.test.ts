/**
 * Real-deps integration test for the create_graph RPC tool (validation +
 * line-length blocking). Mirrors the moved creation tests in setup style:
 * real terminal-registry, real settings (per-test temp voicetree-home),
 * capturing GraphBridge. No vi.mock of @vt/agent-runtime.
 */

import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import type {NodeIdAndFilePath} from '@vt/graph-model/graph'

import {createGraphTool} from '@vt/vt-daemon/create-graph/createGraphTool.ts'
import type {GraphBridge} from '@vt/vt-daemon/config/toolBridges.ts'
import {clearTerminalRecords} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry'
import {
    CALLER_TERMINAL_ID,
    WRITE_FOLDER,
    buildGraph,
    cleanupVoicetreeHome,
    parsePayload,
    setupRealDeps,
    type BridgeState,
    type ErrorPayload,
    type ToolResponse,
    type SuccessPayload,
} from './__helpers__/addProgressNode.testHelpers'

let voicetreeHome: string
let state: BridgeState
let bridge: GraphBridge

beforeEach(async () => {
    ({voicetreeHome, state, bridge} = await setupRealDeps())
})

afterEach(async () => {
    await cleanupVoicetreeHome(voicetreeHome)
})

describe('RPC create_graph tool — validation + line length', () => {
    describe('validation', () => {
        it('returns error when caller terminal ID is unknown', async () => {
            clearTerminalRecords() // erase the caller setupRealDeps recorded

            const response: ToolResponse = await createGraphTool({
                callerTerminalId: 'unknown-terminal',
                nodes: [{filename: 'a', title: 'Test', summary: 'Summary'}],
            }, bridge)
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('Unknown caller terminal')
        })

        it('returns error when no project is loaded', async () => {
            state.writeFolderPath = null

            const response: ToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [{filename: 'a', title: 'Test', summary: 'Summary'}],
            }, bridge)
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('No project loaded')
        })

        it('returns error when outputPath resolves outside loaded project paths', async () => {
            const response: ToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                outputPath: '../outside',
                nodes: [{filename: 'a', title: 'Test', summary: 'Summary'}],
            }, bridge)
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('outside the loaded project paths')
        })

        it('returns error when parent node is not found', async () => {
            // Replace the default graph with an empty one so the lookup misses.
            state.current = {
                nodes: {},
                incomingEdgesIndex: new Map(),
                nodeByBaseName: new Map(),
                unresolvedLinksIndex: new Map(),
            }

            const response: ToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                parentNodeId: 'nonexistent-node.md',
                nodes: [{filename: 'a', title: 'Test', summary: 'Summary'}],
            }, bridge)
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('not found')
        })

        it('returns error when nodes array is empty', async () => {
            const response: ToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [],
            }, bridge)
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('at least 1')
        })

        it('returns error when nodes have duplicate filenames', async () => {
            const response: ToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [
                    {filename: 'a', title: 'First', summary: 'Summary'},
                    {filename: 'a', title: 'Second', summary: 'Summary'},
                ],
            }, bridge)
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('Duplicate filename')
        })

        it('returns error when cycle detected in parent references', async () => {
            const response: ToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [
                    {filename: 'a', title: 'A', summary: 'S', content: '- parent [[b]]'},
                    {filename: 'b', title: 'B', summary: 'S', content: '- parent [[a]]'},
                ],
            }, bridge)
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('Cycle detected')
        })

        it('returns error when codeDiffs provided without complexity', async () => {
            const response: ToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [{filename: 'a', title: 'Test', summary: 'Summary', codeDiffs: ['- old\n+ new']}],
            }, bridge)
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('complexityScore')
        })
    })

    describe('line length blocking', () => {
        it('blocks creation when a node exceeds configured line limit', async () => {
            const longContent: string = Array.from({length: 75}, (_, i) => `Line ${i + 1}`).join('\n')

            const response: ToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [{filename: 'a', title: 'Long Node', summary: 'Summary.', content: longContent}],
            }, bridge)
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('too long')
            expect(payload.error).toContain('limit is 70')
        })

        it('exempts codeDiffs from line count', async () => {
            const largeDiff: string = Array.from({length: 40}, (_, i) => `- old ${i}\n+ new ${i}`).join('\n')

            const response: ToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [{
                    filename: 'a',
                    title: 'With Diffs',
                    summary: 'Short summary.',
                    codeDiffs: [largeDiff],
                    complexityScore: 'low',
                    complexityExplanation: 'Simple',
                }],
            }, bridge)
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload
            expect(payload.success).toBe(true)
        })

        it('exempts diagram from line count', async () => {
            const largeDiagram: string = Array.from({length: 40}, (_, i) => `A${i} --> B${i}`).join('\n')

            const response: ToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [{
                    filename: 'a',
                    title: 'With Diagram',
                    summary: 'Short summary.',
                    diagram: `flowchart TD\n${largeDiagram}`,
                }],
            }, bridge)
            const payload: SuccessPayload = parsePayload(response) as SuccessPayload
            expect(payload.success).toBe(true)
        })

        it('blocks all nodes if any single node is too long, and applies no deltas', async () => {
            const longContent: string = Array.from({length: 75}, (_, i) => `Line ${i + 1}`).join('\n')

            const response: ToolResponse = await createGraphTool({
                callerTerminalId: CALLER_TERMINAL_ID,
                nodes: [
                    {filename: 'a', title: 'Short', summary: 'OK.'},
                    {filename: 'b', title: 'Long', summary: 'Summary.', content: `- parent [[a]]\n${longContent}`},
                ],
            }, bridge)
            const payload: ErrorPayload = parsePayload(response) as ErrorPayload

            expect(response.isError).toBe(true)
            expect(payload.success).toBe(false)
            expect(payload.error).toContain('"b"')
            // Observable side-effect: no deltas applied.
            expect(state.deltas).toHaveLength(0)
        })
    })
})

// ============================================================================
// child-count + graph-complexity gates (real create_graph RPC, override bypass)
// ============================================================================

describe('RPC create_graph tool — child-count gate', () => {
    // Raise the subgraph gate out of the way so only child_count_limit fires.
    const SETTINGS = {subgraphWarnThreshold: 49, subgraphErrorThreshold: 50}

    function nChildren(count: number): {filename: string; title: string; summary: string}[] {
        return Array.from({length: count}, (_, i) => ({filename: `child-${i}`, title: `Child ${i}`, summary: 'S'}))
    }

    it('blocks when a node would exceed 4 children', async () => {
        ({voicetreeHome, state, bridge} = await setupRealDeps({settings: SETTINGS}))

        const response: ToolResponse = await createGraphTool({
            callerTerminalId: CALLER_TERMINAL_ID,
            parentNodeId: 'parent-task',
            nodes: nChildren(5),
        }, bridge)
        const payload: ErrorPayload = parsePayload(response) as ErrorPayload

        expect(response.isError).toBe(true)
        expect(payload.success).toBe(false)
        expect(payload.error).toContain('child_count_limit')
        expect(payload.error).toContain('5 children')
        expect(state.deltas).toHaveLength(0) // nothing written
    })

    it('allows the 5th child through with an override_with_rationale', async () => {
        ({voicetreeHome, state, bridge} = await setupRealDeps({settings: SETTINGS}))

        const response: ToolResponse = await createGraphTool({
            callerTerminalId: CALLER_TERMINAL_ID,
            parentNodeId: 'parent-task',
            nodes: nChildren(5),
            override_with_rationale: [{ruleId: 'child_count_limit', rationale: 'flat index node — children are siblings by design'}],
        }, bridge)
        const payload: SuccessPayload = parsePayload(response) as SuccessPayload

        expect(payload.success).toBe(true)
        expect(payload.nodes).toHaveLength(5)
        expect(state.deltas.length).toBeGreaterThan(0) // deltas applied
    })

    it('allows exactly 4 children without an override', async () => {
        ({voicetreeHome, state, bridge} = await setupRealDeps({settings: SETTINGS}))

        const response: ToolResponse = await createGraphTool({
            callerTerminalId: CALLER_TERMINAL_ID,
            parentNodeId: 'parent-task',
            nodes: Array.from({length: 4}, (_, i) => ({filename: `child-${i}`, title: `Child ${i}`, summary: 'S'})),
        }, bridge)
        const payload: SuccessPayload = parsePayload(response) as SuccessPayload

        expect(payload.success).toBe(true)
        expect(payload.nodes).toHaveLength(4)
    })
})

describe('RPC create_graph tool — graph-complexity gate', () => {
    it('blocks when the destination cluster crosses the block score, bypassable with rationale', async () => {
        // Low block score so any non-trivial structure trips the gate deterministically.
        const SETTINGS = {complexityWarnScore: 0.05, complexityBlockScore: 0.1}
        ;({voicetreeHome, state, bridge} = await setupRealDeps({settings: SETTINGS}))

        const blocked: ToolResponse = await createGraphTool({
            callerTerminalId: CALLER_TERMINAL_ID,
            parentNodeId: 'parent-task',
            nodes: [{filename: 'n', title: 'N', summary: 'S'}],
        }, bridge)
        const blockedPayload: ErrorPayload = parsePayload(blocked) as ErrorPayload
        expect(blocked.isError).toBe(true)
        expect(blockedPayload.error).toContain('graph_complexity_limit')

        ;({voicetreeHome, state, bridge} = await setupRealDeps({settings: SETTINGS}))
        const allowed: ToolResponse = await createGraphTool({
            callerTerminalId: CALLER_TERMINAL_ID,
            parentNodeId: 'parent-task',
            nodes: [{filename: 'n', title: 'N', summary: 'S'}],
            override_with_rationale: [{ruleId: 'graph_complexity_limit', rationale: 'inherently dense domain cluster'}],
        }, bridge)
        const allowedPayload: SuccessPayload = parsePayload(allowed) as SuccessPayload
        expect(allowedPayload.success).toBe(true)
    })
})

// Silence "unused" lint for buildGraph + WRITE_FOLDER imports — kept here so the
// test file is self-contained when future cases want to swap the graph.
void buildGraph
void WRITE_FOLDER
void ({} as NodeIdAndFilePath)
