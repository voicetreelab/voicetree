import {beforeEach, describe, expect, it, vi} from 'vitest'
import {createEmptyGraph, type GraphDelta} from '@vt/graph-model/graph'
import type {GraphBridge, McpGraphSnapshot} from './mcp-config'
import {configureMcpServer} from './mcp-config'
import {
    applyMcpGraphDelta,
    getMcpGraphSnapshot,
    getMcpUnseenNodesAroundContextNode,
} from './mcp-graph-bridge'

function makeSnapshot(overrides: Partial<McpGraphSnapshot> = {}): McpGraphSnapshot {
    return {
        graph: createEmptyGraph(),
        projectRoot: '/vault',
        vaultPaths: ['/vault'],
        writeFolder: '/vault',
        ...overrides,
    }
}

function makeBridge(overrides: Partial<GraphBridge> = {}): GraphBridge {
    return {
        getSnapshot: vi.fn(async () => makeSnapshot()),
        getUnseenNodesAroundContextNode: vi.fn(async () => [{nodeId: 'n.md', content: 'body'}]),
        applyGraphDelta: vi.fn(async () => undefined),
        ...overrides,
    }
}

describe('mcp-graph-bridge', () => {
    beforeEach(() => {
        configureMcpServer({})
    })

    it('throws a clear error when graph access is used before bridge configuration', async () => {
        await expect(getMcpGraphSnapshot()).rejects.toThrow(
            'MCP graph bridge not configured. Call configureMcpServer({ graph: ... }) at boot before getMcpGraphSnapshot.',
        )
    })

    it('reads the configured graph snapshot as the single graph read surface', async () => {
        const snapshot: McpGraphSnapshot = makeSnapshot()
        const bridge: GraphBridge = makeBridge({
            getSnapshot: async () => snapshot,
        })
        configureMcpServer({graph: bridge})

        await expect(getMcpGraphSnapshot()).resolves.toBe(snapshot)
    })

    it('delegates graph writes and unseen-node lookups to the configured bridge', async () => {
        const appliedDeltas: Array<{delta: GraphDelta; recordForUndo: boolean | undefined}> = []
        const bridge: GraphBridge = makeBridge({
            applyGraphDelta: async (delta, recordForUndo) => {
                appliedDeltas.push({delta, recordForUndo})
            },
            getUnseenNodesAroundContextNode: async (contextNodeId, searchFromNode) => [
                {nodeId: `${contextNodeId}:${searchFromNode}`, content: 'body'},
            ],
        })
        configureMcpServer({graph: bridge})

        await expect(getMcpUnseenNodesAroundContextNode('ctx.md', 'task.md')).resolves.toEqual([
            {nodeId: 'ctx.md:task.md', content: 'body'},
        ])
        await applyMcpGraphDelta([], false)

        expect(appliedDeltas).toEqual([{delta: [], recordForUndo: false}])
    })
})
