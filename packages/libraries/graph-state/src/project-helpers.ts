import type { Edge, FolderTreeNode, GraphNode } from '@vt/graph-model'

import type { FolderId, ProjectedEdge } from './contract'

export interface FolderProjectionInfo {
    readonly id: FolderId
    readonly parent?: FolderId
    readonly label: string
    readonly loadState: 'loaded' | 'not-loaded'
    readonly isWriteTarget: boolean
    readonly directChildCount: number
}

export interface SyntheticEdgeGroup {
    readonly id: string
    readonly folderId: FolderId
    readonly direction: 'incoming' | 'outgoing'
    readonly externalId: string
    readonly originalEdges: Array<{
        readonly sourceId: string
        readonly targetId: string
        readonly label?: string
    }>
}

export interface CollapseFilterResult {
    readonly visibleFolders: readonly FolderProjectionInfo[]
    readonly visibleFolderIds: ReadonlySet<FolderId>
    readonly visibleCollapsedFolders: ReadonlySet<FolderId>
    readonly nodeEntries: readonly (readonly [string, GraphNode])[]
    readonly visibleEndpointByNodeId: ReadonlyMap<string, string>
}

export function sortStrings(values: readonly string[]): readonly string[] {
    return [...values].sort((left, right) => left.localeCompare(right))
}

/** Canonical sort order for outgoing edges: targetId first, then label. */
export function compareEdges(a: Edge, b: Edge): number {
    return a.targetId.localeCompare(b.targetId) || a.label.localeCompare(b.label)
}

export function folderIdFromAbsolutePath(absolutePath: string): FolderId {
    return `${absolutePath.replace(/\/$/, '')}/`
}

export function parentFolderIdForFolder(folderId: FolderId): FolderId | null {
    const normalized = folderId.slice(0, -1)
    const lastSlash = normalized.lastIndexOf('/')
    if (lastSlash <= 0) return null
    return `${normalized.slice(0, lastSlash)}/`
}

export function parentFolderIdForNode(nodeId: string): FolderId | null {
    const lastSlash = nodeId.lastIndexOf('/')
    if (lastSlash <= 0) return null
    return `${nodeId.slice(0, lastSlash + 1)}`
}

export function posixBaseName(filePath: string): string {
    const lastSlash = filePath.lastIndexOf('/')
    return lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath
}

function posixExtName(filePath: string): string {
    const baseName = posixBaseName(filePath)
    const lastDot = baseName.lastIndexOf('.')
    if (lastDot <= 0) return ''
    return baseName.slice(lastDot)
}

export function labelForFolder(folderId: FolderId): string {
    return posixBaseName(folderId.slice(0, -1))
}

export function labelForNode(nodeId: string): string {
    const baseName = posixBaseName(nodeId)
    const extension = posixExtName(baseName)
    return extension.length > 0 ? baseName.slice(0, -extension.length) : baseName
}

export function normalizeLabel(label: string): string | undefined {
    return label.length > 0 ? label : undefined
}

export function isProjectableGraphNode(node: GraphNode | undefined): node is GraphNode {
    return node !== undefined
}

type GraphNodesRecord = Readonly<Record<string, GraphNode>>

const recursiveCountCache = new WeakMap<FolderTreeNode, WeakMap<GraphNodesRecord, number>>()

function countRecursiveProjectableFileDescendants(
    folder: FolderTreeNode,
    graphNodes: GraphNodesRecord,
): number {
    let inner = recursiveCountCache.get(folder)
    if (inner === undefined) {
        inner = new WeakMap()
        recursiveCountCache.set(folder, inner)
    }
    const cached = inner.get(graphNodes)
    if (cached !== undefined) return cached

    let count = 0
    for (const child of folder.children) {
        if ('children' in child) {
            count += countRecursiveProjectableFileDescendants(child, graphNodes)
        } else if (child.isInGraph && isProjectableGraphNode(graphNodes[child.absolutePath])) {
            count += 1
        }
    }

    inner.set(graphNodes, count)
    return count
}

function countDirectProjectableChildren(
    folder: FolderTreeNode,
    graphNodes: Readonly<Record<string, GraphNode>>,
): number {
    return folder.children.filter((child) => {
        if ('children' in child) {
            return countRecursiveProjectableFileDescendants(child, graphNodes) > 0
        }
        return child.isInGraph && isProjectableGraphNode(graphNodes[child.absolutePath])
    }).length
}

const folderInfoCache = new WeakMap<FolderTreeNode, WeakMap<GraphNodesRecord, readonly FolderProjectionInfo[]>>()

export function collectFolderProjectionInfo(
    folder: FolderTreeNode,
    graphNodes: GraphNodesRecord,
    parent: FolderId | undefined,
    out: FolderProjectionInfo[],
): void {
    let inner = folderInfoCache.get(folder)
    if (inner !== undefined) {
        const cached = inner.get(graphNodes)
        if (cached !== undefined) {
            for (const item of cached) out.push(item)
            return
        }
    }

    const localOut: FolderProjectionInfo[] = []

    if (countRecursiveProjectableFileDescendants(folder, graphNodes) === 0) {
        if (inner === undefined) {
            inner = new WeakMap()
            folderInfoCache.set(folder, inner)
        }
        inner.set(graphNodes, localOut)
        return
    }

    const folderId = folderIdFromAbsolutePath(folder.absolutePath)
    localOut.push({
        id: folderId,
        ...(parent ? { parent } : {}),
        label: labelForFolder(folderId),
        loadState: folder.loadState,
        isWriteTarget: folder.isWriteTarget,
        directChildCount: countDirectProjectableChildren(folder, graphNodes),
    })

    for (const child of folder.children) {
        if ('children' in child) {
            collectFolderProjectionInfo(child, graphNodes, folderId, localOut)
        }
    }

    if (inner === undefined) {
        inner = new WeakMap()
        folderInfoCache.set(folder, inner)
    }
    inner.set(graphNodes, localOut)

    for (const item of localOut) out.push(item)
}

export function hasCollapsedAncestor(
    folderId: FolderId,
    visibleCollapsedFolders: ReadonlySet<FolderId>,
): boolean {
    let parent = parentFolderIdForFolder(folderId)
    while (parent) {
        if (visibleCollapsedFolders.has(parent)) return true
        parent = parentFolderIdForFolder(parent)
    }
    return false
}

export function selectVisibleCollapsedFolders(
    collapseSet: ReadonlySet<FolderId>,
    knownFolders: ReadonlySet<FolderId>,
): ReadonlySet<FolderId> {
    const visibleCollapsedFolders = new Set<FolderId>()
    const sortedFolders = [...collapseSet]
        .filter((folderId): folderId is FolderId => knownFolders.has(folderId))
        .sort((left, right) => left.length - right.length || left.localeCompare(right))

    for (const folderId of sortedFolders) {
        if (!hasCollapsedAncestor(folderId, visibleCollapsedFolders)) {
            visibleCollapsedFolders.add(folderId)
        }
    }
    return visibleCollapsedFolders
}

export function findVisibleCollapsedAncestorForNode(
    nodeId: string,
    visibleCollapsedFolders: ReadonlySet<FolderId>,
): FolderId | null {
    let currentFolder = parentFolderIdForNode(nodeId)
    while (currentFolder) {
        if (visibleCollapsedFolders.has(currentFolder)) return currentFolder
        currentFolder = parentFolderIdForFolder(currentFolder)
    }
    return null
}

export function relPathFromRoot(id: string, rootPath: string): string {
    if (id.startsWith(rootPath)) {
        const rel = id.slice(rootPath.length)
        return rel.startsWith('/') ? rel.slice(1) : rel
    }
    return id
}

export function compareProjectedEdges(left: ProjectedEdge, right: ProjectedEdge): number {
    return left.source.localeCompare(right.source)
        || left.target.localeCompare(right.target)
        || (left.label ?? '').localeCompare(right.label ?? '')
        || left.id.localeCompare(right.id)
}

export class UnionFind {
    private readonly parent = new Map<string, string>()
    private readonly rank = new Map<string, number>()

    find(x: string): string {
        if (!this.parent.has(x)) { this.parent.set(x, x); this.rank.set(x, 0) }
        let root = x
        while (this.parent.get(root)! !== root) root = this.parent.get(root)!
        let c = x
        while (this.parent.get(c)! !== c) { const n = this.parent.get(c)!; this.parent.set(c, root); c = n }
        return root
    }

    union(a: string, b: string): boolean {
        const ra = this.find(a), rb = this.find(b)
        if (ra === rb) return false
        const rka = this.rank.get(ra)!, rkb = this.rank.get(rb)!
        if (rka < rkb) this.parent.set(ra, rb)
        else if (rka > rkb) this.parent.set(rb, ra)
        else { this.parent.set(rb, ra); this.rank.set(ra, rka + 1) }
        return true
    }
}
