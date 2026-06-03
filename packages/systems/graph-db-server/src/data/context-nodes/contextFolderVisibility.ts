import type { Graph, GraphNode, NodeIdAndFilePath } from '@vt/graph-model/graph'
import type { FolderStateEntry } from '@vt/graph-db-server/views/folderVisibilityResource'
import {
    isFolderVisibilityOpen,
    readCurrentFolderState,
} from '@vt/graph-db-server/views/folderVisibilityResource'

function folderId(path: string): string {
    const trimmed: string = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
    return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

function folderParent(nodeId: string): string | null {
    const normalizedNodeId: string = folderId(nodeId)
    const withoutTrailingSlash: string = normalizedNodeId.slice(0, -1)
    const lastSlashIndex: number = withoutTrailingSlash.lastIndexOf('/')
    if (lastSlashIndex < 0) return null

    return `${withoutTrailingSlash.slice(0, lastSlashIndex)}/`
}

function folderIdentityNoteId(folderPath: string): NodeIdAndFilePath {
    const normalizedFolderPath: string = folderId(folderPath)
    return `${normalizedFolderPath}${normalizedFolderPath.slice(0, -1).split('/').at(-1)}.md`
}

function collapsedFolderAncestor(
    nodeId: string,
    collapsedFolderIds: ReadonlySet<string>,
): string | null {
    let currentFolder: string | null = folderParent(nodeId)
    while (currentFolder !== null) {
        if (collapsedFolderIds.has(currentFolder)) return currentFolder
        currentFolder = folderParent(currentFolder)
    }

    return null
}

function isCollapsedFolderRepresentative(
    nodeId: NodeIdAndFilePath,
    collapsedFolderId: string,
): boolean {
    return nodeId === folderIdentityNoteId(collapsedFolderId)
}

function isVisibleInCollapsedContext(
    nodeId: NodeIdAndFilePath,
    collapsedFolderIds: ReadonlySet<string>,
): boolean {
    const collapsedAncestor: string | null = collapsedFolderAncestor(nodeId, collapsedFolderIds)
    return collapsedAncestor === null || isCollapsedFolderRepresentative(nodeId, collapsedAncestor)
}

export function collapsedFolderIdsFromFolderState(
    folderState: readonly FolderStateEntry[],
): ReadonlySet<string> {
    return new Set(
        folderState
            .filter(([, state]) => state === 'collapsed')
            .map(([path]) => folderId(path)),
    )
}

export function readCollapsedFolderIdsForContext(): ReadonlySet<string> {
    if (!isFolderVisibilityOpen()) return new Set()
    return collapsedFolderIdsFromFolderState(readCurrentFolderState().folderState)
}

export function graphVisibleForContext(
    graph: Graph,
    collapsedFolderIds: ReadonlySet<string>,
): Graph {
    if (collapsedFolderIds.size === 0) return graph

    const visibleNodes: Record<NodeIdAndFilePath, GraphNode> = Object.fromEntries(
        Object.entries(graph.nodes)
            .filter(([nodeId]) => isVisibleInCollapsedContext(nodeId as NodeIdAndFilePath, collapsedFolderIds))
            .map(([nodeId, node]) => [
                nodeId,
                {
                    ...node,
                    outgoingEdges: node.outgoingEdges.filter((edge) =>
                        isVisibleInCollapsedContext(edge.targetId, collapsedFolderIds),
                    ),
                },
            ]),
    ) as Record<NodeIdAndFilePath, GraphNode>

    const visibleNodeIds: ReadonlySet<string> = new Set(Object.keys(visibleNodes))
    const incomingEdgesIndex: Map<string, readonly string[]> = new Map(
        [...graph.incomingEdgesIndex]
            .filter(([nodeId]) => visibleNodeIds.has(nodeId))
            .map(([nodeId, incomingIds]) => [
                nodeId,
                incomingIds.filter((incomingId) => visibleNodeIds.has(incomingId)),
            ]),
    )

    return {
        ...graph,
        nodes: visibleNodes,
        incomingEdgesIndex,
    }
}
