import {detectAlignedFolderPath, longestCommonFolderPrefix} from './folder'
import {computeClusterStats, isOversizedCluster, pickRepresentative} from './selection'
import type {NormalizedGraph} from './normalize'
import type {Candidate, CollapseBoundaryNode} from './types'

export function buildLouvainCandidates(graph: NormalizedGraph): readonly Candidate[] {
    const communities: readonly (readonly string[])[] = detectLouvainCommunities(graph)
    const candidates: Candidate[] = []
    communities.forEach((nodeIds, index) => {
        if (nodeIds.length < 2) return
        if (isOversizedCluster(nodeIds.length, graph.nodes.length)) return
        const representative: CollapseBoundaryNode | undefined = pickRepresentative(graph, nodeIds)
        const label: string = representative?.title ?? `cluster-${index + 1}`
        const stats = computeClusterStats(nodeIds, graph.edges)
        const alignedFolderPath: string | undefined = detectAlignedFolderPath(graph, nodeIds)
        candidates.push({
            id: `louvain:${index + 1}`,
            label,
            strategy: 'louvain',
            nodeIds,
            anchorFolderPath: longestCommonFolderPrefix(nodeIds.map(nodeId => graph.nodeById.get(nodeId)?.folderPath ?? '')),
            alignedFolderPath,
            representativeRelPath: representative?.relPath ?? '',
            internalEdgeCount: stats.internalEdgeCount,
            incomingEdgeCount: stats.incomingEdgeCount,
            outgoingEdgeCount: stats.outgoingEdgeCount,
            boundaryEdgeCount: stats.boundaryEdgeCount,
            cohesion: stats.cohesion,
            sortLabel: label,
        })
    })
    return candidates
}

function detectLouvainCommunities(graph: NormalizedGraph): readonly (readonly string[])[] {
    const availableIds: readonly string[] = graph.nodes
        .map(node => node.id)
        .filter(nodeId => !graph.protectedIds.has(nodeId))
    if (availableIds.length < 2) {
        return []
    }

    const adjacency = new Map<string, Map<string, number>>()
    const degree = new Map<string, number>()
    for (const nodeId of availableIds) {
        adjacency.set(nodeId, new Map())
        degree.set(nodeId, 0)
    }

    for (const edge of graph.edges) {
        if (edge.src === edge.tgt) continue
        if (!adjacency.has(edge.src) || !adjacency.has(edge.tgt)) continue
        incrementWeight(adjacency.get(edge.src)!, edge.tgt, 1)
        incrementWeight(adjacency.get(edge.tgt)!, edge.src, 1)
        degree.set(edge.src, (degree.get(edge.src) ?? 0) + 1)
        degree.set(edge.tgt, (degree.get(edge.tgt) ?? 0) + 1)
    }

    const totalWeightTwice: number = [...degree.values()].reduce((sum, value) => sum + value, 0)
    if (totalWeightTwice === 0) {
        return []
    }

    const communityOf = new Map<string, string>(availableIds.map(nodeId => [nodeId, nodeId]))
    const communityWeight = new Map<string, number>(availableIds.map(nodeId => [nodeId, degree.get(nodeId) ?? 0]))
    const orderedIds: readonly string[] = [...availableIds].sort((left, right) => left.localeCompare(right))

    for (let pass = 0; pass < 20; pass += 1) {
        let moved = false
        for (const nodeId of orderedIds) {
            const nodeDegree: number = degree.get(nodeId) ?? 0
            if (nodeDegree === 0) continue

            const currentCommunity: string = communityOf.get(nodeId) ?? nodeId
            const neighborCommunityWeights = new Map<string, number>()
            for (const [neighborId, weight] of adjacency.get(nodeId) ?? []) {
                const communityId: string = communityOf.get(neighborId) ?? neighborId
                neighborCommunityWeights.set(communityId, (neighborCommunityWeights.get(communityId) ?? 0) + weight)
            }

            communityWeight.set(currentCommunity, (communityWeight.get(currentCommunity) ?? 0) - nodeDegree)

            let bestCommunity: string = currentCommunity
            let bestGain = 0
            for (const [communityId, weightToCommunity] of neighborCommunityWeights) {
                const gain: number = weightToCommunity - ((communityWeight.get(communityId) ?? 0) * nodeDegree) / totalWeightTwice
                if (gain > bestGain + 1e-9 || (Math.abs(gain - bestGain) <= 1e-9 && communityId < bestCommunity)) {
                    bestGain = gain
                    bestCommunity = communityId
                }
            }

            communityWeight.set(bestCommunity, (communityWeight.get(bestCommunity) ?? 0) + nodeDegree)
            if (bestCommunity !== currentCommunity) {
                communityOf.set(nodeId, bestCommunity)
                moved = true
            }
        }

        if (!moved) break
    }

    const communities = new Map<string, string[]>()
    for (const nodeId of orderedIds) {
        const communityId: string = communityOf.get(nodeId) ?? nodeId
        const ids: string[] = communities.get(communityId) ?? []
        ids.push(nodeId)
        communities.set(communityId, ids)
    }

    return [...communities.values()].filter(ids => ids.length > 1)
}

function incrementWeight(weights: Map<string, number>, nodeId: string, value: number): void {
    weights.set(nodeId, (weights.get(nodeId) ?? 0) + value)
}
