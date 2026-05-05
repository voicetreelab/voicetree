import * as path from 'node:path'
import {type CollapseCluster} from './collapseBoundary'
import {type AutoViewNode, type AutoViewGraph} from './autoView'
import {type DirectedEdge} from '../scripts/L3-BF-192-tree-cover-render'
import {ancestorFolders, parentFolderPath} from './autoViewRender'

interface FolderSeed {
    readonly absPath: string
    readonly basename: string
    readonly folderPath: string
}

interface ClusterStats {
    readonly internalEdgeCount: number
    readonly incomingEdgeCount: number
    readonly outgoingEdgeCount: number
    readonly boundaryEdgeCount: number
    readonly cohesion: number
}

interface PinnedResolutionIndex {
    readonly folderByNormalizedAbsPath: ReadonlyMap<string, FolderSeed>
    readonly folderByNormalizedRelPath: ReadonlyMap<string, FolderSeed>
    readonly foldersByBasename: ReadonlyMap<string, readonly FolderSeed[]>
    readonly nodeByNormalizedRelPath: ReadonlyMap<string, AutoViewNode>
    readonly nodesByBasename: ReadonlyMap<string, readonly AutoViewNode[]>
}

export function buildPinnedClusters(
    graph: AutoViewGraph,
    pinnedFolderIds: readonly string[],
): readonly CollapseCluster[] {
    if (pinnedFolderIds.length === 0) {
        return []
    }

    const folderSeeds: readonly FolderSeed[] = buildFolderSeeds(graph)
    const resolutionIndex: PinnedResolutionIndex = buildPinnedResolutionIndex(graph, folderSeeds)
    const seenFolderPaths = new Set<string>()
    const clusters: CollapseCluster[] = []

    for (const rawPinnedId of pinnedFolderIds) {
        const folderPath: string | undefined = resolvePinnedFolderPath(graph, resolutionIndex, rawPinnedId)
        if (!folderPath || seenFolderPaths.has(folderPath)) {
            continue
        }

        const nodeIds: readonly string[] = graph.nodes
            .filter(node => isNodeInsidePinnedFolder(node, folderPath))
            .map(node => node.id)
        if (nodeIds.length === 0) {
            console.error(
                `[folder-aware-view] ignoring pinned folder "${rawPinnedId}": folder "${folderPath}/" has no descendants`,
            )
            continue
        }

        const stats: ClusterStats = computeClusterStats(nodeIds, graph.edges)
        const representativeRelPath: string = pickPinnedRepresentativeRelPath(graph, nodeIds, folderPath)
        clusters.push({
            id: `pinned:${folderPath}`,
            label: `${folderPath}/`,
            strategy: 'folder-first',
            nodeIds,
            anchorFolderPath: parentFolderPath(folderPath),
            alignedFolderPath: folderPath,
            representativeRelPath,
            internalEdgeCount: stats.internalEdgeCount,
            incomingEdgeCount: stats.incomingEdgeCount,
            outgoingEdgeCount: stats.outgoingEdgeCount,
            boundaryEdgeCount: stats.boundaryEdgeCount,
            cohesion: stats.cohesion,
        })
        seenFolderPaths.add(folderPath)
    }

    return [...clusters].sort((left, right) => left.label.localeCompare(right.label))
}

function buildFolderSeeds(graph: AutoViewGraph): readonly FolderSeed[] {
    const explicitFolderSeeds: readonly FolderSeed[] = graph.nodes
        .filter((node): node is AutoViewNode & {readonly kind: 'folder'} => node.kind === 'folder')
        .map(node => {
            const folderPath: string = normalizeFolderSeedPath(node.relPath)
            return {
                absPath: normalizeFolderSeedPath(path.resolve(graph.rootPath, folderPath)),
                basename: path.posix.basename(folderPath),
                folderPath,
            }
        })
        .filter(seed => seed.folderPath.length > 0)
    if (explicitFolderSeeds.length > 0) {
        return dedupeFolderSeeds(explicitFolderSeeds)
    }

    const hasMissingKindMetadata: boolean = graph.nodes.some(node => node.kind === undefined)
    if (!hasMissingKindMetadata) {
        return []
    }

    const legacyFolderPaths = new Set<string>()
    for (const node of graph.nodes) {
        if (node.kind === 'folder') continue
        ancestorFolders(node.folderPath).forEach(folderPath => legacyFolderPaths.add(folderPath))
    }

    return [...legacyFolderPaths]
        .sort((left, right) => left.localeCompare(right))
        .map(folderPath => ({
            absPath: normalizeFolderSeedPath(path.resolve(graph.rootPath, folderPath)),
            basename: path.posix.basename(folderPath),
            folderPath,
        }))
}

function dedupeFolderSeeds(folderSeeds: readonly FolderSeed[]): readonly FolderSeed[] {
    const deduped = new Map<string, FolderSeed>()
    for (const folderSeed of folderSeeds) {
        deduped.set(folderSeed.folderPath, folderSeed)
    }
    return [...deduped.values()].sort((left, right) => left.folderPath.localeCompare(right.folderPath))
}

function buildPinnedResolutionIndex(
    graph: AutoViewGraph,
    folderSeeds: readonly FolderSeed[],
): PinnedResolutionIndex {
    const folderByNormalizedAbsPath = new Map<string, FolderSeed>()
    const folderByNormalizedRelPath = new Map<string, FolderSeed>()
    const foldersByBasename = new Map<string, FolderSeed[]>()
    for (const folderSeed of folderSeeds) {
        folderByNormalizedAbsPath.set(normalizeFolderSeedPath(folderSeed.absPath), folderSeed)
        folderByNormalizedRelPath.set(normalizeFolderSeedPath(folderSeed.folderPath), folderSeed)
        const entries: FolderSeed[] = foldersByBasename.get(folderSeed.basename) ?? []
        entries.push(folderSeed)
        foldersByBasename.set(folderSeed.basename, entries)
    }

    const nodeByNormalizedRelPath = new Map<string, AutoViewNode>()
    const nodesByBasename = new Map<string, AutoViewNode[]>()
    for (const node of graph.nodes) {
        nodeByNormalizedRelPath.set(normalizeSelectableId(node.relPath), node)
        const basename: string = path.posix.basename(normalizeSelectableId(node.relPath))
        const entries: AutoViewNode[] = nodesByBasename.get(basename) ?? []
        entries.push(node)
        nodesByBasename.set(basename, entries)
    }

    return {
        folderByNormalizedAbsPath,
        folderByNormalizedRelPath,
        foldersByBasename,
        nodeByNormalizedRelPath,
        nodesByBasename,
    }
}

function resolvePinnedFolderPath(
    graph: AutoViewGraph,
    index: PinnedResolutionIndex,
    rawPinnedId: string,
): string | undefined {
    const trimmed: string = rawPinnedId.trim()
    if (trimmed.length === 0) {
        return undefined
    }

    const directNodeMatch: AutoViewNode | undefined = graph.nodeById.get(trimmed)
    if (directNodeMatch) {
        return resolveFolderPathFromNode(rawPinnedId, directNodeMatch)
    }

    const normalizedFolderSeed: string = normalizeFolderSeedPath(trimmed)
    const normalizedNodeSeed: string = normalizeSelectableId(trimmed)

    const directFolderMatch: FolderSeed | undefined =
        index.folderByNormalizedAbsPath.get(normalizedFolderSeed) ??
        index.folderByNormalizedRelPath.get(normalizedFolderSeed)
    if (directFolderMatch) {
        return directFolderMatch.folderPath
    }

    const relPathNodeMatch: AutoViewNode | undefined = index.nodeByNormalizedRelPath.get(normalizedNodeSeed)
    if (relPathNodeMatch) {
        return resolveFolderPathFromNode(rawPinnedId, relPathNodeMatch)
    }

    const basename: string = path.posix.basename(normalizedFolderSeed)
    const folderBasenameMatches: readonly FolderSeed[] = index.foldersByBasename.get(basename) ?? []
    if (folderBasenameMatches.length === 1) {
        return folderBasenameMatches[0]!.folderPath
    }

    const nodeBasenameMatches: readonly AutoViewNode[] = index.nodesByBasename.get(path.posix.basename(normalizedNodeSeed)) ?? []
    if (nodeBasenameMatches.length === 1) {
        return resolveFolderPathFromNode(rawPinnedId, nodeBasenameMatches[0]!)
    }

    console.error(`[folder-aware-view] ignoring pinned folder "${rawPinnedId}": no matching folder found`)
    return undefined
}

function resolveFolderPathFromNode(
    rawPinnedId: string,
    node: AutoViewNode,
): string | undefined {
    if (node.kind === 'folder') {
        return normalizeFolderSeedPath(node.relPath)
    }
    console.error(
        `[folder-aware-view] ignoring pinned folder "${rawPinnedId}": resolved node "${node.relPath}" is not a folder`,
    )
    return undefined
}

function normalizeSelectableId(value: string): string {
    return value.replace(/\\/g, '/').replace(/\.md$/i, '')
}

function normalizeFolderSeedPath(value: string): string {
    return normalizeSelectableId(value).replace(/\/+$/g, '')
}

function isNodeInsidePinnedFolder(node: AutoViewNode, folderPath: string): boolean {
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

function pickPinnedRepresentativeRelPath(
    graph: AutoViewGraph,
    nodeIds: readonly string[],
    folderPath: string,
): string {
    const preferredRelPath: string = `${folderPath}/index.md`
    const preferredNode: AutoViewNode | undefined = nodeIds
        .map(nodeId => graph.nodeById.get(nodeId))
        .find(node => node?.relPath === preferredRelPath)
    if (preferredNode) {
        return preferredNode.relPath
    }
    return [...nodeIds]
        .map(nodeId => graph.nodeById.get(nodeId))
        .filter((node): node is AutoViewNode => node !== undefined)
        .sort((left, right) => left.relPath.localeCompare(right.relPath))[0]?.relPath ?? ''
}
