/**
 * Pure collapse/edge-aggregation primitives shared between graph-tools and graph-model.
 * Lives here (graph-tools) because graph-model depends on graph-tools, not vice versa.
 */

import type {ContainmentTree} from './lintContainment'

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

export interface CollapsedInfo {
    readonly descendantCount: number
    readonly externalOutgoingCount: number
    readonly externalTargets: readonly string[]
}

export interface NodeWithOutgoingIds {
    readonly outgoingIds: readonly string[]
}

export const VIRTUAL_FOLDER_PREFIX = '__virtual_folder__/'

export function isVirtualFolder(id: string): boolean {
    return id.startsWith(VIRTUAL_FOLDER_PREFIX)
}

/**
 * Compute synthetic edge specs from pre-extracted cy data. PURE.
 * Groups cross-boundary edges by direction + external node, generates stable IDs.
 * Deduplicates by (direction, external endpoint) per F6 design law decision 3.
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

function folderPathToEntityId(folderPath: string, folderIndexMap: ReadonlyMap<string, string>): string {
    const normalized: string = folderPath.replace(/\/$/, '')
    return folderIndexMap.get(normalized) ?? `${VIRTUAL_FOLDER_PREFIX}${normalized}`
}

export function collectDescendants(entityId: string, containment: ContainmentTree): Set<string> {
    const result = new Set<string>()
    const queue: string[] = containment.childrenOf.get(entityId)?.slice() ?? []
    while (queue.length > 0) {
        const id: string = queue.pop()!
        result.add(id)
        const children: string[] | undefined = containment.childrenOf.get(id)
        if (children) {
            queue.push(...children)
        }
    }
    return result
}

export function collectCollapsedDescendants(
    collapsedMap: ReadonlyMap<string, CollapsedInfo>,
    containment: ContainmentTree,
): Set<string> {
    const descendants = new Set<string>()
    for (const entityId of collapsedMap.keys()) {
        for (const id of collectDescendants(entityId, containment)) {
            descendants.add(id)
        }
    }
    return descendants
}

function computeCollapsedInfo(
    entityId: string,
    descendants: ReadonlySet<string>,
    nodeById: ReadonlyMap<string, NodeWithOutgoingIds>,
): CollapsedInfo {
    const allInSubtree = new Set([entityId, ...descendants])
    const connectedEdges: {sourceId: string; targetId: string}[] = []

    for (const id of allInSubtree) {
        if (isVirtualFolder(id)) continue
        const node: NodeWithOutgoingIds | undefined = nodeById.get(id)
        if (!node) continue
        for (const target of node.outgoingIds) {
            connectedEdges.push({sourceId: id, targetId: target})
        }
    }

    const specs: readonly SyntheticEdgeSpec[] = computeSyntheticEdgeSpecs(entityId, descendants, connectedEdges)
    const outgoingSpecs: readonly SyntheticEdgeSpec[] = specs.filter(spec => spec.direction === 'outgoing')
    const externalTargets: string[] = outgoingSpecs.map(spec => spec.externalNodeId)

    return {
        descendantCount: descendants.size,
        externalOutgoingCount: externalTargets.length,
        externalTargets,
    }
}

export function buildCollapsedMap(
    collapsedFolders: readonly string[],
    folderIndexMap: ReadonlyMap<string, string>,
    containment: ContainmentTree,
    nodeById: ReadonlyMap<string, NodeWithOutgoingIds>,
): ReadonlyMap<string, CollapsedInfo> {
    const result = new Map<string, CollapsedInfo>()
    for (const folderPath of collapsedFolders) {
        const entityId: string = folderPathToEntityId(folderPath, folderIndexMap)
        if (!containment.parentOf.has(entityId)) continue
        result.set(entityId, computeCollapsedInfo(entityId, collectDescendants(entityId, containment), nodeById))
    }
    return result
}
