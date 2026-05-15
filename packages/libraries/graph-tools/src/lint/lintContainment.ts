import path from 'path'

export type ContainmentTree = {
    parentOf: Map<string, string | null>
    childrenOf: Map<string, string[]>
}

const PARENT_EDGE_REGEX: RegExp = /^- parent \[\[([^\]]+)\]\]/m
const VIRTUAL_FOLDER_PREFIX = '__virtual_folder__/'

function extractExplicitParent(content: string): string | undefined {
    const match: RegExpMatchArray | null = content.match(PARENT_EDGE_REGEX)
    if (!match?.[1]) {
        return undefined
    }
    const rawTarget: string = match[1].split('|')[0]?.split('#')[0]?.trim() ?? ''
    return rawTarget || undefined
}

function isCanonicalFolderNote(nodeId: string): boolean {
    const dir: string = path.posix.dirname(nodeId)
    return dir !== '.' && path.posix.basename(nodeId) === path.posix.basename(dir)
}

function collectFolderPaths(nodeIds: readonly string[]): string[] {
    const folderPaths: Set<string> = new Set()

    for (const nodeId of nodeIds) {
        let current: string = path.posix.dirname(nodeId)
        while (current !== '.') {
            folderPaths.add(current)
            current = path.posix.dirname(current)
        }
    }

    return [...folderPaths].sort((left, right) => left.localeCompare(right))
}

function createVirtualFolderId(folderPath: string): string {
    return `${VIRTUAL_FOLDER_PREFIX}${folderPath}`
}

function getFolderEntityId(folderPath: string, folderIndexMap: ReadonlyMap<string, string>): string {
    return folderIndexMap.get(folderPath) ?? createVirtualFolderId(folderPath)
}

function getParentFolderPath(folderPath: string): string | undefined {
    const parentFolderPath: string = path.posix.dirname(folderPath)
    return parentFolderPath === '.' ? undefined : parentFolderPath
}

function resolveExplicitParent(
    nodeId: string,
    nodeIds: readonly string[],
    nodeIdSet: ReadonlySet<string>,
    nodeContents: ReadonlyMap<string, string>
): string | undefined {
    const content: string = nodeContents.get(nodeId) ?? ''
    const rawParent: string | undefined = extractExplicitParent(content)
    if (!rawParent) {
        return undefined
    }

    const normalized: string = rawParent.replace(/\\/g, '/').replace(/\.md$/i, '')
    const currentDir: string = path.posix.dirname(nodeId)
    const candidates: string[] = [
        path.posix.normalize(normalized),
        path.posix.normalize(path.posix.join(currentDir, normalized)),
    ]

    for (const candidate of candidates) {
        if (nodeIdSet.has(candidate)) {
            return candidate
        }
    }

    if (!normalized.includes('/')) {
        for (const candidate of nodeIds) {
            if (path.posix.basename(candidate) === normalized) {
                return candidate
            }
        }
    }

    return undefined
}

export function buildFolderIndexMap(nodeIds: string[]): Map<string, string> {
    const folderIndexMap: Map<string, string> = new Map()

    for (const nodeId of nodeIds) {
        if (isCanonicalFolderNote(nodeId)) {
            folderIndexMap.set(path.posix.dirname(nodeId), nodeId)
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
    const folderPaths: string[] = collectFolderPaths(nodeIds)

    for (const nodeId of nodeIds) {
        parentOf.set(nodeId, null)
        childrenOf.set(nodeId, [])
    }

    for (const folderPath of folderPaths) {
        const folderEntityId: string = getFolderEntityId(folderPath, folderIndexMap)
        if (!parentOf.has(folderEntityId)) {
            parentOf.set(folderEntityId, null)
        }
        if (!childrenOf.has(folderEntityId)) {
            childrenOf.set(folderEntityId, [])
        }
    }

    for (const folderPath of folderPaths) {
        const folderEntityId: string = getFolderEntityId(folderPath, folderIndexMap)
        const parentFolderPath: string | undefined = getParentFolderPath(folderPath)
        if (parentFolderPath) {
            parentOf.set(folderEntityId, getFolderEntityId(parentFolderPath, folderIndexMap))
        }
    }

    for (const nodeId of nodeIds) {
        const resolvedExplicitParent: string | undefined = resolveExplicitParent(
            nodeId,
            nodeIds,
            nodeIdSet,
            nodeContents
        )
        const folderPath: string = path.posix.dirname(nodeId)

        if (folderPath === '.') {
            if (resolvedExplicitParent) {
                parentOf.set(nodeId, resolvedExplicitParent)
            }
            continue
        }

        const isFolderIdentityNode: boolean = folderIndexMap.get(folderPath) === nodeId
        if (isFolderIdentityNode) {
            const parentFolderPath: string | undefined = getParentFolderPath(folderPath)
            if (parentFolderPath) {
                parentOf.set(nodeId, getFolderEntityId(parentFolderPath, folderIndexMap))
            } else if (resolvedExplicitParent) {
                parentOf.set(nodeId, resolvedExplicitParent)
            }
            continue
        }

        parentOf.set(nodeId, getFolderEntityId(folderPath, folderIndexMap))
    }

    for (const [nodeId, parent] of parentOf.entries()) {
        if (parent === null) {
            continue
        }
        const children: string[] = childrenOf.get(parent) ?? []
        children.push(nodeId)
        childrenOf.set(parent, children)
    }

    for (const [parentId, children] of childrenOf.entries()) {
        childrenOf.set(parentId, [...children].sort((left, right) => left.localeCompare(right)))
    }

    return { parentOf, childrenOf }
}
