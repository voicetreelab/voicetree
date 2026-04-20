import { afterEach, describe, expect, it, vi } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type { Core } from 'cytoscape'
import { createGraph } from '@vt/graph-model/pure/graph/createGraph'
import type { Graph, GraphDelta, GraphNode } from '@vt/graph-model/pure/graph'
import { extractIntoFolderFromUI } from '@/shell/edge/UI-edge/graph/extractIntoFolderFromUI'
import { getGraphCollapseSet, removeCollapsedFolderLocally } from '@/shell/edge/UI-edge/state/FolderTreeStore'

function createTestNode(id: string): GraphNode {
    return {
        absoluteFilePathIsID: id,
        outgoingEdges: [],
        contentWithoutYamlOrLinks: `# ${id}`,
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: new Map(),
            isContextNode: false
        }
    }
}

function getNewFolderIdFromDelta(delta: GraphDelta): string {
    const hubNoteId: string | undefined = delta
        .filter((nodeDelta): nodeDelta is Extract<typeof delta[number], { type: 'UpsertNode' }> => nodeDelta.type === 'UpsertNode')
        .map((nodeDelta) => nodeDelta.nodeToUpsert.absoluteFilePathIsID)
        .find((nodeId) => nodeId.includes('/hub_') && nodeId.endsWith('.md'))

    expect(hubNoteId).toBeDefined()
    return hubNoteId!.slice(0, hubNoteId!.lastIndexOf('/') + 1)
}

describe('extractIntoFolderFromUI', () => {
    afterEach(() => {
        ;[...getGraphCollapseSet()].forEach(removeCollapsedFolderLocally)
        vi.restoreAllMocks()
        // @ts-expect-error test cleanup
        window.electronAPI = undefined
    })

    it('adds the new extracted folder to the collapse set after apply succeeds', async () => {
        const graph: Graph = createGraph({
            '/tmp/vault/alpha.md': createTestNode('/tmp/vault/alpha.md'),
            '/tmp/vault/beta.md': createTestNode('/tmp/vault/beta.md')
        })
        let appliedDelta: GraphDelta | null = null
        const applyGraphDelta: ReturnType<typeof vi.fn<[GraphDelta], Promise<void>>> = vi.fn(async (delta: GraphDelta): Promise<void> => {
            appliedDelta = delta
        })

        // @ts-expect-error test-only electron bridge stub
        window.electronAPI = {
            main: {
                getGraph: vi.fn(async () => graph),
                getWritePath: vi.fn(async () => O.some('/tmp/vault')),
                applyGraphDeltaToDBThroughMemUIAndEditorExposed: applyGraphDelta
            }
        }

        await extractIntoFolderFromUI(
            ['/tmp/vault/alpha.md', '/tmp/vault/beta.md'],
            {} as Core
        )

        expect(applyGraphDelta).toHaveBeenCalledTimes(1)
        expect(appliedDelta).not.toBeNull()
        expect(getGraphCollapseSet().has(getNewFolderIdFromDelta(appliedDelta!))).toBe(true)
    })
})
