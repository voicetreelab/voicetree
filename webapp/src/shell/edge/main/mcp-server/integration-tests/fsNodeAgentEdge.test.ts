import {describe, it, expect, beforeEach, vi} from 'vitest'
import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'
import type {Graph} from '@vt/graph-model/pure/graph'

vi.mock('@/shell/edge/main/terminals/send-text-to-terminal', () => ({
    sendTextToTerminal: vi.fn()
}))

vi.mock('@/shell/edge/main/state/graph-store', () => ({
    getGraph: vi.fn().mockReturnValue({
        nodes: {},
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map()
    } satisfies Graph)
}))

vi.mock('@/shell/edge/main/settings/settings_IO', () => ({
    loadSettings: vi.fn().mockResolvedValue({})
}))

vi.mock('@vt/graph-db-server/context-nodes/getUnseenNodesAroundContextNode', () => ({
    getUnseenNodesAroundContextNode: vi.fn().mockResolvedValue([])
}))

vi.mock('@/shell/edge/main/terminals/stopGateHookRunner', () => ({
    runStopHooks: vi.fn().mockResolvedValue({passed: true})
}))

vi.mock('@/shell/edge/main/terminals/global-budget-registry', () => ({
    clearBudget: vi.fn()
}))

import {
    recordTerminalSpawn,
    getTerminalRecords,
    clearTerminalRecords,
    updateTerminalIsDone,
    getIdleSince,
    resetAuditRetryCount,
    type TerminalRecord
} from '@/shell/edge/main/terminals/terminal-registry'
import {
    registerAgentNodes,
    getAgentNodes,
    clearAgentNodes
} from '@/shell/edge/main/mcp-server/agentNodeIndex'
import {isAgentComplete} from '@/shell/edge/main/mcp-server/isAgentComplete'

/**
 * Production callback from graph-model-init.ts (Electron-only).
 * Reproduced here because graph-model-init.ts requires Electron runtime.
 * This is the exact logic that bridges FS-written nodes to agentNodeIndex.
 */
function onFSNodeWithAgentName(agentName: string, nodeId: string, title: string): void {
    const record: TerminalRecord | undefined = getTerminalRecords().find(
        (r: TerminalRecord) => r.terminalData.agentName === agentName
    )
    if (!record) return
    registerAgentNodes(record.terminalId, [{nodeId, title}])
    resetAuditRetryCount(record.terminalId)
}

const TERMINAL_ID = 'test-fs-terminal'
const AGENT_NAME = 'TestFS'
const NODE_ID = '/vault/voicetree-1/progress-node.md'
const NODE_TITLE = 'Progress Node'

const emptyGraph: Graph = {
    nodes: {},
    incomingEdgesIndex: new Map(),
    nodeByBaseName: new Map(),
    unresolvedLinksIndex: new Map()
}

function registerTestTerminal(agentName: string = AGENT_NAME, terminalId: string = TERMINAL_ID): void {
    const terminalData = createTerminalData({
        terminalId: terminalId as TerminalId,
        attachedToNodeId: 'ctx-nodes/test.md',
        terminalCount: 0,
        title: 'Test Terminal',
        agentName
    })
    recordTerminalSpawn(terminalId, terminalData)
}

describe('FS node agent_name → agentNodeIndex → blue edge', () => {
    beforeEach(() => {
        clearTerminalRecords()
        clearAgentNodes()
    })

    it('registers FS-written node in agentNodeIndex when agent_name matches a terminal', () => {
        registerTestTerminal()

        onFSNodeWithAgentName(AGENT_NAME, NODE_ID, NODE_TITLE)

        const nodes = getAgentNodes(TERMINAL_ID)
        expect(nodes).toHaveLength(1)
        expect(nodes[0]).toEqual({nodeId: NODE_ID, title: NODE_TITLE})
    })

    it('does not register when no terminal matches the agent_name', () => {
        registerTestTerminal()

        onFSNodeWithAgentName('NonExistentAgent', NODE_ID, NODE_TITLE)

        expect(getAgentNodes(TERMINAL_ID)).toHaveLength(0)
    })

    it('accumulates multiple FS-written nodes for the same terminal', () => {
        registerTestTerminal()

        onFSNodeWithAgentName(AGENT_NAME, '/vault/node1.md', 'Node 1')
        onFSNodeWithAgentName(AGENT_NAME, '/vault/node2.md', 'Node 2')

        const nodes = getAgentNodes(TERMINAL_ID)
        expect(nodes).toHaveLength(2)
        expect(nodes[0].nodeId).toBe('/vault/node1.md')
        expect(nodes[1].nodeId).toBe('/vault/node2.md')
    })

    it('routes FS nodes to correct terminal when multiple terminals exist', () => {
        registerTestTerminal('AgentA', 'terminal-a')
        registerTestTerminal('AgentB', 'terminal-b')

        onFSNodeWithAgentName('AgentB', NODE_ID, NODE_TITLE)

        expect(getAgentNodes('terminal-a')).toHaveLength(0)
        expect(getAgentNodes('terminal-b')).toHaveLength(1)
        expect(getAgentNodes('terminal-b')[0].nodeId).toBe(NODE_ID)
    })
})

describe('FS-registered node satisfies isAgentComplete progress-node gate', () => {
    beforeEach(() => {
        clearTerminalRecords()
        clearAgentNodes()
    })

    it('idle agent with FS-registered node is considered complete', () => {
        registerTestTerminal()
        onFSNodeWithAgentName(AGENT_NAME, NODE_ID, NODE_TITLE)

        updateTerminalIsDone(TERMINAL_ID, true)

        const record: TerminalRecord = getTerminalRecords().find(
            r => r.terminalId === TERMINAL_ID
        )!
        const idleSince: number = getIdleSince(TERMINAL_ID)!
        const now: number = idleSince + 10_000

        expect(isAgentComplete(record, emptyGraph, now, [record])).toBe(true)
    })

    it('idle agent WITHOUT FS-registered node is blocked by progress-node gate', () => {
        registerTestTerminal()

        updateTerminalIsDone(TERMINAL_ID, true)

        const record: TerminalRecord = getTerminalRecords().find(
            r => r.terminalId === TERMINAL_ID
        )!
        const idleSince: number = getIdleSince(TERMINAL_ID)!
        const now: number = idleSince + 10_000

        expect(isAgentComplete(record, emptyGraph, now, [record])).toBe(false)
    })
})
