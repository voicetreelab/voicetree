import path from 'path'

export type ContainmentTree = {
    parentOf: Map<string, string | null>
    childrenOf: Map<string, string[]>
}

const PARENT_EDGE_REGEX: RegExp = /^- parent \[\[([^\]]+)\]\]/m

function extractExplicitParent(content: string): string | undefined {
    const match: RegExpMatchArray | null = content.match(PARENT_EDGE_REGEX)
    if (!match?.[1]) {
        return undefined
    }
    const rawTarget: string = match[1].split('|')[0]?.split('#')[0]?.trim() ?? ''
    return rawTarget || undefined
}

export function buildFolderIndexMap(nodeIds: string[]): Map<string, string> {
    const nodeIdSet: Set<string> = new Set(nodeIds)
    const folderIndexMap: Map<string, string> = new Map()

    for (const nodeId of nodeIds) {
        const dir: string = path.posix.dirname(nodeId)
        if (dir === '.') {
            const possibleChildren: string[] = nodeIds.filter(
                id => path.posix.dirname(id) === nodeId.split('/')[0] && id !== nodeId
            )
            if (possibleChildren.length > 0 && nodeIdSet.has(nodeId)) {
                folderIndexMap.set(nodeId.split('/')[0], nodeId)
            }
        }
    }

    for (const nodeId of nodeIds) {
        const parts: string[] = nodeId.split('/')
        if (parts.length >= 2) {
            const folderName: string = parts[0]
            if (!folderIndexMap.has(folderName) && nodeIdSet.has(folderName)) {
                folderIndexMap.set(folderName, folderName)
            }
            for (let i = 1; i < parts.length; i++) {
                const parentPath: string = parts.slice(0, i).join('/')
                if (!folderIndexMap.has(parentPath) && nodeIdSet.has(parentPath)) {
                    folderIndexMap.set(parentPath, parentPath)
                }
            }
        }
    }

    return folderIndexMap
}

export function buildContainmentTree(
    nodeIds: string[],
    nodeContents: Map<string, string>,
    folderIndexMap: Map<string, string>
): ContainmentTree {
    const parentOf: Map<string, string | null> = new Map()
    const childrenOf: Map<string, string[]> = new Map()
    const nodeIdSet: Set<string> = new Set(nodeIds)

    for (const nodeId of nodeIds) {
        parentOf.set(nodeId, null)
        childrenOf.set(nodeId, [])
    }

    // Pass 1: explicit parent edges
    for (const nodeId of nodeIds) {
        const content: string = nodeContents.get(nodeId) ?? ''
        const rawParent: string | undefined = extractExplicitParent(content)
        if (rawParent) {
            const normalized: string = rawParent.replace(/\\/g, '/').replace(/\.md$/i, '')
            const currentDir: string = path.posix.dirname(nodeId)
            const candidates: string[] = [
                path.posix.normalize(normalized),
                path.posix.normalize(path.posix.join(currentDir, normalized)),
            ]
            let resolvedParent: string | undefined
            for (const candidate of candidates) {
                if (nodeIdSet.has(candidate)) {
                    resolvedParent = candidate
                    break
                }
            }
            if (!resolvedParent && !normalized.includes('/')) {
                for (const candidate of nodeIds) {
                    if (path.posix.basename(candidate) === normalized) {
                        resolvedParent = candidate
                        break
                    }
                }
            }
            if (resolvedParent) {
                parentOf.set(nodeId, resolvedParent)
            }
        }
    }

    // Pass 2: folder hierarchy for nodes without explicit parent
    for (const nodeId of nodeIds) {
        if (parentOf.get(nodeId) !== null) {
            continue
        }
        const parts: string[] = nodeId.split('/')
        if (parts.length >= 2) {
            const folderPath: string = parts.slice(0, parts.length - 1).join('/')
            const indexNodeId: string | undefined = folderIndexMap.get(folderPath)
            if (indexNodeId && indexNodeId !== nodeId && nodeIdSet.has(indexNodeId)) {
                parentOf.set(nodeId, indexNodeId)
            }
        }
    }

    // Build childrenOf from parentOf
    for (const [nodeId, parent] of parentOf.entries()) {
        if (parent !== null) {
            const children: string[] = childrenOf.get(parent) ?? []
            children.push(nodeId)
            childrenOf.set(parent, children)
        }
    }

    return { parentOf, childrenOf }
}
