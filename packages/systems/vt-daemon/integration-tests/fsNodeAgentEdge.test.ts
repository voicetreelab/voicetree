/**
 * FS node → agent-name → agentNodeIndex bridge integration.
 *
 * The webapp version of this test reproduced a 6-line production callback
 * from `graph-model-init.ts` (Electron-only) — that callback finds the
 * terminal with a matching `agent_name` and registers an FS-written
 * progress node against it. Move stays mechanical: drive the same
 * agent-runtime helpers directly. No vt-daemon MCP server involved
 * (the bridge lives in Electron Main), so this file lives in
 * vt-daemon/integration-tests because that is where the
 * agent-runtime-backed tests now collect.
 */

import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import type {Graph} from '@vt/graph-model/graph'
import {
    clearTerminalRecords,
    getIdleSince,
    getTerminalRecords,
    recordTerminalSpawn,
    resetAuditRetryCount,
    updateTerminalIsDone,
    type TerminalRecord,
} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry'
import {
    createTerminalData,
    type TerminalData,
    type TerminalId,
} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts'
import {
    clearAgentNodes,
    getAgentNodes,
    registerAgentNodes,
} from '../src/agent-runtime/agent-control/completion/agentNodeIndex.ts'
import {isAgentComplete} from '../src/agent-runtime/agent-control/completion/isAgentComplete.ts'

/**
 * Production callback reproduced from `graph-model-init.ts` (Electron-only).
 * Kept inline here because that file requires the Electron runtime.
 * This is the exact logic that bridges FS-written nodes into the agent
 * node index.
 */
function onFSNodeWithAgentName(agentName: string, nodeId: string, title: string): void {
    const record: TerminalRecord | undefined = getTerminalRecords().find(
        (r: TerminalRecord) => r.terminalData.agentName === agentName,
    )
    if (!record) return
    registerAgentNodes(record.terminalId, [{nodeId, title}])
    resetAuditRetryCount(record.terminalId)
}

const TERMINAL_ID: string = 'test-fs-terminal'
const AGENT_NAME: string = 'TestFS'
const NODE_ID: string = '/vault/voicetree-1/progress-node.md'
const NODE_TITLE: string = 'Progress Node'

const emptyGraph: Graph = {
    nodes: {},
    incomingEdgesIndex: new Map(),
    nodeByBaseName: new Map(),
    unresolvedLinksIndex: new Map(),
}

function registerTestTerminal(agentName: string = AGENT_NAME, terminalId: string = TERMINAL_ID): void {
    const data: TerminalData = createTerminalData({
        terminalId: terminalId as TerminalId,
        attachedToNodeId: 'ctx-nodes/test.md',
        terminalCount: 0,
        title: 'Test Terminal',
        agentName,
    })
    recordTerminalSpawn(terminalId, data)
}

describe('FS node agent_name → agentNodeIndex → blue edge', () => {
    beforeEach(() => {
        clearTerminalRecords()
        clearAgentNodes()
    })

    afterEach(() => {
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

    afterEach(() => {
        clearTerminalRecords()
        clearAgentNodes()
    })

    it('idle agent with FS-registered node is considered complete', () => {
        registerTestTerminal()
        onFSNodeWithAgentName(AGENT_NAME, NODE_ID, NODE_TITLE)

        updateTerminalIsDone(TERMINAL_ID, true)

        const record: TerminalRecord = getTerminalRecords().find(r => r.terminalId === TERMINAL_ID)!
        const idleSince: number = getIdleSince(TERMINAL_ID)!
        const now: number = idleSince + 10_000

        expect(isAgentComplete(record, emptyGraph, now, [record])).toBe(true)
    })

    it('idle agent WITHOUT FS-registered node is blocked by progress-node gate', () => {
        registerTestTerminal()

        updateTerminalIsDone(TERMINAL_ID, true)

        const record: TerminalRecord = getTerminalRecords().find(r => r.terminalId === TERMINAL_ID)!
        const idleSince: number = getIdleSince(TERMINAL_ID)!
        const now: number = idleSince + 10_000

        expect(isAgentComplete(record, emptyGraph, now, [record])).toBe(false)
    })
})
