import type { NodeIdAndFilePath, GraphNode, Graph } from './'

/**
 * Extract the folder parent path from a node ID.
 * e.g. "auth/login.md" → "auth/", "root.md" → null
 */
export function getFolderParent(nodeId: string): string | null {
    const lastSlash: number = nodeId.lastIndexOf('/')
    return lastSlash === -1 ? null : nodeId.slice(0, lastSlash + 1)
}

/**
 * Direct children: nodes whose getFolderParent() === folderPath
 * Excludes context nodes (they're never in cy).
 */
export const getFolderChildNodeIds: (
    nodes: Readonly<Record<NodeIdAndFilePath, GraphNode>>,
    folderPath: string
) => readonly NodeIdAndFilePath[] = (
    nodes,
    folderPath
) =>
    (Object.keys(nodes) as readonly NodeIdAndFilePath[]).filter(id =>
        getFolderParent(id) === folderPath
        && nodes[id].nodeUIMetadata.isContextNode !== true
    )

/**
 * All descendants: nodes whose ID starts with folderPath.
 * Includes nodes in nested sub-folders.
 */
export const getFolderDescendantNodeIds: (
    nodes: Readonly<Record<NodeIdAndFilePath, GraphNode>>,
    folderPath: string
) => readonly NodeIdAndFilePath[] = (
    nodes,
    folderPath
) =>
    (Object.keys(nodes) as readonly NodeIdAndFilePath[]).filter(id =>
        id.startsWith(folderPath)
        && nodes[id].nodeUIMetadata.isContextNode !== true
    )

/**
 * Intermediate sub-folder paths between folderPath and its descendants.
 * e.g. folderPath="a/", descendants include "a/b/c.md" → returns ["a/b/"]
 */
export const getSubFolderPaths: (
    nodes: Readonly<Record<NodeIdAndFilePath, GraphNode>>,
    folderPath: string
) => readonly string[] = (
    nodes,
    folderPath
) => {
    return [...new Set(
        Object.keys(nodes)
            .filter((id: string) => id.startsWith(folderPath))
            .map((id: string) => {
                const rest: string = id.slice(folderPath.length)
                const slashIdx: number = rest.indexOf('/')
                return slashIdx !== -1 ? folderPath + rest.slice(0, slashIdx + 1) : null
            })
            .filter((sf: string | null): sf is string => sf !== null)
    )]
}

// ── BF-116: Pure types for folder collapse/expand ──

export interface OriginalEdgeRef {
    readonly sourceId: string
    readonly targetId: string
    readonly label?: string
}

export interface SyntheticEdgeSpec {
    readonly syntheticEdgeId: string
    readonly direction: 'incoming' | 'outgoing'
    readonly externalNodeId: string
    readonly originalEdges: readonly OriginalEdgeRef[]
}

export interface ExpandPlan {
    readonly subFolders: readonly string[]
    readonly childNodes: readonly {
        readonly id: string
        readonly node: GraphNode
        readonly parentFolder: string | null
    }[]
    readonly realEdges: readonly {
        readonly id: string; readonly source: string
        readonly target: string; readonly label?: string
    }[]
    readonly syntheticEdges: readonly {
        readonly folderId: string
        readonly direction: 'incoming' | 'outgoing'
        readonly externalId: string
        readonly original: OriginalEdgeRef
    }[]
}

// ── BF-116: Pure functions ──

/**
 * Compute synthetic edge specs from pre-extracted cy data. PURE.
 * Groups cross-boundary edges by direction + external node, generates stable IDs.
 */
export function computeSyntheticEdgeSpecs(
    folderId: string,
    descendantIds: ReadonlySet<string>,
    connectedEdges: readonly { readonly sourceId: string; readonly targetId: string; readonly label?: string }[]
): readonly SyntheticEdgeSpec[] {
    const crossEdges = connectedEdges.filter(e =>
        !descendantIds.has(e.sourceId) || !descendantIds.has(e.targetId)
    )

    type EdgeGroup = { readonly direction: 'incoming' | 'outgoing'; readonly edges: OriginalEdgeRef[] }
    const groups = new Map<string, EdgeGroup>()

    for (const e of crossEdges) {
        const srcInside: boolean = descendantIds.has(e.sourceId)
        if (srcInside) {
            const key: string = `out:${e.targetId}`
            const g: EdgeGroup = groups.get(key) ?? { direction: 'outgoing' as const, edges: [] }
            g.edges.push({ sourceId: e.sourceId, targetId: e.targetId, label: e.label })
            groups.set(key, g)
        } else {
            const key: string = `in:${e.sourceId}`
            const g: EdgeGroup = groups.get(key) ?? { direction: 'incoming' as const, edges: [] }
            g.edges.push({ sourceId: e.sourceId, targetId: e.targetId, label: e.label })
            groups.set(key, g)
        }
    }

    return [...groups.entries()].map(([key, { direction, edges }]) => ({
        syntheticEdgeId: `synthetic:${folderId}:${key}`,
        direction,
        externalNodeId: key.slice(key.indexOf(':') + 1),
        originalEdges: edges
    }))
}

/**
 * Compute full restore plan for expanding a folder. PURE.
 * Takes Graph model data + current visibility, returns plan describing what to add/restore.
 */
export function computeExpandPlan(
    graph: Graph,
    folderId: string,
    collapsedFolders: ReadonlySet<string>,
    visibleNodeIds: ReadonlySet<string>
): ExpandPlan {
    const childIds: readonly string[] = getFolderChildNodeIds(graph.nodes, folderId)
    const subFolders: readonly string[] = getSubFolderPaths(graph.nodes, folderId)

    // After expand, these will be visible
    const visibleAfter: Set<string> = new Set(visibleNodeIds)
    for (const id of childIds) visibleAfter.add(id)
    for (const sf of subFolders) visibleAfter.add(sf)

    const childNodes: { readonly id: string; readonly node: GraphNode; readonly parentFolder: string | null }[] = []
    for (const nodeId of childIds) {
        childNodes.push({
            id: nodeId,
            node: graph.nodes[nodeId],
            parentFolder: getFolderParent(nodeId)
        })
    }

    const realEdges: { readonly id: string; readonly source: string; readonly target: string; readonly label?: string }[] = []
    const syntheticEdges: { readonly folderId: string; readonly direction: 'incoming' | 'outgoing'; readonly externalId: string; readonly original: OriginalEdgeRef }[] = []
    const seenEdgeIds: Set<string> = new Set()

    for (const nodeId of childIds) {
        const node: GraphNode = graph.nodes[nodeId]

        // Outgoing edges
        for (const edge of node.outgoingEdges) {
            const edgeId: string = `${nodeId}->${edge.targetId}`
            if (seenEdgeIds.has(edgeId)) continue
            seenEdgeIds.add(edgeId)

            if (!visibleAfter.has(edge.targetId)) {
                const targetFolder: string | null = findCollapsedAncestor(edge.targetId, collapsedFolders)
                if (targetFolder) {
                    syntheticEdges.push({
                        folderId: targetFolder,
                        direction: 'incoming',
                        externalId: nodeId,
                        original: { sourceId: nodeId, targetId: edge.targetId, label: edge.label || undefined }
                    })
                }
                continue
            }
            realEdges.push({
                id: edgeId,
                source: nodeId,
                target: edge.targetId,
                label: edge.label || undefined
            })
        }

        // Incoming edges
        for (const incomingId of (graph.incomingEdgesIndex.get(nodeId) ?? [])) {
            const edgeId: string = `${incomingId}->${nodeId}`
            if (seenEdgeIds.has(edgeId)) continue
            seenEdgeIds.add(edgeId)

            if (!visibleAfter.has(incomingId)) {
                const srcFolder: string | null = findCollapsedAncestor(incomingId, collapsedFolders)
                if (srcFolder) {
                    const srcNode: GraphNode | undefined = graph.nodes[incomingId]
                    const edgeData = srcNode?.outgoingEdges.find(e => e.targetId === nodeId)
                    syntheticEdges.push({
                        folderId: srcFolder,
                        direction: 'outgoing',
                        externalId: nodeId,
                        original: { sourceId: incomingId, targetId: nodeId, label: edgeData?.label || undefined }
                    })
                }
                continue
            }
            const srcNode: GraphNode | undefined = graph.nodes[incomingId]
            const edgeData = srcNode?.outgoingEdges.find(e => e.targetId === nodeId)
            realEdges.push({
                id: edgeId,
                source: incomingId,
                target: nodeId,
                label: edgeData?.label || undefined
            })
        }
    }

    return { subFolders, childNodes, realEdges, syntheticEdges }
}

/**
 * Walk up folder parents to find nearest collapsed ancestor. PURE.
 */
export function findCollapsedAncestor(
    nodeId: string,
    collapsedFolders: ReadonlySet<string>
): string | null {
    let folderPath: string | null = getFolderParent(nodeId)
    while (folderPath) {
        if (collapsedFolders.has(folderPath)) return folderPath
        folderPath = getFolderParent(folderPath.slice(0, -1))
    }
    return null
}

/**
 * Convert absolute FS path to graph folder ID. PURE.
 * Returns relative path with trailing slash, or null if path is the root or outside the tree.
 */
export function absolutePathToGraphFolderId(
    absolutePath: string,
    treeRootAbsolutePath: string
): string | null {
    if (!absolutePath.startsWith(treeRootAbsolutePath + '/')) return null
    const relative: string = absolutePath.slice(treeRootAbsolutePath.length + 1)
    return relative ? relative + '/' : null
}
