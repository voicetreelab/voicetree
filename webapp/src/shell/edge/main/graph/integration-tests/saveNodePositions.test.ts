import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeDefinition } from 'cytoscape'
import type { Graph, GraphDelta, GraphNode } from '@vt/graph-model/graph'
import { createGraph } from '@vt/graph-model/graph'
import * as O from 'fp-ts/lib/Option.js'

const mocks = vi.hoisted(() => ({
    getGraphFromDaemon: vi.fn(),
    getTerminalRecords: vi.fn(),
    postDeltaThroughDaemon: vi.fn(),
    writePositionsThroughDaemon: vi.fn(),
}))

const daemonState = vi.hoisted(() => ({
    postedDeltas: [] as GraphDelta[],
    writtenPositions: [] as Array<Record<string, { x: number; y: number }>>,
}))

vi.mock('@/shell/edge/main/runtime/electron/daemon/queries/daemon-graph-queries', () => ({
    writePositionsThroughDaemon: mocks.writePositionsThroughDaemon,
}))

vi.mock('@/shell/edge/main/runtime/electron/daemon/ipc/daemon-ipc-proxy', () => ({
    getGraphFromDaemon: mocks.getGraphFromDaemon,
    postDeltaThroughDaemon: mocks.postDeltaThroughDaemon,
}))

vi.mock('@vt/vt-daemon-client', () => ({
    getTerminalRecords: mocks.getTerminalRecords,
}))

vi.mock('@/shell/edge/main/runtime/electron/daemon/daemon-url-binding', () => ({
    getVtDaemonClient: vi.fn().mockReturnValue({} as unknown),
}))

import { cleanupOrphanedContextNodes, saveNodePositions } from '@/shell/edge/main/workspace/saveNodePositions'

describe('saveNodePositions', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        daemonState.writtenPositions = []
        mocks.writePositionsThroughDaemon.mockImplementation(async (positions) => {
            daemonState.writtenPositions.push(positions)
            return { written: Object.keys(positions).length }
        })
        mocks.postDeltaThroughDaemon.mockResolvedValue(undefined)
        mocks.getTerminalRecords.mockResolvedValue([])
    })

    it('writes Cytoscape node positions through the daemon', async () => {
        const cyNodes: readonly NodeDefinition[] = [
            { data: { id: 'node1.md' }, position: { x: 100.25, y: 200.75 } },
            { data: { id: 'node2.md' }, position: { x: -3, y: 4 } },
        ]

        await saveNodePositions(cyNodes)

        expect(daemonState.writtenPositions).toEqual([{
            'node1.md': { x: 100.25, y: 200.75 },
            'node2.md': { x: -3, y: 4 },
        }])
    })

    it('ignores Cytoscape entries without finite positions', async () => {
        const cyNodes: readonly NodeDefinition[] = [
            { data: { id: 'valid.md' }, position: { x: 1, y: 2 } },
            { data: { id: 'missing-position.md' } },
            { data: { id: 'bad-x.md' }, position: { x: Number.NaN, y: 2 } },
            { data: { id: 'bad-y.md' }, position: { x: 1, y: Number.POSITIVE_INFINITY } },
        ]

        await saveNodePositions(cyNodes)

        expect(daemonState.writtenPositions).toEqual([{
            'valid.md': { x: 1, y: 2 },
        }])
    })

    it('does not contact the daemon when there are no valid positions', async () => {
        const cyNodes: readonly NodeDefinition[] = [
            { data: { id: 'missing-position.md' } },
        ]

        await saveNodePositions(cyNodes)

        expect(daemonState.writtenPositions).toEqual([])
    })
})

describe('cleanupOrphanedContextNodes', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        daemonState.postedDeltas = []
        mocks.postDeltaThroughDaemon.mockImplementation(async (delta) => {
            daemonState.postedDeltas.push(delta)
        })
    })

    it('deletes daemon graph context nodes that are not attached to an active terminal', async () => {
        const orphanedNode: GraphNode = createNode(true)
        const activeNode: GraphNode = createNode(true)
        const regularNode: GraphNode = createNode(false)
        const graph: Graph = createGraph({
            'orphaned.md': orphanedNode,
            'active.md': activeNode,
            'regular.md': regularNode,
        })
        mocks.getGraphFromDaemon.mockResolvedValue(graph)
        mocks.getTerminalRecords.mockResolvedValue([
            { terminalData: { attachedToContextNodeId: 'active.md' } },
        ])

        await cleanupOrphanedContextNodes()

        const delta: GraphDelta | undefined = daemonState.postedDeltas[0]
        expect(delta).toHaveLength(1)
        expect(delta?.[0]).toMatchObject({
            type: 'DeleteNode',
            nodeId: 'orphaned.md',
        })
    })
})

function createNode(isContextNode: boolean): GraphNode {
    return {
        absoluteFilePathIsID: '',
        contentWithoutYamlOrLinks: '# Node',
        outgoingEdges: [],
        nodeUIMetadata: {
            additionalYAMLProps: {},
            color: O.none,
            isContextNode,
            position: O.none,
        },
    }
}
