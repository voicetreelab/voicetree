import {buildFolderCandidates} from './folder'
import {buildLouvainCandidates} from './louvain'
import {normalizeGraph, type NormalizedGraph} from './normalize'
import {greedilySelectCandidates} from './selection'
import type {
    Candidate,
    CollapseBoundaryGraph,
    CollapseCluster,
    FindCollapseBoundaryOptions,
    SelectionResult,
} from './types'

export type {
    CollapseStrategy,
    CollapseBoundaryNode,
    CollapseBoundaryGraph,
    CollapseCluster,
    FindCollapseBoundaryOptions,
} from './types'

/**
 * Count visible entities (expanded nodes + cluster summaries).
 * This is the quantity budgeted against — caps total cognitive items the agent
 * sees in one render, regardless of textual line count.
 */
export function countVisibleEntities(
    totalNodeCount: number,
    clusters: readonly CollapseCluster[],
): number {
    const collapsedNodeCount: number = clusters.reduce((sum, cluster) => sum + cluster.nodeIds.length, 0)
    return (totalNodeCount - collapsedNodeCount) + clusters.length
}

export function findCollapseBoundary(
    graph: CollapseBoundaryGraph,
    budget: number,
    options: FindCollapseBoundaryOptions = {},
): readonly CollapseCluster[] {
    const normalized: NormalizedGraph = normalizeGraph(graph, options)
    const fullEntityCount: number = normalized.nodes.length
    if (fullEntityCount <= budget) {
        return []
    }

    const folderSelection: SelectionResult = selectWithStrategy(
        normalized,
        buildFolderCandidates(normalized),
        budget,
        fullEntityCount,
    )
    if (folderSelection.clusters.length > 0 && folderSelection.finalEntityCount <= budget) {
        return folderSelection.clusters
    }

    const louvainSelection: SelectionResult = selectWithStrategy(
        normalized,
        buildLouvainCandidates(normalized),
        budget,
        fullEntityCount,
    )

    return chooseBetterSelection(folderSelection, louvainSelection, budget)
}

function selectWithStrategy(
    normalized: NormalizedGraph,
    candidates: readonly Candidate[],
    budget: number,
    fullEntityCount: number,
): SelectionResult {
    return greedilySelectCandidates(normalized, candidates, budget, fullEntityCount)
}

function chooseBetterSelection(
    folderSelection: SelectionResult,
    louvainSelection: SelectionResult,
    budget: number,
): readonly CollapseCluster[] {
    if (folderSelection.clusters.length === 0) {
        return louvainSelection.clusters
    }
    if (louvainSelection.clusters.length === 0) {
        return folderSelection.clusters
    }
    if (louvainSelection.finalEntityCount <= budget) {
        return louvainSelection.clusters
    }
    if (folderSelection.finalEntityCount <= budget) {
        return folderSelection.clusters
    }
    return louvainSelection.finalEntityCount < folderSelection.finalEntityCount
        ? louvainSelection.clusters
        : folderSelection.clusters
}
