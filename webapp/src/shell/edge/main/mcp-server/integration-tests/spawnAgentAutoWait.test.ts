import {describe, it, expect, vi, beforeEach} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type {GraphNode, NodeIdAndFilePath} from '@vt/graph-model/pure/graph'
import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";

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

vi.mock('@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onUIChangePath/onUIChange', () => ({
    applyGraphDeltaToDBThroughMemAndUIAndEditors: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/shell/edge/main/mcp-server/agent-completion-monitor', () => ({
    startMonitor: vi.fn().mockReturnValue('monitor-1')
}))

import {spawnAgentTool} from '@/shell/edge/main/mcp-server/mcp-server'
import {getWritePath} from '@/shell/edge/main/graph/watch_folder/watchFolder'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {spawnTerminalWithContextNode} from '@/shell/edge/main/terminals/spawnTerminalWithContextNode'
import {getTerminalRecords} from '@/shell/edge/main/terminals/terminal-registry'
import {startMonitor} from '@/shell/edge/main/mcp-server/agent-completion-monitor'

type McpToolResponse = {
    content: Array<{type: 'text'; text: string}>
    isError?: boolean
}

function parsePayload(response: McpToolResponse): unknown {
    return JSON.parse(response.content[0].text)
}

function buildGraphNode(nodeId: NodeIdAndFilePath, content: string): GraphNode {
    return {
        outgoingEdges: [],
        absoluteFilePathIsID: nodeId,
        contentWithoutYamlOrLinks: content,
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: new Map(),
            isContextNode: false
        }
    }
}

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

function setupGraphAndSpawn(): void {
    vi.mocked(getWritePath).mockResolvedValue(O.some('/vault'))
    vi.mocked(getGraph).mockReturnValue({
        nodes: {'node-1.md': buildGraphNode('node-1.md', '# Node One')},
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map()
    })
    vi.mocked(spawnTerminalWithContextNode).mockResolvedValue({
        terminalId: 'node-1-terminal-0',
        contextNodeId: 'ctx-nodes/node-1_context.md'
    })
}

describe('spawn_agent auto-wait monitoring', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('calls startMonitor after successful spawn', async () => {
        mockCallerTerminal()
        setupGraphAndSpawn()

        await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'caller-terminal-99'})

        expect(startMonitor).toHaveBeenCalledWith('caller-terminal-99', ['node-1-terminal-0'], 5000)
    })

    it('does not call startMonitor for replaceSelf spawn', async () => {
        mockCallerTerminal()
        setupGraphAndSpawn()

        await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'caller-terminal-99', replaceSelf: true})

        expect(startMonitor).not.toHaveBeenCalled()
    })

    it('response mentions auto-notification', async () => {
        mockCallerTerminal()
        setupGraphAndSpawn()

        const response: McpToolResponse = await spawnAgentTool({nodeId: 'node-1.md', callerTerminalId: 'caller-terminal-99'})
        const payload: {message: string} = parsePayload(response) as {message: string}

        expect(payload.message).toContain('You will be notified when the agent completes')
    })
})
