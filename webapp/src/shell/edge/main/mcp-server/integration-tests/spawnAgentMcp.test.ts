import {describe, it, expect, vi, beforeEach} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type {GraphNode, NodeIdAndFilePath} from '@vt/graph-model/pure/graph'
import type {VTSettings} from '@vt/graph-model/pure/settings'
import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'

vi.mock('@/shell/edge/main/graph/watch_folder/watchFolder', () => ({
    getWritePath: vi.fn()
}))

vi.mock('@/shell/edge/main/state/graph-store', () => ({
    getGraph: vi.fn()
}))

vi.mock('@/shell/edge/main/terminals/spawnTerminalWithContextNode', () => ({
    spawnTerminalWithContextNode: vi.fn()
}))

vi.mock('@/shell/edge/main/terminals/terminal-registry', () => ({
    getTerminalRecords: vi.fn()
}))

vi.mock('@/shell/edge/main/settings/settings_IO', () => ({
    loadSettings: vi.fn()
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
import {getTerminalRecords} from '@/shell/edge/main/terminals/terminal-registry'
import {loadSettings} from '@/shell/edge/main/settings/settings_IO'
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

const TEST_AGENTS: readonly {name: string; command: string}[] = [
    {name: 'Claude Sonnet', command: 'claude-sonnet --prompt "$AGENT_PROMPT"'},
    {name: 'Codex', command: 'codex --prompt "$AGENT_PROMPT"'}
]

function mockCallerTerminal(): void {
    const callerTerminalData: TerminalData = createTerminalData({
        terminalId: 'caller-terminal-99' as TerminalId,
        attachedToNodeId: 'ctx-nodes/caller.md',
        terminalCount: 99,
        title: 'Caller',
        executeCommand: true,
        agentName: 'caller'
    })
    vi.mocked(getTerminalRecords).mockReturnValue([
        {terminalId: 'caller-terminal-99', terminalData: callerTerminalData, status: 'running', exitCode: null, auditRetryCount: 0, spawnedAt: 0}
    ])
}

function mockCallerWithType(agentTypeName: string): void {
    const callerTerminalData: TerminalData = createTerminalData({
        terminalId: 'caller-terminal-99' as TerminalId,
        attachedToNodeId: 'ctx-nodes/caller.md',
        terminalCount: 99,
        title: 'Caller',
        executeCommand: true,
        agentName: 'caller',
        agentTypeName
    })
    vi.mocked(getTerminalRecords).mockReturnValue([
        {terminalId: 'caller-terminal-99', terminalData: callerTerminalData, status: 'running', exitCode: null, auditRetryCount: 0, spawnedAt: 0}
    ])
}

function setupGraph(nodeId: string = 'node-1.md', content: string = '# Node One'): void {
    vi.mocked(getWritePath).mockResolvedValue(O.some('/vault'))
    vi.mocked(getGraph).mockReturnValue({
        nodes: {[nodeId]: buildGraphNode(nodeId, content)},
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map()
    })
    vi.mocked(spawnTerminalWithContextNode).mockResolvedValue({
        terminalId: 'node-1-terminal-0',
        contextNodeId: 'ctx-nodes/node-1_context.md'
    })
}

describe('MCP spawn_agent tool', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(loadSettings).mockResolvedValue({agents: []} as unknown as VTSettings)
    })

    it('spawns an agent on an existing node', async () => {
        mockCallerTerminal()
        setupGraph()

        const response: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'caller-terminal-99'})
        const payload: {success: boolean; terminalId: string; nodeId: string; contextNodeId: string; message: string} =
            parsePayload(response) as {success: boolean; terminalId: string; nodeId: string; contextNodeId: string; message: string}

        expect(payload.success).toBe(true)
        expect(payload.nodeId).toBe('node-1.md')
        expect(payload.terminalId).toBe('node-1-terminal-0')
        expect(payload.contextNodeId).toBe('ctx-nodes/node-1_context.md')
        expect(payload.message).toContain('Spawned agent')
    })

    it('returns an error when node is not found', async () => {
        mockCallerTerminal()
        vi.mocked(getWritePath).mockResolvedValue(O.some('/vault'))
        vi.mocked(getGraph).mockReturnValue({
            nodes: {}, incomingEdgesIndex: new Map(), nodeByBaseName: new Map(), unresolvedLinksIndex: new Map()
        })

        const response: McpToolResponse = await spawnAgentTool({nodeId: 'missing-node.md', callerTerminalId: 'caller-terminal-99'})
        const payload: {success: boolean; error: string} = parsePayload(response) as {success: boolean; error: string}

        expect(response.isError).toBe(true)
        expect(payload.success).toBe(false)
        expect(payload.error).toContain('not found')
    })

    it('resolves short nodeId to full path via nodeByBaseName index', async () => {
        mockCallerTerminal()
        vi.mocked(getWritePath).mockResolvedValue(O.some('/vault'))
        const fullPath: NodeIdAndFilePath = '/Users/test/vault/voicetree/fix-test.md'
        vi.mocked(getGraph).mockReturnValue({
            nodes: {[fullPath]: buildGraphNode(fullPath, '# Fix Test')},
            incomingEdgesIndex: new Map(),
            nodeByBaseName: new Map([['fix-test', [fullPath]]]),
            unresolvedLinksIndex: new Map()
        })
        vi.mocked(spawnTerminalWithContextNode).mockResolvedValue({
            terminalId: 'fix-test-terminal-0',
            contextNodeId: 'ctx-nodes/fix-test_context.md'
        })

        const response: McpToolResponse = await spawnAgentTool({nodeId: 'fix-test.md', callerTerminalId: 'caller-terminal-99'})
        const payload: {success: boolean; nodeId: string} = parsePayload(response) as {success: boolean; nodeId: string}

        expect(payload.success).toBe(true)
        expect(payload.nodeId).toBe(fullPath)
        expect(spawnTerminalWithContextNode).toHaveBeenCalledWith(fullPath, undefined, undefined, true, false, undefined, undefined, 'caller-terminal-99', undefined, undefined, undefined, {})
    })

    it('returns an error when vault path is not set', async () => {
        mockCallerTerminal()
        vi.mocked(getWritePath).mockResolvedValue(O.none)

        const response: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'caller-terminal-99'})
        const payload: {success: boolean; error: string} = parsePayload(response) as {success: boolean; error: string}

        expect(response.isError).toBe(true)
        expect(payload.success).toBe(false)
        expect(payload.error).toContain('No vault loaded')
        expect(spawnTerminalWithContextNode).not.toHaveBeenCalled()
    })

    it('returns after spawn is initiated', async () => {
        mockCallerTerminal()
        setupGraph()

        const response: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'caller-terminal-99'})
        const payload: {success: boolean; terminalId: string} = parsePayload(response) as {success: boolean; terminalId: string}

        expect(payload.success).toBe(true)
        expect(payload.terminalId).toBe('node-1-terminal-0')
        expect(spawnTerminalWithContextNode).toHaveBeenCalledTimes(1)
    })

    it('inherits the caller agent type by default when agentName is omitted', async () => {
        mockCallerWithType('Codex')
        vi.mocked(loadSettings).mockResolvedValue({agents: TEST_AGENTS} as VTSettings)
        setupGraph()

        await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'caller-terminal-99'})

        expect(spawnTerminalWithContextNode).toHaveBeenCalledWith(
            'node-1.md', 'codex --prompt "$AGENT_PROMPT"', undefined, true, false, undefined, undefined, 'caller-terminal-99', undefined, undefined, undefined, {}
        )
    })

    it('falls back to settings default when caller has no agentTypeName', async () => {
        mockCallerTerminal()
        vi.mocked(loadSettings).mockResolvedValue({agents: TEST_AGENTS} as VTSettings)
        setupGraph()

        await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'caller-terminal-99'})

        expect(spawnTerminalWithContextNode).toHaveBeenCalledWith(
            'node-1.md', undefined, undefined, true, false, undefined, undefined, 'caller-terminal-99', undefined, undefined, undefined, {}
        )
    })

    it('prefers explicit agentName over inherited caller agent', async () => {
        mockCallerWithType('Codex')
        vi.mocked(loadSettings).mockResolvedValue({agents: TEST_AGENTS} as VTSettings)
        setupGraph()

        await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'caller-terminal-99', agentName: 'Claude Sonnet'})

        expect(spawnTerminalWithContextNode).toHaveBeenCalledWith(
            'node-1.md', 'claude-sonnet --prompt "$AGENT_PROMPT"', undefined, true, false, undefined, undefined, 'caller-terminal-99', undefined, undefined, undefined, {}
        )
    })

    it('marks existing node as claimed on spawn', async () => {
        mockCallerTerminal()
        setupGraph()

        await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'caller-terminal-99'})

        const claimCall: unknown[] | undefined = vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mock.calls[0]
        expect(claimCall).toBeDefined()
        const claimDelta: Array<{type: string; nodeToUpsert: GraphNode}> = claimCall![0] as Array<{type: string; nodeToUpsert: GraphNode}>
        expect(claimDelta[0].type).toBe('UpsertNode')
        expect(claimDelta[0].nodeToUpsert.nodeUIMetadata.additionalYAMLProps.get('status')).toBe('claimed')
    })
})

describe('MCP spawn_agent depthBudget auto-decrement', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    function mockCallerWithBudget(budget: string): void {
        const callerTerminalData: TerminalData = createTerminalData({
            terminalId: 'caller-terminal-99' as TerminalId,
            attachedToNodeId: 'ctx-nodes/caller.md',
            terminalCount: 99,
            title: 'Caller',
            executeCommand: true,
            agentName: 'caller',
            initialEnvVars: {DEPTH_BUDGET: budget}
        })
        vi.mocked(getTerminalRecords).mockReturnValue([
            {terminalId: 'caller-terminal-99', terminalData: callerTerminalData, status: 'running', exitCode: null, auditRetryCount: 0, spawnedAt: 0}
        ])
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

    it('auto-decrements DEPTH_BUDGET from parent (2 → 1)', async () => {
        mockCallerWithBudget('2')
        setupGraphAndSpawn()
        await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'caller-terminal-99'})
        const envOverridesArg: Record<string, string> | undefined =
            vi.mocked(spawnTerminalWithContextNode).mock.calls[0]?.[11] as Record<string, string> | undefined
        expect(envOverridesArg).toEqual({DEPTH_BUDGET: '1'})
    })

    it('auto-decrements DEPTH_BUDGET floors at 0', async () => {
        mockCallerWithBudget('0')
        setupGraphAndSpawn()
        await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'caller-terminal-99'})
        const envOverridesArg: Record<string, string> | undefined =
            vi.mocked(spawnTerminalWithContextNode).mock.calls[0]?.[11] as Record<string, string> | undefined
        expect(envOverridesArg).toEqual({DEPTH_BUDGET: '0'})
    })

    it('explicit depthBudget overrides auto-decrement', async () => {
        mockCallerWithBudget('2')
        setupGraphAndSpawn()
        await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'caller-terminal-99', depthBudget: 5})
        const envOverridesArg: Record<string, string> | undefined =
            vi.mocked(spawnTerminalWithContextNode).mock.calls[0]?.[11] as Record<string, string> | undefined
        expect(envOverridesArg).toEqual({DEPTH_BUDGET: '5'})
    })

    it('returns depthBudget in response when set', async () => {
        mockCallerWithBudget('3')
        setupGraphAndSpawn()
        const response: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'caller-terminal-99'})
        const payload: {depthBudget?: number} = parsePayload(response) as {depthBudget?: number}
        expect(payload.depthBudget).toBe(2)
    })

    it('empty envOverrides when parent has no DEPTH_BUDGET or budget', async () => {
        mockCallerTerminal()
        setupGraphAndSpawn()
        await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'caller-terminal-99'})
        const envOverridesArg: Record<string, string> | undefined =
            vi.mocked(spawnTerminalWithContextNode).mock.calls[0]?.[11] as Record<string, string> | undefined
        expect(envOverridesArg).toEqual({})
    })
})
