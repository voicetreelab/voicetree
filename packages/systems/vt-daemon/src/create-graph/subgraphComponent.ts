/**
 * Pure component-size counter for the subgraph-gardening gate (BF-444).
 *
 * Counts the "ungardened component" a new node joins: the set of nodes reachable
 * from a start node through hard `[[wikilink]]` edges, traversed UNDIRECTED
 * (incoming ≡ outgoing), bounded to a single destination folder. Folder identity
 * notes are counted as one unit but never expanded (a neighbouring sub-cluster
 * collapses to a single child, matching the linter's folder-awareness). The
 * destination folder's own identity note is excluded from the count.
 *
 * See design.md Decision 1. No IO, no settings — post-insertion arithmetic
 * (adding the batch size) is the caller's job (BF-446).
 */

import type {Graph, NodeIdAndFilePath} from '@vt/graph-model/graph'
import {getFolderParent, getFolderIdentityNoteId, isFolderIdentityNote} from '@vt/graph-model/graph'

/**
 * Hard-edge neighbours of a node, treated undirected: authored outgoing wikilink
 * targets ∪ authored incoming sources. Synthetic/positional/directory-derived
 * edges are not part of `outgoingEdges`/`incomingEdgesIndex`, so they are
 * naturally excluded.
 */
function undirectedHardEdgeNeighbours(graph: Graph, nodeId: NodeIdAndFilePath): readonly NodeIdAndFilePath[] {
    const outgoing: readonly NodeIdAndFilePath[] =
        graph.nodes[nodeId]?.outgoingEdges.map(edge => edge.targetId) ?? []
    const incoming: readonly NodeIdAndFilePath[] = graph.incomingEdgesIndex.get(nodeId) ?? []
    return [...outgoing, ...incoming]
}

/**
 * Whether a node participates in the destination folder's component count: it is
 * a member of the folder, or a folder identity note (of any folder) that a member
 * links to. The destination folder's own identity note never counts.
 */
function isCountedMember(
    nodeId: NodeIdAndFilePath,
    folderPath: string,
    destinationIdentityNote: NodeIdAndFilePath,
): boolean {
    if (nodeId === destinationIdentityNote) return false
    return isFolderIdentityNote(nodeId) || getFolderParent(nodeId) === folderPath
}

/**
 * Size of the folder-bounded, undirected, hard-edge component reachable from
 * `startNodeId`, bounded to `folderPath` (a folder id with a trailing slash).
 *
 * The seed may itself sit outside `folderPath` (e.g. a task node parenting a
 * worktree folder); it bridges into the folder but is only counted if it belongs
 * to the folder. This makes the result the size of the destination cluster that
 * is actually growing, independent of where the parent lives.
 */
export function countFolderBoundedComponent(
    graph: Graph,
    startNodeId: NodeIdAndFilePath,
    folderPath: string,
): number {
    const destinationIdentityNote: NodeIdAndFilePath = getFolderIdentityNoteId(folderPath)

    const seen: Set<NodeIdAndFilePath> = new Set([startNodeId])
    const queue: NodeIdAndFilePath[] = [startNodeId]
    while (queue.length > 0) {
        const current: NodeIdAndFilePath = queue.pop() as NodeIdAndFilePath
        for (const neighbour of undirectedHardEdgeNeighbours(graph, current)) {
            if (seen.has(neighbour)) continue
            const neighbourNode = graph.nodes[neighbour]
            if (neighbourNode === undefined) continue                       // unresolved wikilink target
            if (neighbourNode.nodeUIMetadata.isContextNode === true) continue // context nodes are not graph members
            if (isFolderIdentityNote(neighbour)) {
                seen.add(neighbour)                                         // folder node: count, never expand
            } else if (getFolderParent(neighbour) === folderPath) {
                seen.add(neighbour)
                queue.push(neighbour)                                       // same-folder leaf: count and expand
            }
            // otherwise: a different-folder leaf — neither counted nor traversed
        }
    }

    let count: number = 0
    for (const nodeId of seen) {
        if (isCountedMember(nodeId, folderPath, destinationIdentityNote)) count++
    }
    return count
}
