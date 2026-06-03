/**
 * Pure-function integration test for `isAgentComplete` cycle detection and
 * progress-node gate. The function is exported from "@vt/vt-daemon";
 * tests inject deterministic deps so this needs neither a vt-daemon nor a
 * live registry. Moved out of webapp's RPC integration folder because it
 * doesn't actually exercise the RPC server — it's a leaf test of an
 * agent-runtime function that webapp Main only imports for types.
 */

import {beforeEach, describe, expect, it} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphNode} from '@vt/graph-model/graph'

import {
    createTerminalData,
    type TerminalData,
    type TerminalId,
} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts'
import type {TerminalRecord} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry'
import {
    isAgentComplete,
    type IsAgentCompleteDeps,
} from '../src/agent-runtime/agent-control/completion/isAgentComplete.ts'

function buildGraphNode(nodeId: string, title: string, agentName: string, isContextNode: boolean = false): GraphNode {
    return {
        outgoingEdges: [],
        absoluteFilePathIsID: nodeId,
        contentWithoutYamlOrLinks: `# ${title}\n\nContent.`,
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: {agent_name: agentName},
            isContextNode,
        },
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
        unresolvedLinksIndex: new Map(),
    }
}

function makeTerminalData(id: string, agentName: string, parentTerminalId?: string | null): TerminalData {
    return createTerminalData({
        terminalId: id as TerminalId,
        attachedToNodeId: `ctx-nodes/${agentName}.md`,
        terminalCount: 0,
        title: agentName,
        agentName,
        parentTerminalId: (parentTerminalId ?? undefined) as TerminalId | undefined,
    })
}

function makeIdleTerminalData(id: string, agentName: string, parentTerminalId?: string | null): TerminalData {
    return {...makeTerminalData(id, agentName, parentTerminalId), isDone: true}
}

function makeRecord(id: string, data: TerminalData, status: 'running' | 'exited' = 'running'): TerminalRecord {
    return {
        terminalId: id,
        terminalData: data,
        status,
        exitCode: status === 'exited' ? 0 : null,
        auditRetryCount: 0,
        spawnedAt: 0,
    }
}

type DepsBuilder = (overrides?: Partial<IsAgentCompleteDeps>) => IsAgentCompleteDeps

describe('isAgentComplete cycle detection', () => {
    const NOW: number = 100_000
    const IDLE_SINCE: number = NOW - 10_000 // 10s idle, well above 7s threshold

    let buildDeps: DepsBuilder
    let deps: IsAgentCompleteDeps

    beforeEach(() => {
        // Default leaf deps: all agents idle long enough, all agents have one progress node.
        buildDeps = (overrides: Partial<IsAgentCompleteDeps> = {}): IsAgentCompleteDeps => ({
            getIdleSince: (_id: string) => IDLE_SINCE,
            getAgentNodes: (_id: string) => [{nodeId: 'progress.md', title: 'Progress'}],
            getNewNodesForAgent: (_graph: Graph, _agentName: string | undefined, _spawnedAt: number) => [],
            ...overrides,
        })
        deps = buildDeps()
    })

    it('handles self-referential cycle (terminalId === parentTerminalId) without stack overflow', () => {
        const selfCycleData: TerminalData = makeIdleTerminalData('agent-x', 'alpha', 'agent-x')
        const selfCycleRecord: TerminalRecord = makeRecord('agent-x', selfCycleData)
        const allRecords: TerminalRecord[] = [selfCycleRecord]

        const progressNode: GraphNode = buildGraphNode('alpha-node.md', 'Alpha progress', 'alpha')
        const graph: Graph = buildGraph([progressNode])

        const result: boolean = isAgentComplete(selfCycleRecord, graph, NOW, allRecords, undefined, deps)
        expect(result).toBe(true)
    })

    it('handles indirect cycle (A→B→A) without stack overflow', () => {
        const dataA: TerminalData = makeIdleTerminalData('agent-a', 'alpha', 'agent-b')
        const dataB: TerminalData = makeIdleTerminalData('agent-b', 'beta', 'agent-a')
        const recordA: TerminalRecord = makeRecord('agent-a', dataA)
        const recordB: TerminalRecord = makeRecord('agent-b', dataB)
        const allRecords: TerminalRecord[] = [recordA, recordB]

        const graph: Graph = buildGraph([
            buildGraphNode('alpha-node.md', 'Alpha progress', 'alpha'),
            buildGraphNode('beta-node.md', 'Beta progress', 'beta'),
        ])

        const result: boolean = isAgentComplete(recordA, graph, NOW, allRecords, undefined, deps)
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
            buildGraphNode('gamma-node.md', 'Gamma progress', 'gamma'),
        ])

        const result: boolean = isAgentComplete(recordA, graph, NOW, allRecords, undefined, deps)
        expect(result).toBe(true)
    })

    it('correctly evaluates a deep non-cyclic chain (A→B→C→D)', () => {
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
            buildGraphNode('delta-node.md', 'Delta progress', 'delta'),
        ])

        const result: boolean = isAgentComplete(recordA, graph, NOW, allRecords, undefined, deps)
        expect(result).toBe(true)
    })

    it('returns false when a deep chain has an incomplete leaf', () => {
        const dataA: TerminalData = makeIdleTerminalData('agent-a', 'alpha')
        const dataB: TerminalData = makeIdleTerminalData('agent-b', 'beta', 'agent-a')
        const dataC: TerminalData = makeTerminalData('agent-c', 'gamma', 'agent-b') // NOT idle
        const recordA: TerminalRecord = makeRecord('agent-a', dataA)
        const recordB: TerminalRecord = makeRecord('agent-b', dataB)
        const recordC: TerminalRecord = makeRecord('agent-c', dataC) // still running
        const allRecords: TerminalRecord[] = [recordA, recordB, recordC]

        const graph: Graph = buildGraph([
            buildGraphNode('alpha-node.md', 'Alpha progress', 'alpha'),
            buildGraphNode('beta-node.md', 'Beta progress', 'beta'),
        ])

        const result: boolean = isAgentComplete(recordA, graph, NOW, allRecords, undefined, deps)
        expect(result).toBe(false)
    })

    it('treats cycle node as complete so running siblings can still block completion', () => {
        const dataA: TerminalData = makeIdleTerminalData('agent-a', 'alpha')
        const dataB: TerminalData = makeIdleTerminalData('agent-b', 'beta', 'agent-a')
        const dataC: TerminalData = makeTerminalData('agent-c', 'gamma', 'agent-a') // running child of A
        const recordA: TerminalRecord = makeRecord('agent-a', dataA)
        const recordB: TerminalRecord = makeRecord('agent-b', dataB, 'exited')
        const recordC: TerminalRecord = makeRecord('agent-c', dataC) // still running
        const allRecords: TerminalRecord[] = [recordA, recordB, recordC]

        const graph: Graph = buildGraph([
            buildGraphNode('alpha-node.md', 'Alpha progress', 'alpha'),
        ])

        const result: boolean = isAgentComplete(recordA, graph, NOW, allRecords, undefined, deps)
        expect(result).toBe(false)
    })
})

describe('isAgentComplete progress-node gate', () => {
    const NOW: number = 100_000
    const IDLE_SINCE: number = NOW - 10_000

    function depsWith(overrides: Partial<IsAgentCompleteDeps>): IsAgentCompleteDeps {
        return {
            getIdleSince: (_id: string) => IDLE_SINCE,
            getAgentNodes: (_id: string) => [],
            getNewNodesForAgent: (_g: Graph, _n: string | undefined, _s: number) => [],
            ...overrides,
        }
    }

    it('blocks completion when agent has no progress nodes and is within 30-min timeout', () => {
        const data: TerminalData = makeIdleTerminalData('agent-x', 'alpha')
        const record: TerminalRecord = makeRecord('agent-x', data)
        record.spawnedAt = NOW - 60_000 // 1 minute ago
        const graph: Graph = buildGraph()

        const result: boolean = isAgentComplete(record, graph, NOW, [record], undefined, depsWith({}))
        expect(result).toBe(false)
    })

    it('allows completion when agent has no progress nodes but exceeds 30-min timeout', () => {
        const data: TerminalData = makeIdleTerminalData('agent-x', 'alpha')
        const record: TerminalRecord = makeRecord('agent-x', data)
        record.spawnedAt = NOW - (31 * 60 * 1000) // 31 minutes ago
        const graph: Graph = buildGraph()

        const result: boolean = isAgentComplete(record, graph, NOW, [record], undefined, depsWith({}))
        expect(result).toBe(true)
    })

    it('allows completion when agent has progress nodes regardless of spawn time', () => {
        const data: TerminalData = makeIdleTerminalData('agent-x', 'alpha')
        const record: TerminalRecord = makeRecord('agent-x', data)
        record.spawnedAt = NOW - 10_000
        const graph: Graph = buildGraph([
            buildGraphNode('node.md', 'My Progress', 'alpha'),
        ])

        const deps: IsAgentCompleteDeps = depsWith({
            getAgentNodes: (_id: string) => [{nodeId: 'node.md', title: 'My Progress'}],
        })
        const result: boolean = isAgentComplete(record, graph, NOW, [record], undefined, deps)
        expect(result).toBe(true)
    })

    it('does not apply progress-node gate to exited agents', () => {
        const data: TerminalData = makeTerminalData('agent-x', 'alpha')
        const record: TerminalRecord = makeRecord('agent-x', data, 'exited')
        record.spawnedAt = NOW - 10_000
        const graph: Graph = buildGraph()

        const result: boolean = isAgentComplete(record, graph, NOW, [record], undefined, depsWith({}))
        expect(result).toBe(true)
    })
})
