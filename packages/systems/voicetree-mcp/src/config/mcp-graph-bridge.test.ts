import {beforeEach, describe, expect, it, vi} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import {createEmptyGraph} from '@vt/graph-model/graph'
import type {GraphBridge} from './mcp-config'
import {configureMcpServer} from './mcp-config'
import {
    applyMcpGraphDelta,
    getMcpGraph,
    getMcpProjectRootWatchedDirectory,
    getMcpUnseenNodesAroundContextNode,
    getMcpVaultPaths,
    getMcpWritePath,
} from './mcp-graph-bridge'

function makeBridge(overrides: Partial<GraphBridge> = {}): GraphBridge {
    const graph = createEmptyGraph()
    return {
        getGraph: vi.fn(async () => graph),
        getVaultPaths: vi.fn(async () => ['/vault']),
        getWritePath: vi.fn(async () => '/vault'),
        getProjectRootWatchedDirectory: vi.fn(async () => '/vault'),
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
        await expect(getMcpGraph()).rejects.toThrow(
            'MCP graph bridge not configured. Call configureMcpServer({ graph: ... }) at boot before getMcpGraph.',
        )
        await expect(getMcpProjectRootWatchedDirectory()).rejects.toThrow(
            'MCP graph bridge not configured. Call configureMcpServer({ graph: ... }) at boot before getMcpProjectRootWatchedDirectory.',
        )
    })

    it('delegates graph reads and writes to the configured bridge', async () => {
        const bridge: GraphBridge = makeBridge()
        configureMcpServer({graph: bridge})

        await expect(getMcpGraph()).resolves.toBe(await bridge.getGraph())
        await expect(getMcpVaultPaths()).resolves.toEqual(['/vault'])
        await expect(getMcpWritePath()).resolves.toEqual(O.some('/vault'))
        await expect(getMcpProjectRootWatchedDirectory()).resolves.toBe('/vault')
        await expect(getMcpUnseenNodesAroundContextNode('ctx.md', 'task.md')).resolves.toEqual([
            {nodeId: 'n.md', content: 'body'},
        ])
        await applyMcpGraphDelta([], false)

        expect(bridge.getUnseenNodesAroundContextNode).toHaveBeenCalledWith('ctx.md', 'task.md')
        expect(bridge.applyGraphDelta).toHaveBeenCalledWith([], false)
    })

    it('returns none for a configured bridge with no write path', async () => {
        configureMcpServer({
            graph: makeBridge({
                getWritePath: vi.fn(async () => null),
            }),
        })

        await expect(getMcpWritePath()).resolves.toEqual(O.none)
    })
})
