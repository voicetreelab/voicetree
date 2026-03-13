import {describe, it, expect, vi, beforeEach} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type {GraphNode, NodeIdAndFilePath} from '@/pure/graph'
import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'
import type {TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import {clearAllBudgets, setRootBudget} from '@/shell/edge/main/terminals/global-budget-registry'

vi.mock('@/shell/edge/main/graph/watch_folder/watchFolder', () => ({
    getWritePath: vi.fn()
}))

vi.mock('@/shell/edge/main/state/graph-store', () => ({
    getGraph: vi.fn()
}))

vi.mock('@/shell/edge/main/terminals/spawnTerminalWithContextNode', () => ({
    spawnTerminalWithContextNode: vi.fn()
}))

vi.mock('@/shell/edge/main/graph/context-nodes/getUnseenNodesAroundContextNode', () => ({
    getUnseenNodesAroundContextNode: vi.fn()
}))

vi.mock('@/shell/edge/main/terminals/terminal-registry', () => ({
    getTerminalRecords: vi.fn(),
    recordTerminalSpawn: vi.fn()
}))

vi.mock('@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onUIChangePath/onUIChange', () => ({
    applyGraphDeltaToDBThroughMemAndUIAndEditors: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/shell/edge/main/mcp-server/agent-completion-monitor', () => ({
    startMonitor: vi.fn().mockReturnValue('monitor-1')
}))

import {applyGraphDeltaToDBThroughMemAndUIAndEditors} from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onUIChangePath/onUIChange'
import {spawnAgentTool} from '@/shell/edge/main/mcp-server/mcp-server'
import {getWritePath} from '@/shell/edge/main/graph/watch_folder/watchFolder'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {spawnTerminalWithContextNode} from '@/shell/edge/main/terminals/spawnTerminalWithContextNode'
import {getTerminalRecords, recordTerminalSpawn} from '@/shell/edge/main/terminals/terminal-registry'
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";

type McpToolResponse = {
    content: Array<{type: 'text'; text: string}>
    isError?: boolean
}

function parsePayload(response: McpToolResponse): unknown {
    return JSON.parse(response.content[0].text)
}

function buildGraphNode(nodeId: NodeIdAndFilePath, content: string, agentName?: string): GraphNode {
    return {
        outgoingEdges: [],
        absoluteFilePathIsID: nodeId,
        contentWithoutYamlOrLinks: content,
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: agentName ? new Map([['agent_name', agentName]]) : new Map(),
            isContextNode: false
        }
    }
}

describe('MCP spawn_agent global budget enforcement', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        clearAllBudgets()
    })

    function mockRootTerminalWithGlobalBudget(budget: string): TerminalData {
        const rootTerminalData: TerminalData = createTerminalData({
            terminalId: 'root-terminal' as TerminalId,
            attachedToNodeId: 'ctx-nodes/root.md',
            terminalCount: 0,
            title: 'Root Agent',
            executeCommand: true,
            agentName: 'root',
            parentTerminalId: null,
            initialEnvVars: {GLOBAL_SPAWN_BUDGET: budget}
        })
        
        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'root-terminal', terminalData: rootTerminalData, status: 'running', exitCode: null, auditRetryCount: 0, spawnedAt: 0}
        ])
        
        // Set the budget in the registry (normally done by spawnTerminalWithContextNode)
        setRootBudget('root-terminal', parseInt(budget, 10))
        
        return rootTerminalData
    }

    function mockChildTerminal(parentId: string, terminalId: string): TerminalData {
        const childTerminalData: TerminalData = createTerminalData({
            terminalId: terminalId as TerminalId,
            attachedToNodeId: `ctx-nodes/${terminalId}.md`,
            terminalCount: 0,
            title: `Child ${terminalId}`,
            executeCommand: true,
            agentName: terminalId,
            parentTerminalId: parentId as TerminalId
        })
        
        const existingRecords = vi.mocked(getTerminalRecords).mock.results[0]?.value as TerminalRecord[] || []
        vi.mocked(getTerminalRecords).mockReturnValue([
            ...existingRecords,
            {terminalId, terminalData: childTerminalData, status: 'running', exitCode: null, auditRetryCount: 0, spawnedAt: 0}
        ])
        
        return childTerminalData
    }

    function setupGraphAndSpawn(): void {
        vi.mocked(getWritePath).mockResolvedValue(O.some('/vault'))
        vi.mocked(getGraph).mockReturnValue({
            nodes: {'node-1.md': buildGraphNode('node-1.md', '# Node One')},
            incomingEdgesIndex: new Map(),
            nodeByBaseName: new Map(),
            unresolvedLinksIndex: new Map()
        })
        vi.mocked(spawnTerminalWithContextNode).mockResolvedValue({
            terminalId: 'child-terminal-0',
            contextNodeId: 'ctx-nodes/child_context.md'
        })
    }

    it('allows spawning when global budget is sufficient', async () => {
        mockRootTerminalWithGlobalBudget('5')
        setupGraphAndSpawn()

        const response: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'root-terminal'})
        const payload: {success: boolean; error?: string} = parsePayload(response) as {success: boolean; error?: string}

        expect(payload.success).toBe(true)
        expect(payload.error).toBeUndefined()
    })

    it('blocks spawning when global budget is exhausted', async () => {
        mockRootTerminalWithGlobalBudget('2')
        setupGraphAndSpawn()

        // First spawn - should succeed
        const response1: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'root-terminal'})
        const payload1: {success: boolean} = parsePayload(response1) as {success: boolean}
        expect(payload1.success).toBe(true)

        // Second spawn - should succeed
        const response2: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'root-terminal'})
        const payload2: {success: boolean} = parsePayload(response2) as {success: boolean}
        expect(payload2.success).toBe(true)

        // Third spawn - should fail (budget exhausted)
        const response3: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'root-terminal'})
        const payload3: {success: boolean; error?: string} = parsePayload(response3) as {success: boolean; error?: string}
        expect(payload3.success).toBe(false)
        expect(payload3.error).toContain('Global spawn budget exhausted')
    })

    it('child terminals use root budget, not their own', async () => {
        // Set up root with budget
        mockRootTerminalWithGlobalBudget('3')
        setupGraphAndSpawn()

        // Spawn first child from root
        const response1: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'root-terminal'})
        expect(parsePayload(response1)).toHaveProperty('success', true)

        // Mock the child terminal as having been spawned
        mockChildTerminal('root-terminal', 'child-1')

        // Spawn from child - should use root's budget
        const response2: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'child-1'})
        expect(parsePayload(response2)).toHaveProperty('success', true)

        // Spawn another from child
        const response3: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'child-1'})
        expect(parsePayload(response3)).toHaveProperty('success', true)

        // Fourth spawn should fail (budget of 3 exhausted)
        const response4: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'child-1'})
        const payload4: {success: boolean; error?: string} = parsePayload(response4) as {success: boolean; error?: string}
        expect(payload4.success).toBe(false)
        expect(payload4.error).toContain('Global spawn budget exhausted')
    })

    it('allows unlimited spawning when no global budget set', async () => {
        // Root without GLOBAL_SPAWN_BUDGET
        const rootTerminalData: TerminalData = createTerminalData({
            terminalId: 'root-terminal' as TerminalId,
            attachedToNodeId: 'ctx-nodes/root.md',
            terminalCount: 0,
            title: 'Root Agent',
            executeCommand: true,
            agentName: 'root',
            parentTerminalId: null
        })
        
        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'root-terminal', terminalData: rootTerminalData, status: 'running', exitCode: null, auditRetryCount: 0, spawnedAt: 0}
        ])
        
        setupGraphAndSpawn()

        // Spawn many times - should always succeed
        for (let i = 0; i < 10; i++) {
            const response: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'root-terminal'})
            const payload: {success: boolean} = parsePayload(response) as {success: boolean}
            expect(payload.success).toBe(true)
        }
    })

    it('decrements budget by specified amount when spawning multiple', async () => {
        mockRootTerminalWithGlobalBudget('5')
        setupGraphAndSpawn()

        // First spawn uses 1
        const response1: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'root-terminal'})
        expect(parsePayload(response1)).toHaveProperty('success', true)

        // Second spawn uses 1
        const response2: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'root-terminal'})
        expect(parsePayload(response2)).toHaveProperty('success', true)

        // Third spawn uses 1 - budget now 2
        const response3: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'root-terminal'})
        expect(parsePayload(response3)).toHaveProperty('success', true)

        // Fourth spawn uses 1 - budget now 1
        const response4: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'root-terminal'})
        expect(parsePayload(response4)).toHaveProperty('success', true)

        // Fifth spawn uses 1 - budget now 0
        const response5: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'root-terminal'})
        expect(parsePayload(response5)).toHaveProperty('success', true)

        // Sixth spawn should fail
        const response6: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'root-terminal'})
        const payload6: {success: boolean; error?: string} = parsePayload(response6) as {success: boolean; error?: string}
        expect(payload6.success).toBe(false)
        expect(payload6.error).toContain('Global spawn budget exhausted')
    })
})
