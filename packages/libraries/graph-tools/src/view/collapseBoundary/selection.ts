import type {DirectedEdge} from '@vt/graph-tools/scripts/L3-BF-192-tree-cover-render'

import type {NormalizedGraph} from './normalize'
import type {Candidate, ClusterStats, CollapseBoundaryNode, SelectionResult} from './types'

const FOLDER_ALIGNMENT_BONUS = 0.05

export function isOversizedCluster(clusterSize: number, totalNodeCount: number): boolean {
    return totalNodeCount > 0 && clusterSize / totalNodeCount > 0.9
}

export function greedilySelectCandidates(
    graph: NormalizedGraph,
    candidates: readonly Candidate[],
    budget: number,
    fullEntityCount: number,
): SelectionResult {
    const sortedCandidates: Candidate[] = [...candidates].sort(compareCandidates)
    const selected: Candidate[] = []
    const selectedNodeIds = new Set<string>()
    let entityCount: number = fullEntityCount

    for (const candidate of sortedCandidates) {
        if (candidate.nodeIds.some(nodeId => selectedNodeIds.has(nodeId) || graph.protectedIds.has(nodeId))) continue
        const nextEntityCount: number = entityCount - candidate.nodeIds.length + 1
        if (nextEntityCount >= entityCount) continue

        selected.push(candidate)
        candidate.nodeIds.forEach(nodeId => selectedNodeIds.add(nodeId))
        entityCount = nextEntityCount
        if (entityCount <= budget) break
    }

    return {clusters: selected, finalEntityCount: entityCount}
}

export function computeClusterStats(
    nodeIds: readonly string[],
    edges: readonly DirectedEdge[],
): ClusterStats {
    const nodeSet: ReadonlySet<string> = new Set(nodeIds)
    let internalEdgeCount = 0
    let incomingEdgeCount = 0
    let outgoingEdgeCount = 0

    for (const edge of edges) {
        const srcInside: boolean = nodeSet.has(edge.src)
        const tgtInside: boolean = nodeSet.has(edge.tgt)
        if (srcInside && tgtInside) {
            internalEdgeCount += 1
        } else if (!srcInside && tgtInside) {
            incomingEdgeCount += 1
        } else if (srcInside && !tgtInside) {
            outgoingEdgeCount += 1
        }
    }

    const boundaryEdgeCount: number = incomingEdgeCount + outgoingEdgeCount
    const denominator: number = internalEdgeCount + boundaryEdgeCount
    return {
        internalEdgeCount,
        incomingEdgeCount,
        outgoingEdgeCount,
        boundaryEdgeCount,
        cohesion: denominator === 0 ? 1 : internalEdgeCount / denominator,
    }
}

/**
 * Pick the representative node of a cluster: highest-pagerank member, with
 * degree and title as tiebreakers. Used both for cluster labelling and for
 * the `expand:` command emitted on each collapsed summary.
 */
export function pickRepresentative(
    graph: NormalizedGraph,
    nodeIds: readonly string[],
): CollapseBoundaryNode | undefined {
    const rankedNodes: readonly CollapseBoundaryNode[] = [...nodeIds]
        .map(nodeId => graph.nodeById.get(nodeId))
        .filter((node): node is CollapseBoundaryNode => node !== undefined)
        .sort((left, right) => {
            const leftRank: number = graph.pageRank.get(left.id) ?? 0
            const rightRank: number = graph.pageRank.get(right.id) ?? 0
            if (leftRank !== rightRank) {
                return rightRank - leftRank
            }
            if (left.outgoingIds.length !== right.outgoingIds.length) {
                return right.outgoingIds.length - left.outgoingIds.length
            }
            return left.title.localeCompare(right.title)
        })
    return rankedNodes[0]
}

function compareCandidates(left: Candidate, right: Candidate): number {
    const leftEffectiveCohesion: number = effectiveCohesion(left)
    const rightEffectiveCohesion: number = effectiveCohesion(right)
    if (leftEffectiveCohesion !== rightEffectiveCohesion) {
        return rightEffectiveCohesion - leftEffectiveCohesion
    }
    if (left.nodeIds.length !== right.nodeIds.length) {
        return right.nodeIds.length - left.nodeIds.length
    }
    if (left.internalEdgeCount !== right.internalEdgeCount) {
        return right.internalEdgeCount - left.internalEdgeCount
    }
    return left.sortLabel.localeCompare(right.sortLabel)
}

function effectiveCohesion(candidate: Candidate): number {
    return candidate.alignedFolderPath ? candidate.cohesion + FOLDER_ALIGNMENT_BONUS : candidate.cohesion
}
