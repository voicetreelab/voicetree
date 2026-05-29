/**
 * Real-deps integration test for the list_agents MCP tool.
 *
 * Drives the daemon-side `listAgentsTool` against the real agent-runtime
 * terminal-registry. The webapp-side relocated version mocked
 * @vt/agent-runtime to inject records; this version registers fixture
 * records via `recordTerminalSpawn` and updates lifecycle flags via the
 * real lifecycle helpers so the data path read by `listAgentsTool` is
 * identical to production.
 */

import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import {promises as fs} from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import type {Graph, GraphNode, NodeIdAndFilePath} from '@vt/graph-model/graph'
import {clearSettingsCache} from '@vt/app-config/settings'
import {DEFAULT_SETTINGS} from '@vt/graph-model/settings'

import {
    clearPendingTerminal,
    clearTerminalRecords,
    markTerminalExited,
    recordTerminalPending,
    recordTerminalSpawn,
    updateTerminalIsDone,
} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry'
import {createTerminalData} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts'
import type {TerminalData, TerminalId} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts'
import type {GraphBridge} from '@vt/vt-daemon/config/mcpBridges.ts'
import {listAgentsTool} from '@vt/vt-daemon/agent-runtime/agent-control/listAgentsTool.ts'

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
            additionalYAMLProps: agentName ? {agent_name: agentName} : {},
            isContextNode: false,
        },
    }
}

const emptyGraph: Graph = {
    nodes: {},
    incomingEdgesIndex: new Map(),
    nodeByBaseName: new Map(),
    unresolvedLinksIndex: new Map(),
}

let voicetreeHome: string
let currentGraph: Graph
let bridge: GraphBridge

beforeEach(async () => {
    voicetreeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'vtd-list-agents-'))
    process.env.VOICETREE_HOME_PATH = voicetreeHome
    clearSettingsCache()
    await fs.writeFile(
        path.join(voicetreeHome, 'settings.json'),
        JSON.stringify(DEFAULT_SETTINGS, null, 2),
        'utf-8',
    )
    clearTerminalRecords()
    currentGraph = emptyGraph
    bridge = {
        getGraph: async () => currentGraph,
        getProjectPaths: async () => [],
        getWriteFolderPath: async () => null,
        applyGraphDelta: async () => undefined,
        getUnseenNodesAroundContextNode: async () => [],
    }
})

afterEach(async () => {
    clearTerminalRecords()
    await fs.rm(voicetreeHome, {recursive: true, force: true})
})

describe('MCP list_agents tool', () => {
    it('lists all agents with status and new nodes (matching by agent_name)', async () => {
        const terminalDataA: TerminalData = createTerminalData({
            terminalId: 'agent-a-terminal-0' as TerminalId,
            attachedToNodeId: 'ctx-nodes/agent-a.md',
            terminalCount: 0,
            title: 'Agent A',
            executeCommand: true,
            agentName: 'Sam',
        })
        const terminalDataB: TerminalData = createTerminalData({
            terminalId: 'agent-b-terminal-1' as TerminalId,
            attachedToNodeId: 'ctx-nodes/agent-b.md',
            terminalCount: 1,
            title: 'Agent B',
            executeCommand: true,
            agentName: 'Max',
        })
        const terminalDataPlain: TerminalData = createTerminalData({
            terminalId: 'plain-terminal-0' as TerminalId,
            attachedToNodeId: 'plain-node.md',
            terminalCount: 0,
            title: 'Plain Terminal',
            executeCommand: false,
            agentName: 'plain',
        })

        recordTerminalSpawn('agent-a-terminal-0', terminalDataA)
        recordTerminalSpawn('agent-b-terminal-1', terminalDataB)
        markTerminalExited('agent-b-terminal-1', 0)
        recordTerminalSpawn('plain-terminal-0', terminalDataPlain)

        currentGraph = {
            nodes: {
                'new-node-a.md': buildGraphNode('new-node-a.md' as NodeIdAndFilePath, '# Node A', 'Sam'),
                'new-node-b.md': buildGraphNode('new-node-b.md' as NodeIdAndFilePath, '# Node B', 'Max'),
            },
            incomingEdgesIndex: new Map(),
            nodeByBaseName: new Map(),
            unresolvedLinksIndex: new Map(),
        }

        const response: McpToolResponse = await listAgentsTool(bridge)
        const payload: {
            agents: Array<{
                terminalId: string
                status: string
                newNodes: Array<{nodeId: string; title: string}>
            }>
        } = parsePayload(response) as {
            agents: Array<{
                terminalId: string
                status: string
                newNodes: Array<{nodeId: string; title: string}>
            }>
        }

        // Plain terminal (executeCommand:false) is filtered out by the tool.
        expect(payload.agents).toHaveLength(2)
        const agentA = payload.agents.find(a => a.terminalId === 'agent-a-terminal-0')!
        const agentB = payload.agents.find(a => a.terminalId === 'agent-b-terminal-1')!
        expect(agentA.status).toBe('running')
        expect(agentA.newNodes.some(n => n.nodeId === 'new-node-a.md' && n.title === 'Node A')).toBe(true)
        expect(agentB.status).toBe('exited')
        expect(agentB.newNodes.some(n => n.nodeId === 'new-node-b.md' && n.title === 'Node B')).toBe(true)
    })

    it('returns an empty list when no agents exist', async () => {
        const response: McpToolResponse = await listAgentsTool(bridge)
        const payload: {agents: unknown[]} = parsePayload(response) as {agents: unknown[]}
        expect(payload.agents).toEqual([])
    })

    it('includes pending headless terminals as running agents', async () => {
        recordTerminalPending('pending-headless-1', true)

        const response: McpToolResponse = await listAgentsTool(bridge)
        const payload: {agents: Array<{terminalId: string; status: string; isHeadless: boolean}>} =
            parsePayload(response) as {agents: Array<{terminalId: string; status: string; isHeadless: boolean}>}

        expect(payload.agents).toEqual([
            expect.objectContaining({
                terminalId: 'pending-headless-1',
                status: 'running',
                isHeadless: true,
            }),
        ])

        clearPendingTerminal('pending-headless-1')
    })

    it('returns idle status when an interactive agent is marked done (isDone=true, PTY running)', async () => {
        const terminalData: TerminalData = createTerminalData({
            terminalId: 'idle-agent-terminal-0' as TerminalId,
            attachedToNodeId: 'ctx-nodes/idle-agent.md',
            terminalCount: 0,
            title: 'Idle Agent',
            executeCommand: true,
            agentName: 'idle-agent',
        })

        recordTerminalSpawn('idle-agent-terminal-0', terminalData)
        updateTerminalIsDone('idle-agent-terminal-0', true)

        const response: McpToolResponse = await listAgentsTool(bridge)
        const payload: {agents: Array<{status: string}>} = parsePayload(response) as {agents: Array<{status: string}>}

        expect(payload.agents).toHaveLength(1)
        expect(payload.agents[0]?.status).toBe('idle')
    })
})
