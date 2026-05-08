import path from 'node:path'
import {computeArboricity, type DirectedEdge} from '../scripts/L3-BF-192-tree-cover-render'

export type CollapseStrategy = 'folder-first' | 'louvain'

export interface CollapseBoundaryNode {
    readonly id: string
    readonly title: string
    readonly relPath: string
    readonly folderPath: string
    readonly outgoingIds: readonly string[]
    readonly kind?: 'file' | 'folder'
}

export interface CollapseBoundaryGraph {
    readonly rootName: string
    readonly nodes: readonly CollapseBoundaryNode[]
}

export interface CollapseCluster {
    readonly id: string
    readonly label: string
    readonly strategy: CollapseStrategy
    readonly nodeIds: readonly string[]
    readonly anchorFolderPath: string
    readonly alignedFolderPath?: string
    readonly representativeRelPath: string
    readonly internalEdgeCount: number
    readonly incomingEdgeCount: number
    readonly outgoingEdgeCount: number
    readonly boundaryEdgeCount: number
    readonly cohesion: number
}

export interface FindCollapseBoundaryOptions {
    readonly selectedIds?: readonly string[]
    readonly focusNodeId?: string
}

interface NormalizedGraph {
    readonly rootName: string
    readonly nodes: readonly CollapseBoundaryNode[]
    readonly nodeById: ReadonlyMap<string, CollapseBoundaryNode>
    readonly edges: readonly DirectedEdge[]
    readonly forests: readonly (readonly DirectedEdge[])[]
    readonly protectedIds: ReadonlySet<string>
    readonly pageRank: ReadonlyMap<string, number>
}

interface Candidate extends CollapseCluster {
    readonly sortLabel: string
}

interface SelectionResult {
    readonly clusters: readonly Candidate[]
    readonly finalEntityCount: number
}

interface ClusterStats {
    readonly internalEdgeCount: number
    readonly incomingEdgeCount: number
    readonly outgoingEdgeCount: number
    readonly boundaryEdgeCount: number
    readonly cohesion: number
}

const FOLDER_ALIGNMENT_BONUS = 0.05

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

    const folderCandidates: readonly Candidate[] = buildFolderCandidates(normalized)
    const folderSelection: SelectionResult = greedilySelectCandidates(normalized, folderCandidates, budget, fullEntityCount)
    if (folderSelection.clusters.length > 0 && folderSelection.finalEntityCount <= budget) {
        return folderSelection.clusters
    }

    const louvainCandidates: readonly Candidate[] = buildLouvainCandidates(normalized)
    const louvainSelection: SelectionResult = greedilySelectCandidates(normalized, louvainCandidates, budget, fullEntityCount)

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

function normalizeGraph(
    graph: CollapseBoundaryGraph,
    options: FindCollapseBoundaryOptions,
): NormalizedGraph {
    const nodeById: Map<string, CollapseBoundaryNode> = new Map(graph.nodes.map(node => [node.id, node]))
    const edges: DirectedEdge[] = []
    for (const node of graph.nodes) {
        for (const targetId of node.outgoingIds) {
            if (targetId === node.id || !nodeById.has(targetId)) continue
            edges.push({src: node.id, tgt: targetId})
        }
    }
    return {
        rootName: graph.rootName,
        nodes: graph.nodes,
        nodeById,
        edges,
        forests: computeArboricity(graph.nodes.length, edges).forests,
        protectedIds: buildProtectedIds(graph.nodes, nodeById, edges, options),
        pageRank: computePageRank(graph.nodes, edges),
    }
}

function buildProtectedIds(
    nodes: readonly CollapseBoundaryNode[],
    nodeById: ReadonlyMap<string, CollapseBoundaryNode>,
    edges: readonly DirectedEdge[],
    options: FindCollapseBoundaryOptions,
): ReadonlySet<string> {
    const rawSeeds: readonly string[] = [
        ...(options.selectedIds ?? []),
        ...(options.focusNodeId ? [options.focusNodeId] : []),
    ]
    if (rawSeeds.length === 0) {
        return new Set()
    }

    const relPathMap: Map<string, string> = new Map()
    const basenames = new Map<string, string[]>()
    for (const node of nodes) {
        relPathMap.set(normalizeSelectableId(node.relPath), node.id)
        const basename: string = path.posix.basename(normalizeSelectableId(node.relPath))
        const ids: string[] = basenames.get(basename) ?? []
        ids.push(node.id)
        basenames.set(basename, ids)
    }

    const resolvedSeeds = new Set<string>()
    for (const rawSeed of rawSeeds) {
        const trimmed: string = rawSeed.trim()
        if (trimmed.length === 0) continue
        if (nodeById.has(trimmed)) {
            resolvedSeeds.add(trimmed)
            continue
        }

        const normalized: string = normalizeSelectableId(trimmed)
        const relMatch: string | undefined = relPathMap.get(normalized)
        if (relMatch) {
            resolvedSeeds.add(relMatch)
            continue
        }

        const basename: string = path.posix.basename(normalized)
        const ids: readonly string[] = basenames.get(basename) ?? []
        if (ids.length === 1) {
            resolvedSeeds.add(ids[0]!)
        }
    }

    if (resolvedSeeds.size === 0) {
        return resolvedSeeds
    }

    const neighbors = new Map<string, Set<string>>()
    for (const node of nodes) {
        neighbors.set(node.id, new Set())
    }
    for (const edge of edges) {
        neighbors.get(edge.src)?.add(edge.tgt)
        neighbors.get(edge.tgt)?.add(edge.src)
    }

    const protectedIds = new Set<string>()
    for (const seed of resolvedSeeds) {
        protectedIds.add(seed)
        for (const neighbor of neighbors.get(seed) ?? []) {
            protectedIds.add(neighbor)
        }
    }
    return protectedIds
}

function normalizeSelectableId(value: string): string {
    return value.replace(/\\/g, '/').replace(/\.md$/i, '')
}

function buildFolderCandidates(graph: NormalizedGraph): readonly Candidate[] {
    const folderPaths: readonly string[] = resolveFolderCandidatePaths(graph)

    const candidates: Candidate[] = []
    for (const folderPath of folderPaths) {
        if (folderPath.length === 0) continue
        const nodeIds: readonly string[] = graph.nodes
            .filter(node => isNodeUnderFolder(node, folderPath))
            .map(node => node.id)
        if (nodeIds.length < 2) continue
        if (isOversizedCluster(nodeIds.length, graph.nodes.length)) continue
        if (nodeIds.some(nodeId => graph.protectedIds.has(nodeId))) continue
        const stats = computeClusterStats(nodeIds, graph.edges)
        const representative: CollapseBoundaryNode | undefined = pickRepresentative(graph, nodeIds)
        candidates.push({
            id: `folder:${folderPath}`,
            label: `${folderPath}/`,
            strategy: 'folder-first',
            nodeIds,
            anchorFolderPath: parentFolderPath(folderPath),
            alignedFolderPath: folderPath,
            representativeRelPath: representative?.relPath ?? '',
            internalEdgeCount: stats.internalEdgeCount,
            incomingEdgeCount: stats.incomingEdgeCount,
            outgoingEdgeCount: stats.outgoingEdgeCount,
            boundaryEdgeCount: stats.boundaryEdgeCount,
            cohesion: stats.cohesion,
            sortLabel: folderPath,
        })
    }
    return candidates
}

function buildLouvainCandidates(graph: NormalizedGraph): readonly Candidate[] {
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

function isOversizedCluster(clusterSize: number, totalNodeCount: number): boolean {
    return totalNodeCount > 0 && clusterSize / totalNodeCount > 0.9
}

function greedilySelectCandidates(
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
        // Collapsing this cluster removes nodeIds.length expanded nodes, adds 1 summary entity.
        // Net reduction = nodeIds.length - 1 (always positive for clusters of size ≥ 2).
        const nextEntityCount: number = entityCount - candidate.nodeIds.length + 1
        if (nextEntityCount >= entityCount) continue

        selected.push(candidate)
        candidate.nodeIds.forEach(nodeId => selectedNodeIds.add(nodeId))
        entityCount = nextEntityCount
        if (entityCount <= budget) break
    }

    return {clusters: selected, finalEntityCount: entityCount}
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

function computeClusterStats(
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

/**
 * Pick the representative node of a cluster: highest-pagerank member, with
 * degree and title as tiebreakers. Used both for cluster labelling and for
 * the `expand:` command emitted on each collapsed summary.
 */
function pickRepresentative(
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

function computePageRank(
    nodes: readonly CollapseBoundaryNode[],
    edges: readonly DirectedEdge[],
): ReadonlyMap<string, number> {
    if (nodes.length === 0) {
        return new Map()
    }

    const ids: readonly string[] = nodes.map(node => node.id)
    const outgoing = new Map<string, string[]>()
    const incoming = new Map<string, string[]>()
    for (const nodeId of ids) {
        outgoing.set(nodeId, [])
        incoming.set(nodeId, [])
    }

    for (const edge of edges) {
        if (edge.src === edge.tgt) continue
        outgoing.get(edge.src)?.push(edge.tgt)
        incoming.get(edge.tgt)?.push(edge.src)
    }

    const nodeCount: number = nodes.length
    let ranks: Map<string, number> = new Map(ids.map(nodeId => [nodeId, 1 / nodeCount]))
    const damping = 0.85

    for (let iteration = 0; iteration < 25; iteration += 1) {
        let danglingShare = 0
        for (const nodeId of ids) {
            const degree: number = outgoing.get(nodeId)?.length ?? 0
            if (degree === 0) {
                danglingShare += (ranks.get(nodeId) ?? 0) / nodeCount
            }
        }

        const nextRanks = new Map<string, number>()
        for (const nodeId of ids) {
            let score: number = (1 - damping) / nodeCount
            score += damping * danglingShare
            for (const sourceId of incoming.get(nodeId) ?? []) {
                const outDegree: number = outgoing.get(sourceId)?.length ?? 0
                if (outDegree === 0) continue
                score += damping * (ranks.get(sourceId) ?? 0) / outDegree
            }
            nextRanks.set(nodeId, score)
        }
        ranks = nextRanks
    }

    return ranks
}

function ancestorFolders(folderPath: string): readonly string[] {
    if (folderPath.length === 0) {
        return []
    }
    const segments: readonly string[] = folderPath.split('/').filter(Boolean)
    return segments.map((_, index) => segments.slice(0, index + 1).join('/'))
}

function parentFolderPath(folderPath: string): string {
    const parent: string = path.posix.dirname(folderPath)
    return parent === '.' ? '' : parent
}

function longestCommonFolderPrefix(folderPaths: readonly string[]): string {
    const nonEmptyPaths: readonly string[] = folderPaths.filter(Boolean)
    if (nonEmptyPaths.length === 0) {
        return ''
    }

    const splitPaths: readonly (readonly string[])[] = nonEmptyPaths.map(folderPath => folderPath.split('/').filter(Boolean))
    const firstPath: readonly string[] = splitPaths[0] ?? []
    const sharedSegments: string[] = []
    for (let index = 0; index < firstPath.length; index += 1) {
        const segment: string = firstPath[index]!
        if (splitPaths.every(segments => segments[index] === segment)) {
            sharedSegments.push(segment)
            continue
        }
        break
    }
    return sharedSegments.join('/')
}

function resolveFolderCandidatePaths(graph: NormalizedGraph): readonly string[] {
    const explicitFolderPaths: readonly string[] = graph.nodes
        .filter((node): node is CollapseBoundaryNode & {readonly kind: 'folder'} => node.kind === 'folder')
        .map(node => normalizeFolderSeedPath(node.relPath))
        .filter(Boolean)
    if (explicitFolderPaths.length > 0) {
        return [...new Set(explicitFolderPaths)].sort((left, right) => left.localeCompare(right))
    }

    const hasMissingKindMetadata: boolean = graph.nodes.some(node => node.kind === undefined)
    if (!hasMissingKindMetadata) {
        return []
    }

    const legacyFolderPaths = new Set<string>()
    for (const node of graph.nodes) {
        for (const folderPath of ancestorFolders(node.folderPath)) {
            legacyFolderPaths.add(folderPath)
        }
    }
    return [...legacyFolderPaths].sort((left, right) => left.localeCompare(right))
}

function normalizeFolderSeedPath(relPath: string): string {
    return normalizeSelectableId(relPath).replace(/\/+$/g, '')
}

function detectAlignedFolderPath(
    graph: NormalizedGraph,
    nodeIds: readonly string[],
): string | undefined {
    const commonPrefix: string = longestCommonFolderPrefix(
        nodeIds.map(nodeId => folderPathForAlignment(graph.nodeById.get(nodeId))),
    )
    if (commonPrefix.length === 0) {
        return undefined
    }
    return nodeIds.every(nodeId => {
        const node: CollapseBoundaryNode | undefined = graph.nodeById.get(nodeId)
        return node !== undefined && isNodeUnderFolder(node, commonPrefix)
    })
        ? commonPrefix
        : undefined
}

function folderPathForAlignment(node: CollapseBoundaryNode | undefined): string {
    if (!node) {
        return ''
    }
    if (node.kind === 'folder') {
        return normalizeFolderSeedPath(node.relPath)
    }
    return node.folderPath
}

function isNodeUnderFolder(node: CollapseBoundaryNode, folderPath: string): boolean {
    if (folderPath.length === 0) {
        return false
    }
    if (node.kind === 'folder') {
        const nodeFolderPath: string = normalizeFolderSeedPath(node.relPath)
        return isSamePathOrDescendant(nodeFolderPath, folderPath) && nodeFolderPath !== folderPath
    }
    return isSamePathOrDescendant(node.folderPath, folderPath)
}

function isSamePathOrDescendant(candidatePath: string, folderPath: string): boolean {
    return candidatePath === folderPath || candidatePath.startsWith(`${folderPath}/`)
}
