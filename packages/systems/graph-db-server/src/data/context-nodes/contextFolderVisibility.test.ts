import { describe, expect, it } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphNode, NodeIdAndFilePath } from '@vt/graph-model/graph'
import {
    collapsedFolderIdsFromFolderState,
    graphVisibleForContext,
} from './contextFolderVisibility'

function node(
    id: NodeIdAndFilePath,
    targets: readonly NodeIdAndFilePath[] = [],
): GraphNode {
    return {
        kind: 'leaf',
        absoluteFilePathIsID: id,
        contentWithoutYamlOrLinks: `# ${id}`,
        outgoingEdges: targets.map((targetId) => ({ targetId, label: '' })),
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: {},
            isContextNode: false,
        },
    }
}

function graph(nodes: readonly GraphNode[]): Graph {
    const nodeRecord: Record<NodeIdAndFilePath, GraphNode> = Object.fromEntries(
        nodes.map((graphNode) => [graphNode.absoluteFilePathIsID, graphNode]),
    ) as Record<NodeIdAndFilePath, GraphNode>
    const incomingEdgesIndex: Map<string, string[]> = new Map()
    for (const graphNode of nodes) {
        for (const edge of graphNode.outgoingEdges) {
            const incoming: string[] = incomingEdgesIndex.get(edge.targetId) ?? []
            incoming.push(graphNode.absoluteFilePathIsID)
            incomingEdgesIndex.set(edge.targetId, incoming)
        }
    }

    return {
        nodes: nodeRecord,
        incomingEdgesIndex,
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map(),
    }
}

describe('context folder visibility', () => {
    it('derives canonical collapsed folder ids from folder state rows', () => {
        expect([...collapsedFolderIdsFromFolderState([
            ['/project/docs', 'collapsed'],
            ['/project/open/', 'expanded'],
            ['/project/hidden', 'hidden'],
        ])]).toEqual(['/project/docs/'])
    })

    it('filters collapsed folder descendants while keeping the folder identity note representative', () => {
        const outside = '/project/outside.md' as NodeIdAndFilePath
        const folderNote = '/project/docs/docs.md' as NodeIdAndFilePath
        const hiddenDirectChild = '/project/docs/direct.md' as NodeIdAndFilePath
        const hiddenNestedChild = '/project/docs/deep/nested.md' as NodeIdAndFilePath

        const result = graphVisibleForContext(
            graph([
                node(outside, [folderNote, hiddenDirectChild, hiddenNestedChild]),
                node(folderNote, [outside, hiddenDirectChild]),
                node(hiddenDirectChild),
                node(hiddenNestedChild),
            ]),
            new Set(['/project/docs/']),
        )

        expect(Object.keys(result.nodes).sort()).toEqual([
            folderNote,
            outside,
        ].sort())
        expect(result.nodes[outside].outgoingEdges.map((edge) => edge.targetId)).toEqual([folderNote])
        expect(result.nodes[folderNote].outgoingEdges.map((edge) => edge.targetId)).toEqual([outside])
        expect(result.incomingEdgesIndex.get(folderNote)).toEqual([outside])
        expect(result.incomingEdgesIndex.has(hiddenDirectChild)).toBe(false)
    })
})
