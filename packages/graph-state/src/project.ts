import path from 'path'

import * as O from 'fp-ts/lib/Option.js'

import { getFolderNotePath, type FolderTreeNode, type GraphNode } from '@vt/graph-model'

import type { EdgeElement, ElementSpec, FolderId, NodeElement, State } from './contract'

interface FolderProjectionInfo {
    readonly id: FolderId
    readonly parent?: FolderId
    readonly label: string
    readonly loadState: 'loaded' | 'not-loaded'
    readonly isWriteTarget: boolean
    readonly directChildCount: number
}

interface SyntheticEdgeGroup {
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

function sortStrings(values: readonly string[]): readonly string[] {
    return [...values].sort((left, right) => left.localeCompare(right))
}

function folderIdFromAbsolutePath(absolutePath: string): FolderId {
    return `${absolutePath.replace(/\/$/, '')}/`
}

function parentFolderIdForFolder(folderId: FolderId): FolderId | null {
    const normalized = folderId.slice(0, -1)
    const lastSlash = normalized.lastIndexOf('/')
    if (lastSlash <= 0) {
        return null
    }
    return `${normalized.slice(0, lastSlash)}/`
}

function parentFolderIdForNode(nodeId: string): FolderId | null {
    const lastSlash = nodeId.lastIndexOf('/')
    if (lastSlash <= 0) {
        return null
    }
    return `${nodeId.slice(0, lastSlash + 1)}`
}

function labelForFolder(folderId: FolderId): string {
    return path.posix.basename(folderId.slice(0, -1))
}

function labelForNode(nodeId: string): string {
    const baseName = path.posix.basename(nodeId)
    const extension = path.posix.extname(baseName)
    return extension.length > 0 ? baseName.slice(0, -extension.length) : baseName
}

function normalizeLabel(label: string): string | undefined {
    return label.length > 0 ? label : undefined
}

function isProjectableGraphNode(node: GraphNode | undefined): node is GraphNode {
    return node !== undefined
}

function countRecursiveProjectableFileDescendants(
    folder: FolderTreeNode,
    graphNodes: Readonly<Record<string, GraphNode>>,
): number {
    let count = 0

    for (const child of folder.children) {
        if ('children' in child) {
            count += countRecursiveProjectableFileDescendants(child, graphNodes)
            continue
        }

        if (child.isInGraph && isProjectableGraphNode(graphNodes[child.absolutePath])) {
            count += 1
        }
    }

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

function collectFolderProjectionInfo(
    folder: FolderTreeNode,
    graphNodes: Readonly<Record<string, GraphNode>>,
    parent: FolderId | undefined,
    out: FolderProjectionInfo[],
): void {
    if (countRecursiveProjectableFileDescendants(folder, graphNodes) === 0) {
        return
    }

    const folderId = folderIdFromAbsolutePath(folder.absolutePath)
    out.push({
        id: folderId,
        ...(parent ? { parent } : {}),
        label: labelForFolder(folderId),
        loadState: folder.loadState,
        isWriteTarget: folder.isWriteTarget,
        directChildCount: countDirectProjectableChildren(folder, graphNodes),
    })

    for (const child of folder.children) {
        if ('children' in child) {
            collectFolderProjectionInfo(child, graphNodes, folderId, out)
        }
    }
}

function collectFolders(
    state: State,
): readonly FolderProjectionInfo[] {
    const folders: FolderProjectionInfo[] = []
    for (const root of state.roots.folderTree) {
        for (const child of root.children) {
            if ('children' in child) {
                collectFolderProjectionInfo(child, state.graph.nodes, undefined, folders)
            }
        }
    }
    return folders
}

function hasCollapsedAncestor(
    folderId: FolderId,
    visibleCollapsedFolders: ReadonlySet<FolderId>,
): boolean {
    let parent = parentFolderIdForFolder(folderId)
    while (parent) {
        if (visibleCollapsedFolders.has(parent)) {
            return true
        }
        parent = parentFolderIdForFolder(parent)
    }
    return false
}

function selectVisibleCollapsedFolders(
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

function findVisibleCollapsedAncestorForNode(
    nodeId: string,
    visibleCollapsedFolders: ReadonlySet<FolderId>,
): FolderId | null {
    let currentFolder = parentFolderIdForNode(nodeId)
    while (currentFolder) {
        if (visibleCollapsedFolders.has(currentFolder)) {
            return currentFolder
        }
        currentFolder = parentFolderIdForFolder(currentFolder)
    }
    return null
}

function classesForNode(state: State, nodeId: string, node: GraphNode): readonly string[] | undefined {
    const classes = [
        ...(state.selection.has(nodeId) ? ['selected'] : []),
        ...(node.nodeUIMetadata.isContextNode === true ? ['context-node'] : []),
    ]

    return classes.length > 0 ? classes : undefined
}

function dataForNode(state: State, nodeId: string, node: GraphNode): Readonly<Record<string, unknown>> {
    const additionalYAMLProps = [...node.nodeUIMetadata.additionalYAMLProps.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
    const selected = state.selection.has(nodeId)

    return {
        content: node.contentWithoutYamlOrLinks,
        summary: '',
        ...(additionalYAMLProps.length > 0 ? { additionalYAMLProps } : {}),
        ...(O.isSome(node.nodeUIMetadata.color) ? { color: node.nodeUIMetadata.color.value } : {}),
        ...(node.nodeUIMetadata.containedNodeIds
            ? { containedNodeIds: sortStrings(node.nodeUIMetadata.containedNodeIds) }
            : {}),
        ...(node.nodeUIMetadata.isContextNode === true ? { isContextNode: true } : {}),
        ...(selected ? { selected: true } : {}),
    }
}

function dataForFolder(
    info: FolderProjectionInfo,
    collapsed: boolean,
    graph: State['graph'],
): Readonly<Record<string, unknown>> {
    const folderNoteId = getFolderNotePath(graph, info.id)
    const content = folderNoteId
        ? graph.nodes[folderNoteId]?.contentWithoutYamlOrLinks ?? ''
        : ''

    return {
        isFolderNode: true,
        folderLabel: info.label,
        loadState: info.loadState,
        isWriteTarget: info.isWriteTarget,
        content,
        ...(collapsed ? { collapsed: true, childCount: info.directChildCount } : {}),
    }
}

function compareEdgeElements(left: EdgeElement, right: EdgeElement): number {
    return left.source.localeCompare(right.source)
        || left.target.localeCompare(right.target)
        || (left.label ?? '').localeCompare(right.label ?? '')
        || left.id.localeCompare(right.id)
}

export function project(state: State): ElementSpec {
    const folderInfos = collectFolders(state)
    const knownFolders = new Set(folderInfos.map((info) => info.id))
    const visibleCollapsedFolders = selectVisibleCollapsedFolders(state.collapseSet, knownFolders)

    const visibleFolders = folderInfos
        .filter((info) => !hasCollapsedAncestor(info.id, visibleCollapsedFolders))
        .sort((left, right) => left.id.localeCompare(right.id))

    const visibleFolderIds = new Set(visibleFolders.map((info) => info.id))

    const nodeEntries: Array<readonly [string, GraphNode]> = Object.entries<GraphNode>(state.graph.nodes)
        .map(([nodeId, node]) => [nodeId, node] as const)
        .sort(([left], [right]) => left.localeCompare(right))
        .filter(([, node]) => isProjectableGraphNode(node))

    const visibleEndpointByNodeId = new Map<string, string>()
    for (const [nodeId] of nodeEntries) {
        visibleEndpointByNodeId.set(
            nodeId,
            findVisibleCollapsedAncestorForNode(nodeId, visibleCollapsedFolders) ?? nodeId,
        )
    }

    const nodes: NodeElement[] = []

    for (const info of visibleFolders) {
        const collapsed = visibleCollapsedFolders.has(info.id)
        nodes.push({
            id: info.id,
            ...(info.parent && visibleFolderIds.has(info.parent) ? { parent: info.parent } : {}),
            label: info.label,
            data: dataForFolder(info, collapsed, state.graph),
            kind: collapsed ? 'folder-collapsed' : 'folder',
        })
    }

    for (const [nodeId, node] of nodeEntries) {
        if (visibleEndpointByNodeId.get(nodeId) !== nodeId) {
            continue
        }

        const parentFolder = parentFolderIdForNode(nodeId)
        const classes = classesForNode(state, nodeId, node)
        nodes.push({
            id: nodeId,
            ...(parentFolder && visibleFolderIds.has(parentFolder) ? { parent: parentFolder } : {}),
            label: labelForNode(nodeId),
            data: dataForNode(state, nodeId, node),
            ...(state.layout.positions.has(nodeId) ? { position: state.layout.positions.get(nodeId) } : {}),
            ...(classes ? { classes } : {}),
            kind: 'node',
        })
    }

    nodes.sort((left, right) => left.id.localeCompare(right.id))

    const realEdges: EdgeElement[] = []
    const syntheticGroups = new Map<string, SyntheticEdgeGroup>()
    const seenRealEdgeIds = new Set<string>()

    for (const [sourceId, sourceNode] of nodeEntries) {
        const sourceEndpoint = visibleEndpointByNodeId.get(sourceId)
        if (!sourceEndpoint) {
            continue
        }

        const outgoingEdges = [...sourceNode.outgoingEdges]
            .sort((left, right) => left.targetId.localeCompare(right.targetId) || left.label.localeCompare(right.label))

        for (const edge of outgoingEdges) {
            const targetNode = state.graph.nodes[edge.targetId]
            if (!isProjectableGraphNode(targetNode)) {
                continue
            }

            const targetEndpoint = visibleEndpointByNodeId.get(edge.targetId)
            if (!targetEndpoint) {
                continue
            }

            if (sourceEndpoint === sourceId && targetEndpoint === edge.targetId) {
                const id = `${sourceId}->${edge.targetId}`
                if (seenRealEdgeIds.has(id)) {
                    continue
                }
                seenRealEdgeIds.add(id)
                realEdges.push({
                    id,
                    source: sourceId,
                    target: edge.targetId,
                    ...(normalizeLabel(edge.label) ? { label: normalizeLabel(edge.label) } : {}),
                    data: {},
                    kind: 'real',
                })
                continue
            }

            if (sourceEndpoint === targetEndpoint) {
                continue
            }

            const sourceHidden = sourceEndpoint !== sourceId
            const anchorFolderId = (sourceHidden ? sourceEndpoint : targetEndpoint) as FolderId
            const direction = sourceHidden ? 'outgoing' as const : 'incoming' as const
            const externalId = sourceHidden ? targetEndpoint : sourceEndpoint
            if (anchorFolderId === externalId) {
                continue
            }

            const syntheticEdgeId = `synthetic:${anchorFolderId}:${direction === 'incoming' ? 'in' : 'out'}:${externalId}`
            const existing = syntheticGroups.get(syntheticEdgeId)
            const originalEdge = {
                sourceId,
                targetId: edge.targetId,
                ...(normalizeLabel(edge.label) ? { label: normalizeLabel(edge.label) } : {}),
            }

            if (existing) {
                existing.originalEdges.push(originalEdge)
                continue
            }

            syntheticGroups.set(syntheticEdgeId, {
                id: syntheticEdgeId,
                folderId: anchorFolderId,
                direction,
                externalId,
                originalEdges: [originalEdge],
            })
        }
    }

    const syntheticEdges: EdgeElement[] = [...syntheticGroups.values()].map((group) => {
        const label = group.originalEdges.length === 1 ? group.originalEdges[0].label : undefined
        return {
            id: group.id,
            source: group.direction === 'incoming' ? group.externalId : group.folderId,
            target: group.direction === 'incoming' ? group.folderId : group.externalId,
            ...(label ? { label } : {}),
            data: {
                isSyntheticEdge: true,
                ...(group.originalEdges.length > 1 ? { edgeCount: group.originalEdges.length } : {}),
            },
            classes: ['synthetic-folder-edge'],
            kind: 'synthetic',
        }
    })

    const edges = [...realEdges, ...syntheticEdges].sort(compareEdgeElements)

    return {
        nodes,
        edges,
        revision: state.meta.revision,
    }
}
