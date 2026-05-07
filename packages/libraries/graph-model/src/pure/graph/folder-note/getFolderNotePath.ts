import type { Graph, NodeIdAndFilePath } from '..'

function normalizeFolderId(folderId: string): string {
    return folderId.endsWith('/') ? folderId : `${folderId}/`
}

export function getFolderNotePath(
    graph: Graph,
    folderId: string
): NodeIdAndFilePath | undefined {
    const normalizedFolderId: string = normalizeFolderId(folderId)
    const indexPath: NodeIdAndFilePath = `${normalizedFolderId}index.md`

    if (graph.nodes[indexPath] !== undefined) {
        return indexPath
    }

    const basename: string | undefined = normalizedFolderId
        .replace(/\/$/, '')
        .split('/')
        .pop()

    if (basename === undefined || basename.length === 0) {
        return undefined
    }

    const basenamePath: NodeIdAndFilePath = `${normalizedFolderId}${basename}.md`
    return graph.nodes[basenamePath] !== undefined ? basenamePath : undefined
}
