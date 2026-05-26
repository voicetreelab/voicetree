import type {ContainmentTree} from '../lint/lintContainment'

export interface CollapsedInfo {
    readonly descendantCount: number
    readonly externalOutgoingCount: number
    readonly externalTargets: readonly string[]
}

export interface NodeWithOutgoingIds {
    readonly outgoingIds: readonly string[]
}

type DirectedEdge = {
    readonly sourceId: string
    readonly targetId: string
}

export const VIRTUAL_FOLDER_PREFIX = '__virtual_folder__/'

export function isVirtualFolder(id: string): boolean {
    return id.startsWith(VIRTUAL_FOLDER_PREFIX)
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
    const connectedEdges: DirectedEdge[] = []

    for (const id of allInSubtree) {
        if (isVirtualFolder(id)) continue
        const node: NodeWithOutgoingIds | undefined = nodeById.get(id)
        if (!node) continue
        for (const target of node.outgoingIds) {
            connectedEdges.push({sourceId: id, targetId: target})
        }
    }

    const externalTargets: string[] = collectExternalOutgoingTargets(entityId, descendants, connectedEdges)

    return {
        descendantCount: descendants.size,
        externalOutgoingCount: externalTargets.length,
        externalTargets,
    }
}

function collectExternalOutgoingTargets(
    folderId: string,
    descendants: ReadonlySet<string>,
    edges: readonly DirectedEdge[],
): string[] {
    const inside = new Set([folderId, ...descendants])
    const externalTargets = new Set<string>()

    for (const edge of edges) {
        if (!inside.has(edge.sourceId)) continue
        if (inside.has(edge.targetId)) continue
        externalTargets.add(edge.targetId)
    }

    return [...externalTargets].sort()
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
