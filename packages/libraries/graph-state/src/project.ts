import * as O from 'fp-ts/lib/Option.js'

import { getFolderNotePath, type GraphNode } from '@vt/graph-model'
import { compareEdges } from './project-helpers'

import type { FolderId, ProjectedEdge, ProjectedGraph, ProjectedNode, State, TreeEdge } from './contract'
import {
    type CollapseFilterResult,
    type FolderProjectionInfo,
    type SyntheticEdgeGroup,
    UnionFind,
    collectFolderProjectionInfo,
    compareProjectedEdges,
    findVisibleCollapsedAncestorForNode,
    hasCollapsedAncestor,
    isProjectableGraphNode,
    labelForNode,
    normalizeLabel,
    parentFolderIdForNode,
    relPathFromRoot,
    selectVisibleCollapsedFolders,
    sortStrings,
} from './project-helpers'

// ── Pipeline Step 1: collectFolders ──────────────────────────────────────────

function collectFolders(state: State): readonly FolderProjectionInfo[] {
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

// ── Pipeline Step 2: filterByCollapse ────────────────────────────────────────

function filterByCollapse(
    folders: readonly FolderProjectionInfo[],
    collapseSet: ReadonlySet<FolderId>,
    graphNodes: Readonly<Record<string, GraphNode>>,
): CollapseFilterResult {
    const knownFolders = new Set(folders.map((info) => info.id))
    const visibleCollapsedFolders = selectVisibleCollapsedFolders(collapseSet, knownFolders)

    const visibleFolders = folders
        .filter((info) => !hasCollapsedAncestor(info.id, visibleCollapsedFolders))
        .sort((left, right) => left.id.localeCompare(right.id))

    const visibleFolderIds = new Set(visibleFolders.map((info) => info.id))

    // Object.entries already returns a fresh array, so sort it in place directly — the prior
    // identity .map (rewrapping each entry as a const tuple) allocated N tuples + an array per
    // projection purely to widen the static type, which the annotation already covers.
    const nodeEntries: Array<readonly [string, GraphNode]> = Object.entries<GraphNode>(graphNodes)
        .sort(([left], [right]) => left.localeCompare(right))
        .filter(([, node]) => isProjectableGraphNode(node))

    const visibleEndpointByNodeId = new Map<string, string>()
    for (const [nodeId] of nodeEntries) {
        visibleEndpointByNodeId.set(
            nodeId,
            findVisibleCollapsedAncestorForNode(nodeId, visibleCollapsedFolders) ?? nodeId,
        )
    }

    return { visibleFolders, visibleFolderIds, visibleCollapsedFolders, nodeEntries, visibleEndpointByNodeId }
}

// ── Pipeline Step 3: projectNodes ────────────────────────────────────────────

function normalizeProjectedContent(content: string): string {
    return content.replace(/\r\n?/g, '\n')
}

function projectNodes(
    visibleFolders: readonly FolderProjectionInfo[],
    visibleFolderIds: ReadonlySet<FolderId>,
    visibleCollapsedFolders: ReadonlySet<FolderId>,
    nodeEntries: readonly (readonly [string, GraphNode])[],
    visibleEndpointByNodeId: ReadonlyMap<string, string>,
    folderNoteOwnerById: ReadonlyMap<string, FolderId>,
    folderNoteIdByFolderId: ReadonlyMap<FolderId, string>,
    graph: State['graph'],
    positions: ReadonlyMap<string, unknown>,
    rootPath: string,
): readonly ProjectedNode[] {
    const nodes: ProjectedNode[] = []

    for (const info of visibleFolders) {
        const collapsed = visibleCollapsedFolders.has(info.id)
        const folderNoteId = folderNoteIdByFolderId.get(info.id)
        const content = folderNoteId
            ? graph.nodes[folderNoteId]?.contentWithoutYamlOrLinks ?? ''
            : ''

        nodes.push({
            id: info.id,
            kind: collapsed ? 'folder-collapsed' : 'folder',
            label: info.label,
            relPath: relPathFromRoot(info.id, rootPath),
            basename: info.label,
            folderPath: info.parent ?? '',
            ...(info.parent && visibleFolderIds.has(info.parent) ? { parent: info.parent } : {}),
            content: normalizeProjectedContent(content),
            loadState: info.loadState,
            isWriteTarget: info.isWriteTarget,
            ...(collapsed ? { childCount: info.directChildCount } : {}),
        })
    }

    for (const [nodeId, node] of nodeEntries) {
        if (folderNoteOwnerById.has(nodeId)) continue
        if (visibleEndpointByNodeId.get(nodeId) !== nodeId) continue

        const parentFolder = parentFolderIdForNode(nodeId)
        const position = positions.get(nodeId) as ProjectedNode['position']
        const classes: string[] = [
            ...(node.nodeUIMetadata.isContextNode === true ? ['context-node'] : []),
        ]
        const additionalYAMLProps = Object.entries(node.nodeUIMetadata.additionalYAMLProps)
            .sort(([left], [right]) => left.localeCompare(right)) as (readonly [string, string])[]

        nodes.push({
            id: nodeId,
            kind: 'file',
            label: labelForNode(nodeId),
            relPath: relPathFromRoot(nodeId, rootPath),
            basename: labelForNode(nodeId),
            folderPath: parentFolder ?? '',
            ...(parentFolder && visibleFolderIds.has(parentFolder) ? { parent: parentFolder } : {}),
            ...(position !== undefined ? { position } : {}),
            ...(classes.length > 0 ? { classes } : {}),
            ...(O.isSome(node.nodeUIMetadata.color) ? { color: node.nodeUIMetadata.color.value } : {}),
            content: normalizeProjectedContent(node.contentWithoutYamlOrLinks),
            ...(additionalYAMLProps.length > 0 ? { additionalYAMLProps } : {}),
            ...(node.nodeUIMetadata.isContextNode === true ? { isContextNode: true } : {}),
            ...(node.nodeUIMetadata.containedNodeIds
                ? { containedNodeIds: sortStrings(node.nodeUIMetadata.containedNodeIds) }
                : {}),
        })
    }

    nodes.sort((left, right) => left.id.localeCompare(right.id))
    return nodes
}

function buildFolderNoteProjection(
    visibleFolders: readonly FolderProjectionInfo[],
    graph: State['graph'],
): {
    readonly folderNoteOwnerById: ReadonlyMap<string, FolderId>
    readonly folderNoteIdByFolderId: ReadonlyMap<FolderId, string>
} {
    const folderNoteOwnerById = new Map<string, FolderId>()
    const folderNoteIdByFolderId = new Map<FolderId, string>()
    for (const info of visibleFolders) {
        const folderNoteId = getFolderNotePath(graph, info.id)
        if (folderNoteId !== undefined) {
            folderNoteOwnerById.set(folderNoteId, info.id)
            folderNoteIdByFolderId.set(info.id, folderNoteId)
        }
    }
    return { folderNoteOwnerById, folderNoteIdByFolderId }
}

function edgeEndpointForNode(
    nodeId: string,
    visibleEndpointByNodeId: ReadonlyMap<string, string>,
    folderNoteOwnerById: ReadonlyMap<string, FolderId>,
): { readonly id: string; readonly hiddenByCollapse: boolean } | undefined {
    const visibleEndpoint = visibleEndpointByNodeId.get(nodeId)
    if (visibleEndpoint === undefined) return undefined

    if (visibleEndpoint !== nodeId) {
        return { id: visibleEndpoint, hiddenByCollapse: true }
    }

    const folderNoteOwner = folderNoteOwnerById.get(nodeId)
    if (folderNoteOwner !== undefined) {
        return { id: folderNoteOwner, hiddenByCollapse: false }
    }

    return { id: visibleEndpoint, hiddenByCollapse: false }
}

function isImplicitContainmentEdge(sourceEndpointId: string, targetEndpointId: string): boolean {
    return parentFolderIdForNode(sourceEndpointId) === targetEndpointId
        || parentFolderIdForNode(targetEndpointId) === sourceEndpointId
}

// ── Pipeline Step 4: projectEdges ────────────────────────────────────────────

function projectEdges(
    nodeEntries: readonly (readonly [string, GraphNode])[],
    visibleEndpointByNodeId: ReadonlyMap<string, string>,
    folderNoteOwnerById: ReadonlyMap<string, FolderId>,
    graphNodes: Readonly<Record<string, GraphNode>>,
): readonly ProjectedEdge[] {
    const realEdges: ProjectedEdge[] = []
    const syntheticGroups = new Map<string, SyntheticEdgeGroup>()
    const seenRealEdgeIds = new Set<string>()

    for (const [sourceId, sourceNode] of nodeEntries) {
        const sourceEndpoint = edgeEndpointForNode(sourceId, visibleEndpointByNodeId, folderNoteOwnerById)
        if (sourceEndpoint === undefined) continue

        const outgoingEdges = [...sourceNode.outgoingEdges]
            .sort(compareEdges)

        for (const edge of outgoingEdges) {
            const targetNode = graphNodes[edge.targetId]
            if (!isProjectableGraphNode(targetNode)) continue

            const targetEndpoint = edgeEndpointForNode(edge.targetId, visibleEndpointByNodeId, folderNoteOwnerById)
            if (targetEndpoint === undefined) continue

            if (sourceEndpoint.id === targetEndpoint.id) continue
            if (isImplicitContainmentEdge(sourceEndpoint.id, targetEndpoint.id)) continue

            if (!sourceEndpoint.hiddenByCollapse && !targetEndpoint.hiddenByCollapse) {
                const id = `${sourceEndpoint.id}->${targetEndpoint.id}`
                if (seenRealEdgeIds.has(id)) continue
                seenRealEdgeIds.add(id)
                const label = normalizeLabel(edge.label)
                realEdges.push({
                    id, source: sourceEndpoint.id, target: targetEndpoint.id, kind: 'real',
                    ...(label ? { label } : {}),
                })
                continue
            }

            const sourceHidden = sourceEndpoint.hiddenByCollapse
            const anchorFolderId = (sourceHidden ? sourceEndpoint.id : targetEndpoint.id) as FolderId
            const direction = sourceHidden ? 'outgoing' as const : 'incoming' as const
            const externalId = sourceHidden ? targetEndpoint.id : sourceEndpoint.id
            if (anchorFolderId === externalId) continue

            const syntheticEdgeId = `synthetic:${anchorFolderId}:${direction === 'incoming' ? 'in' : 'out'}:${externalId}`
            const existing = syntheticGroups.get(syntheticEdgeId)
            const originalEdge = {
                sourceId, targetId: edge.targetId,
                ...(normalizeLabel(edge.label) ? { label: normalizeLabel(edge.label) } : {}),
            }

            if (existing) {
                existing.originalEdges.push(originalEdge)
                continue
            }

            syntheticGroups.set(syntheticEdgeId, {
                id: syntheticEdgeId, folderId: anchorFolderId, direction, externalId,
                originalEdges: [originalEdge],
            })
        }
    }

    const syntheticEdges: ProjectedEdge[] = [...syntheticGroups.values()].map((group) => {
        const label = group.originalEdges.length === 1 ? group.originalEdges[0].label : undefined
        return {
            id: group.id,
            source: group.direction === 'incoming' ? group.externalId : group.folderId,
            target: group.direction === 'incoming' ? group.folderId : group.externalId,
            kind: 'synthetic' as const,
            ...(label ? { label } : {}),
            classes: ['synthetic-folder-edge'] as const,
            ...(group.originalEdges.length > 1 ? { edgeCount: group.originalEdges.length } : {}),
        }
    })

    return [...realEdges, ...syntheticEdges].sort(compareProjectedEdges)
}

// ── Pipeline Step 5: computeForests ──────────────────────────────────────────

function computeForests(edges: readonly ProjectedEdge[]): {
    readonly forests: readonly (readonly TreeEdge[])[]
    readonly arboricity: number
} {
    const undirKey = (a: string, b: string): string => a < b ? `${a}|${b}` : `${b}|${a}`
    const byUndir = new Map<string, ProjectedEdge[]>()
    for (const e of edges) {
        if (e.source === e.target) continue
        const k = undirKey(e.source, e.target)
        if (!byUndir.has(k)) byUndir.set(k, [])
        byUndir.get(k)!.push(e)
    }

    type Entry = { readonly rep: ProjectedEdge; readonly all: readonly ProjectedEdge[] }
    let remaining: Entry[] = [...byUndir.values()].map(all => ({ rep: all[0]!, all }))
    const forests: (readonly TreeEdge[])[] = []

    while (remaining.length > 0) {
        const uf = new UnionFind()
        const forest: TreeEdge[] = []
        const leftover: Entry[] = []
        for (const entry of remaining) {
            if (uf.union(entry.rep.source, entry.rep.target)) {
                for (const e of entry.all) forest.push({ source: e.source, target: e.target })
            } else {
                leftover.push(entry)
            }
        }
        forests.push(forest)
        remaining = leftover
    }

    return { forests, arboricity: forests.length }
}

// ── Composed pipeline ────────────────────────────────────────────────────────

export function project(state: State): ProjectedGraph {
    const rootPath = state.roots.loaded.values().next().value ?? ''
    const folders = collectFolders(state)
    const { visibleFolders, visibleFolderIds, visibleCollapsedFolders, nodeEntries, visibleEndpointByNodeId } =
        filterByCollapse(folders, state.collapseSet, state.graph.nodes)
    const { folderNoteOwnerById, folderNoteIdByFolderId } = buildFolderNoteProjection(visibleFolders, state.graph)
    const nodes = projectNodes(
        visibleFolders, visibleFolderIds, visibleCollapsedFolders,
        nodeEntries, visibleEndpointByNodeId, folderNoteOwnerById, folderNoteIdByFolderId,
        state.graph, state.layout.positions, rootPath,
    )
    const edges = projectEdges(nodeEntries, visibleEndpointByNodeId, folderNoteOwnerById, state.graph.nodes)
    const { forests, arboricity } = computeForests(edges)
    return { nodes, edges, rootPath, revision: state.meta.revision, forests, arboricity, recentNodeIds: [] }
}
