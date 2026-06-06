import type { Core } from 'cytoscape'

function basename(path: string): string {
    const normalized = path.endsWith('/') ? path.slice(0, -1) : path
    const lastSlash: number = normalized.lastIndexOf('/')
    return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized
}

function folderIdForFolderNotePath(nodeId: string): string | null {
    if (!nodeId.endsWith('.md')) return null

    const lastSlash: number = nodeId.lastIndexOf('/')
    if (lastSlash <= 0) return null

    const parentFolderPath: string = nodeId.slice(0, lastSlash)
    const fileName: string = nodeId.slice(lastSlash + 1)
    if (fileName === 'index.md') return `${parentFolderPath}/`

    const fileBaseName: string = fileName.slice(0, -'.md'.length)
    return fileBaseName === basename(parentFolderPath) ? `${parentFolderPath}/` : null
}

export function resolveVisibleAnchorNodeId(cy: Core, anchoredNodeId: string): string {
    if (cy.getElementById(anchoredNodeId).length > 0) return anchoredNodeId

    const folderId: string | null = folderIdForFolderNotePath(anchoredNodeId)
    if (folderId && cy.getElementById(folderId).length > 0) return folderId

    return anchoredNodeId
}
