import type { NodeIdAndFilePath, GraphNode } from './'

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
