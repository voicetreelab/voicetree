import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphNode, NodeIdAndFilePath } from '@vt/graph-model/pure/graph'

vi.mock('@vt/graph-model', async () => {
    const actual: Record<string, unknown> = await vi.importActual('@vt/graph-model')
    return {
        ...actual,
        getGraph: vi.fn(),
        getProjectRootWatchedDirectory: vi.fn(),
        getVaultPaths: vi.fn(),
        getReadPaths: vi.fn(),
        getWritePath: vi.fn(),
        getDirectoryTree: vi.fn(),
    }
})

vi.mock('@/shell/edge/main/state/live-state-store', () => ({
    getCurrentLiveState: vi.fn(),
}))

import {
    getGraph,
    getProjectRootWatchedDirectory,
    getVaultPaths,
    getReadPaths,
    getWritePath,
    getDirectoryTree,
} from '@vt/graph-model'
import { getCurrentLiveState } from '@/shell/edge/main/state/live-state-store'
import { getLiveStateTool } from '@/shell/edge/main/mcp-server/getLiveStateTool'
import type { State } from '@vt/graph-state'

type McpToolResponse = {
    content: Array<{ type: 'text'; text: string }>
    isError?: boolean
}

function parse(resp: McpToolResponse): Record<string, unknown> {
    return JSON.parse(resp.content[0].text) as Record<string, unknown>
}

function buildFixtureGraph(): Graph {
    const nodeId: NodeIdAndFilePath = '/tmp/vault/sample.md' as NodeIdAndFilePath
    const node: GraphNode = {
        outgoingEdges: [],
        absoluteFilePathIsID: nodeId,
        contentWithoutYamlOrLinks: 'hello',
        nodeUIMetadata: {
            color: O.none,
            position: O.some({ x: 10, y: 20 }),
            additionalYAMLProps: new Map(),
            isContextNode: false,
        },
    }
    return {
        nodes: { [nodeId]: node },
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map(),
    }
}

describe('vt_get_live_state tool', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('returns SerializedState matching the live store + enriched roots/positions', async () => {
        const graph: Graph = buildFixtureGraph()

        const baseState: State = {
            graph,
            roots: { loaded: new Set(), folderTree: [] },
            collapseSet: new Set(['/tmp/vault/tasks/']),
            selection: new Set(['/tmp/vault/sample.md' as NodeIdAndFilePath]),
            layout: { positions: new Map() },
            meta: { schemaVersion: 1, revision: 3 },
        }

        vi.mocked(getCurrentLiveState).mockReturnValue(baseState)
        vi.mocked(getGraph).mockReturnValue(graph)
        vi.mocked(getProjectRootWatchedDirectory).mockReturnValue('/tmp/vault' as never)
        vi.mocked(getVaultPaths).mockResolvedValue(['/tmp/vault'] as never)
        vi.mocked(getReadPaths).mockResolvedValue([])
        vi.mocked(getWritePath).mockResolvedValue(O.some('/tmp/vault') as never)
        vi.mocked(getDirectoryTree).mockResolvedValue({
            absolutePath: '/tmp/vault' as never,
            name: 'vault',
            isDirectory: true,
            children: [],
        })

        const resp: McpToolResponse = await getLiveStateTool()
        expect(resp.isError).not.toBe(true)
        const payload: Record<string, unknown> = parse(resp)

        expect(payload.meta).toMatchObject({ schemaVersion: 1, revision: 3 })
        expect(payload.collapseSet).toEqual(['/tmp/vault/tasks/'])
        expect(payload.selection).toEqual(['/tmp/vault/sample.md'])
        const roots = payload.roots as { loaded: readonly string[]; folderTree: readonly unknown[] }
        expect(roots.loaded).toContain('/tmp/vault')
        expect(roots.folderTree.length).toBeGreaterThan(0)
        const layout = payload.layout as { positions: readonly (readonly [string, unknown])[] }
        expect(layout.positions).toContainEqual(['/tmp/vault/sample.md', { x: 10, y: 20 }])
        const graphSerialized = payload.graph as { nodes: Record<string, unknown> }
        expect(Object.keys(graphSerialized.nodes)).toEqual(['/tmp/vault/sample.md'])
    })

    it('returns isError when the enricher throws', async () => {
        vi.mocked(getCurrentLiveState).mockImplementation(() => {
            throw new Error('graph not loaded')
        })

        const resp: McpToolResponse = await getLiveStateTool()
        expect(resp.isError).toBe(true)
        const payload: Record<string, unknown> = parse(resp)
        expect(payload.error).toContain('graph not loaded')
    })
})
