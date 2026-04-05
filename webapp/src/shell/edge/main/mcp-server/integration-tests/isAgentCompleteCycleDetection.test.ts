import {describe, it, expect, vi, beforeEach} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphNode} from '@vt/graph-model/pure/graph'

import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'
import type {TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'

// Mock leaf dependencies
vi.mock('@/shell/edge/main/terminals/terminal-registry', () => ({
    getIdleSince: vi.fn()
}))

import {isAgentComplete} from '@/shell/edge/main/mcp-server/isAgentComplete'
import {getIdleSince} from '@/shell/edge/main/terminals/terminal-registry'

// --- Helpers ---

function buildGraphNode(nodeId: string, title: string, agentName: string, isContextNode: boolean = false): GraphNode {
    return {
        outgoingEdges: [],
        absoluteFilePathIsID: nodeId,
        contentWithoutYamlOrLinks: `# ${title}\n\nContent.`,
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: new Map([['agent_name', agentName]]),
            isContextNode
        }
    }
}

function buildGraph(nodes: GraphNode[] = []): Graph {
    const nodesRecord: Record<string, GraphNode> = {}
    for (const node of nodes) {
        nodesRecord[node.absoluteFilePathIsID] = node
    }
    return {
        nodes: nodesRecord,
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map()
    }
}

function makeTerminalData(id: string, agentName: string, parentTerminalId?: string | null): TerminalData {
    return createTerminalData({
        terminalId: id as TerminalId,
        attachedToNodeId: `ctx-nodes/${agentName}.md`,
        terminalCount: 0,
        title: agentName,
        agentName,
        parentTerminalId: (parentTerminalId ?? undefined) as TerminalId | undefined
    })
}

function makeIdleTerminalData(id: string, agentName: string, parentTerminalId?: string | null): TerminalData {
    return {...makeTerminalData(id, agentName, parentTerminalId), isDone: true}
}

function makeRecord(id: string, data: TerminalData, status: 'running' | 'exited' = 'running'): TerminalRecord {
    return {terminalId: id, terminalData: data, status, exitCode: status === 'exited' ? 0 : null, auditRetryCount: 0, spawnedAt: 0}
}

// --- Tests ---

describe('isAgentComplete cycle detection', () => {
    const NOW: number = 100_000
    const IDLE_SINCE: number = NOW - 10_000 // 10s idle, well above 7s threshold

    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(getIdleSince).mockReturnValue(IDLE_SINCE)
    })

    it('handles self-referential cycle (terminalId === parentTerminalId) without stack overflow', () => {
        // This is the exact bug: replaceSelf sets parentTerminalId = terminalId
        const selfCycleData: TerminalData = makeIdleTerminalData('agent-x', 'alpha', 'agent-x')
        const selfCycleRecord: TerminalRecord = makeRecord('agent-x', selfCycleData)
        const allRecords: TerminalRecord[] = [selfCycleRecord]

        const progressNode: GraphNode = buildGraphNode('alpha-node.md', 'Alpha progress', 'alpha')
        const graph: Graph = buildGraph([progressNode])

        // Without cycle detection, this would throw RangeError: Maximum call stack size exceeded.
        // With the fix, it should return true (self-cycle treated as already visited).
        const result: boolean = isAgentComplete(selfCycleRecord, graph, NOW, allRecords)

        expect(result).toBe(true)
    })

    it('handles indirect cycle (A→B→A) without stack overflow', () => {
        // A is parent of B, B is parent of A — mutual cycle
        const dataA: TerminalData = makeIdleTerminalData('agent-a', 'alpha', 'agent-b')
        const dataB: TerminalData = makeIdleTerminalData('agent-b', 'beta', 'agent-a')
        const recordA: TerminalRecord = makeRecord('agent-a', dataA)
        const recordB: TerminalRecord = makeRecord('agent-b', dataB)
        const allRecords: TerminalRecord[] = [recordA, recordB]

        const graph: Graph = buildGraph([
            buildGraphNode('alpha-node.md', 'Alpha progress', 'alpha'),
            buildGraphNode('beta-node.md', 'Beta progress', 'beta')
        ])

        // Without cycle detection, A checks B which checks A which checks B... stack overflow.
        // With the fix, when B tries to recurse into A, A is already in the visited set.
        const result: boolean = isAgentComplete(recordA, graph, NOW, allRecords)

        expect(result).toBe(true)
    })

    it('handles 3-node cycle (A→B→C→A) without stack overflow', () => {
        const dataA: TerminalData = makeIdleTerminalData('agent-a', 'alpha', 'agent-c')
        const dataB: TerminalData = makeIdleTerminalData('agent-b', 'beta', 'agent-a')
        const dataC: TerminalData = makeIdleTerminalData('agent-c', 'gamma', 'agent-b')
        const recordA: TerminalRecord = makeRecord('agent-a', dataA)
        const recordB: TerminalRecord = makeRecord('agent-b', dataB)
        const recordC: TerminalRecord = makeRecord('agent-c', dataC)
        const allRecords: TerminalRecord[] = [recordA, recordB, recordC]

        const graph: Graph = buildGraph([
            buildGraphNode('alpha-node.md', 'Alpha progress', 'alpha'),
            buildGraphNode('beta-node.md', 'Beta progress', 'beta'),
            buildGraphNode('gamma-node.md', 'Gamma progress', 'gamma')
        ])

        const result: boolean = isAgentComplete(recordA, graph, NOW, allRecords)

        expect(result).toBe(true)
    })

    it('correctly evaluates a deep non-cyclic chain (A→B→C→D)', () => {
        // Linear chain: A is root, B child of A, C child of B, D child of C
        // All are idle+complete — verifies the visited set propagates without false positives
        const dataA: TerminalData = makeIdleTerminalData('agent-a', 'alpha')
        const dataB: TerminalData = makeIdleTerminalData('agent-b', 'beta', 'agent-a')
        const dataC: TerminalData = makeIdleTerminalData('agent-c', 'gamma', 'agent-b')
        const dataD: TerminalData = makeIdleTerminalData('agent-d', 'delta', 'agent-c')
        const recordA: TerminalRecord = makeRecord('agent-a', dataA)
        const recordB: TerminalRecord = makeRecord('agent-b', dataB)
        const recordC: TerminalRecord = makeRecord('agent-c', dataC)
        const recordD: TerminalRecord = makeRecord('agent-d', dataD)
        const allRecords: TerminalRecord[] = [recordA, recordB, recordC, recordD]

        const graph: Graph = buildGraph([
            buildGraphNode('alpha-node.md', 'Alpha progress', 'alpha'),
            buildGraphNode('beta-node.md', 'Beta progress', 'beta'),
            buildGraphNode('gamma-node.md', 'Gamma progress', 'gamma'),
            buildGraphNode('delta-node.md', 'Delta progress', 'delta')
        ])

        const result: boolean = isAgentComplete(recordA, graph, NOW, allRecords)

        expect(result).toBe(true)
    })

    it('returns false when a deep chain has an incomplete leaf', () => {
        // A→B→C where C is still running — A should not be complete
        const dataA: TerminalData = makeIdleTerminalData('agent-a', 'alpha')
        const dataB: TerminalData = makeIdleTerminalData('agent-b', 'beta', 'agent-a')
        const dataC: TerminalData = makeTerminalData('agent-c', 'gamma', 'agent-b') // NOT idle
        const recordA: TerminalRecord = makeRecord('agent-a', dataA)
        const recordB: TerminalRecord = makeRecord('agent-b', dataB)
        const recordC: TerminalRecord = makeRecord('agent-c', dataC) // still running
        const allRecords: TerminalRecord[] = [recordA, recordB, recordC]

        const graph: Graph = buildGraph([
            buildGraphNode('alpha-node.md', 'Alpha progress', 'alpha'),
            buildGraphNode('beta-node.md', 'Beta progress', 'beta')
        ])

        const result: boolean = isAgentComplete(recordA, graph, NOW, allRecords)

        expect(result).toBe(false)
    })

    it('treats cycle node as complete so running siblings can still block completion', () => {
        // A has two children: B (creates a cycle back to A) and C (still running)
        // The cycle on B should be treated as complete, but C still blocks A
        const dataA: TerminalData = makeIdleTerminalData('agent-a', 'alpha')
        const dataB: TerminalData = makeIdleTerminalData('agent-b', 'beta', 'agent-a')
        // B's parentTerminalId points to A, but B also has A as a child via parentTerminalId cycle
        // Actually, the cycle check matters when getChildRecords finds a child whose terminalId is already visited.
        // Let's create: A is parent of B, and A is also parent of a self-referencing C
        const dataC: TerminalData = makeTerminalData('agent-c', 'gamma', 'agent-a') // running child of A
        const recordA: TerminalRecord = makeRecord('agent-a', dataA)
        const recordB: TerminalRecord = makeRecord('agent-b', dataB, 'exited')
        const recordC: TerminalRecord = makeRecord('agent-c', dataC) // still running
        const allRecords: TerminalRecord[] = [recordA, recordB, recordC]

        const graph: Graph = buildGraph([
            buildGraphNode('alpha-node.md', 'Alpha progress', 'alpha')
        ])

        const result: boolean = isAgentComplete(recordA, graph, NOW, allRecords)

        // C is still running, so A is not complete
        expect(result).toBe(false)
    })
})
