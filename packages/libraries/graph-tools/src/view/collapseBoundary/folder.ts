import path from 'node:path'

import {computeClusterStats, isOversizedCluster, pickRepresentative} from './selection'
import {normalizeSelectableId, type NormalizedGraph} from './normalize'
import type {Candidate, CollapseBoundaryNode} from './types'

export function buildFolderCandidates(graph: NormalizedGraph): readonly Candidate[] {
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

export function detectAlignedFolderPath(
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

export function longestCommonFolderPrefix(folderPaths: readonly string[]): string {
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

function normalizeFolderSeedPath(relPath: string): string {
    return normalizeSelectableId(relPath).replace(/\/+$/g, '')
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
