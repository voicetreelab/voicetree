import normalizePath from 'normalize-path'
import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphDelta, GraphNode, NodeIdAndFilePath, Position } from '../..'
import { getIncomingEdgesToSubgraph } from '../merge/getIncomingEdgesToSubgraph'
import { redirectEdgeTarget } from '../merge/redirectEdgeTarget'
import { getFolderDescendantNodeIds, getFolderParent, getPathComponents, linkMatchScore, stableIdSuffix } from '../graphOperationPrimitives'

export interface ExtractIntoFolderSelectionSupport {
    readonly canExtract: boolean
    readonly commonParentPath: string | null
    readonly supportedSelectionCount: number
    readonly selectionsShareParent: boolean
}

export interface ComputeExtractIntoFolderGraphDeltaResult {
    readonly delta: GraphDelta
    readonly newFolderId: NodeIdAndFilePath | null
}

function getSelectedItemParent(selectedItemId: NodeIdAndFilePath): string | null {
    return selectedItemId.endsWith('/')
        ? getFolderParent(selectedItemId.slice(0, -1))
        : getFolderParent(selectedItemId)
}

function longestCommonFolderPath(parentPaths: readonly (string | null)[]): string | null {
    if (parentPaths.length === 0 || parentPaths.some((parentPath) => parentPath === null)) {
        return null
    }

    const stringPaths: readonly string[] = parentPaths as readonly string[]
    const allAbsolute: boolean = stringPaths.every((parentPath) => parentPath.startsWith('/'))
    const segmentLists: readonly (readonly string[])[] = stringPaths.map((parentPath) =>
        parentPath.split('/').filter((segment) => segment.length > 0)
    )

    const minSegmentCount: number = segmentLists.reduce<number>(
        (acc: number, segments: readonly string[]) => Math.min(acc, segments.length),
        Number.POSITIVE_INFINITY
    )

    const commonSegments: string[] = []
    for (let segmentIndex = 0; segmentIndex < minSegmentCount; segmentIndex++) {
        const segment: string = segmentLists[0][segmentIndex]
        if (segmentLists.every((segments) => segments[segmentIndex] === segment)) {
            commonSegments.push(segment)
        } else {
            break
        }
    }

    if (commonSegments.length === 0) {
        return null
    }
    const prefix: string = allAbsolute ? '/' : ''
    return prefix + commonSegments.join('/') + '/'
}

export function getExtractIntoFolderSelectionSupport(
    selectedItemIds: readonly NodeIdAndFilePath[]
): ExtractIntoFolderSelectionSupport {
    if (selectedItemIds.length === 0) {
        return {
            canExtract: false,
            commonParentPath: null,
            supportedSelectionCount: 0,
            selectionsShareParent: false
        }
    }

    const parentPaths: readonly (string | null)[] = selectedItemIds.map(getSelectedItemParent)
    const firstParentPath: string | null = parentPaths[0] ?? null
    const selectionsShareParent: boolean = parentPaths.every((parentPath) => parentPath === firstParentPath)
    const commonParentPath: string | null = selectionsShareParent
        ? firstParentPath
        : longestCommonFolderPath(parentPaths)
    const supportedSelectionCount: number = selectedItemIds.length

    return {
        canExtract: supportedSelectionCount >= 2,
        commonParentPath,
        supportedSelectionCount,
        selectionsShareParent
    }
}

function normalizeNodePath(nodePath: string): string {
    return normalizePath(nodePath)
}

function joinNodePath(parentPath: string, childPath: string): string {
    const trimmedParentPath: string = parentPath.replace(/\/+$/, '')
    const trimmedChildPath: string = childPath.replace(/^\/+/, '')

    if (trimmedParentPath.length === 0) {
        return normalizeNodePath(trimmedChildPath)
    }

    if (trimmedChildPath.length === 0) {
        return normalizeNodePath(trimmedParentPath)
    }

    return normalizeNodePath(`${trimmedParentPath}/${trimmedChildPath}`)
}

function toFolderId(nodePath: string): string {
    return nodePath.endsWith('/') ? nodePath : `${nodePath}/`
}

function getRelativePathFromCommonParent(
    nodeId: NodeIdAndFilePath,
    commonParentPath: string | null
): string {
    if (commonParentPath === null) {
        return nodeId
    }

    return nodeId.startsWith(commonParentPath)
        ? nodeId.slice(commonParentPath.length)
        : nodeId
}

function replaceTargetPlaceholders(
    content: string,
    oldTargetId: NodeIdAndFilePath,
    newTargetId: NodeIdAndFilePath
): string {
    if (content.length === 0) {
        return content
    }

    // A bare-basename wikilink (`[[foo]]`, one path component) is
    // location-independent: it resolves by name, and a moved file keeps its name,
    // so the link still resolves after the move. Rewriting it to the new absolute
    // path is unnecessary and fragile (breaks on folder rename / project relocation)
    // and pollutes the markdown. Preserve it; only links that encode a location —
    // path-qualified file links, or links to a moved *folder* (folders don't
    // resolve through the file-basename index) — are redirected.
    const targetIsFolder: boolean = oldTargetId.endsWith('/')

    return content.replace(/\[([^\]]+)\]\*/g, (match: string, linkText: string): string => {
        if (linkMatchScore(linkText, oldTargetId) <= 0) {
            return match
        }
        if (!targetIsFolder && getPathComponents(linkText).length <= 1) {
            return match
        }
        return `[${newTargetId}]*`
    })
}

function matchesFolderRedirectTarget(
    targetId: NodeIdAndFilePath,
    oldFolderTargetId: NodeIdAndFilePath
): boolean {
    return targetId === oldFolderTargetId || linkMatchScore(targetId, oldFolderTargetId) > 0
}

function redirectTargetInNode(
    node: GraphNode,
    oldTargetId: NodeIdAndFilePath,
    newTargetId: NodeIdAndFilePath
): GraphNode {
    if (!oldTargetId.endsWith('/')) {
        return redirectEdgeTarget(node, oldTargetId, newTargetId)
    }

    return {
        ...node,
        outgoingEdges: node.outgoingEdges.map((edge) => {
            return matchesFolderRedirectTarget(edge.targetId, oldTargetId)
                ? {
                    targetId: newTargetId,
                    label: edge.label
                }
                : edge
        })
    }
}

function applyTargetRedirects(
    node: GraphNode,
    targetRedirects: ReadonlyMap<NodeIdAndFilePath, NodeIdAndFilePath>
): GraphNode {
    let redirectedNode: GraphNode = node
    let redirectedContent: string = node.contentWithoutYamlOrLinks

    targetRedirects.forEach((newTargetId, oldTargetId) => {
        redirectedNode = redirectTargetInNode(redirectedNode, oldTargetId, newTargetId)
        redirectedContent = replaceTargetPlaceholders(redirectedContent, oldTargetId, newTargetId)
    })

    return {
        ...redirectedNode,
        contentWithoutYamlOrLinks: redirectedContent
    }
}

const FOLDER_INDEX_NOTE_NAME: string = 'index.md'

function computeFolderIndexPosition(nodesToMove: readonly GraphNode[]): O.Option<Position> {
    const positionedNodes: readonly Position[] = nodesToMove.flatMap((node) => {
        return O.isSome(node.nodeUIMetadata.position)
            ? [node.nodeUIMetadata.position.value]
            : []
    })

    if (positionedNodes.length === 0) {
        return O.none
    }

    const totalPosition: Position = positionedNodes.reduce<Position>((acc: Position, position: Position) => ({
        x: acc.x + position.x,
        y: acc.y + position.y
    }), { x: 0, y: 0 })

    return O.some({
        x: totalPosition.x / positionedNodes.length,
        y: totalPosition.y / positionedNodes.length
    })
}

function generatedFolderName(writeFolderPath: string, selectedItemIds: readonly NodeIdAndFilePath[]): string {
    return `extract_${stableIdSuffix([writeFolderPath, ...selectedItemIds])}`
}

export function computeExtractIntoFolderGraphDelta(
    selectedItemIds: readonly NodeIdAndFilePath[],
    graph: Graph,
    writeFolderPath: string,
    folderNameOverride?: string
): ComputeExtractIntoFolderGraphDeltaResult {
    const selectionSupport: ExtractIntoFolderSelectionSupport = getExtractIntoFolderSelectionSupport(selectedItemIds)
    if (!selectionSupport.canExtract) {
        return { delta: [], newFolderId: null }
    }

    const extractionBasePath: string = selectionSupport.commonParentPath ?? normalizeNodePath(writeFolderPath)
    if (extractionBasePath.length === 0) {
        return { delta: [], newFolderId: null }
    }

    const folderName: string = folderNameOverride !== undefined && folderNameOverride.trim().length > 0
        ? folderNameOverride.trim()
        : generatedFolderName(writeFolderPath, selectedItemIds)
    const newFolderPath: string = joinNodePath(extractionBasePath, folderName)
    const newFolderId: NodeIdAndFilePath = toFolderId(newFolderPath)

    const movedNodeIdMap: Map<NodeIdAndFilePath, NodeIdAndFilePath> = new Map()
    const selectedFolderIds: readonly NodeIdAndFilePath[] = selectedItemIds.filter((selectedItemId) => selectedItemId.endsWith('/'))

    selectedItemIds.forEach((selectedItemId) => {
        if (selectedItemId.endsWith('/')) {
            getFolderDescendantNodeIds(graph.nodes, selectedItemId).forEach((descendantNodeId) => {
                const relativePath: string = getRelativePathFromCommonParent(descendantNodeId, selectionSupport.commonParentPath)
                movedNodeIdMap.set(descendantNodeId, joinNodePath(newFolderPath, relativePath))
            })
            return
        }

        const selectedNode: GraphNode | undefined = graph.nodes[selectedItemId]
        if (selectedNode === undefined || selectedNode.nodeUIMetadata.isContextNode === true) {
            return
        }

        const relativePath: string = getRelativePathFromCommonParent(selectedItemId, selectionSupport.commonParentPath)
        movedNodeIdMap.set(selectedItemId, joinNodePath(newFolderPath, relativePath))
    })

    if (movedNodeIdMap.size === 0) {
        return { delta: [], newFolderId: null }
    }

    const selectedItemTargetIds: Map<NodeIdAndFilePath, NodeIdAndFilePath> = new Map()

    selectedItemIds.forEach((selectedItemId) => {
        if (selectedItemId.endsWith('/')) {
            const relativeFolderPath: string = getRelativePathFromCommonParent(selectedItemId, selectionSupport.commonParentPath).replace(/\/$/, '')
            selectedItemTargetIds.set(
                selectedItemId,
                toFolderId(joinNodePath(newFolderPath, relativeFolderPath))
            )
            return
        }

        const movedNodeId: NodeIdAndFilePath | undefined = movedNodeIdMap.get(selectedItemId)
        if (movedNodeId !== undefined) {
            selectedItemTargetIds.set(selectedItemId, movedNodeId)
        }
    })

    if (selectedItemTargetIds.size < 2) {
        return { delta: [], newFolderId: null }
    }

    const targetRedirects: Map<NodeIdAndFilePath, NodeIdAndFilePath> = new Map(movedNodeIdMap)
    selectedItemTargetIds.forEach((newTargetId, oldTargetId) => {
        targetRedirects.set(oldTargetId, newTargetId)
    })

    const movedNodes: readonly {
        readonly movedNode: GraphNode
        readonly oldNode: GraphNode
        readonly oldNodeId: NodeIdAndFilePath
    }[] = Array.from(movedNodeIdMap.entries()).flatMap(([oldNodeId, newNodeId]) => {
        const oldNode: GraphNode | undefined = graph.nodes[oldNodeId]
        if (oldNode === undefined) {
            return []
        }

        const redirectedNode: GraphNode = applyTargetRedirects(oldNode, targetRedirects)
        return [{
            oldNodeId,
            oldNode,
            movedNode: {
                ...redirectedNode,
                absoluteFilePathIsID: newNodeId
            }
        }]
    })

    if (movedNodes.length === 0) {
        return { delta: [], newFolderId: null }
    }

    const incomingEdges = getIncomingEdgesToSubgraph(Array.from(movedNodeIdMap.keys()), graph)
    const externalSourceNodeIds: Set<NodeIdAndFilePath> = new Set(
        incomingEdges.map((incomingEdge) => incomingEdge.sourceNodeId)
    )

    Object.entries(graph.nodes).forEach(([sourceNodeId, sourceNode]) => {
        if (sourceNode.nodeUIMetadata.isContextNode === true) {
            return
        }

        if (sourceNode.outgoingEdges.some((edge) => {
            return selectedFolderIds.some((selectedFolderId) => {
                return matchesFolderRedirectTarget(edge.targetId, selectedFolderId)
            })
        })) {
            externalSourceNodeIds.add(sourceNodeId)
        }
    })

    movedNodeIdMap.forEach((_, movedNodeId) => {
        externalSourceNodeIds.delete(movedNodeId)
    })

    const externalNodeUpserts: GraphDelta = Array.from(externalSourceNodeIds).flatMap((sourceNodeId) => {
        const sourceNode: GraphNode | undefined = graph.nodes[sourceNodeId]
        if (sourceNode === undefined) {
            return []
        }

        const redirectedNode: GraphNode = applyTargetRedirects(sourceNode, targetRedirects)
        return [{
            type: 'UpsertNode' as const,
            nodeToUpsert: redirectedNode,
            previousNode: O.some(sourceNode)
        }]
    })

    const folderIndexNoteId: NodeIdAndFilePath = joinNodePath(newFolderPath, FOLDER_INDEX_NOTE_NAME)
    const containedNodeCount: number = selectedItemTargetIds.size
    const folderIndexNote: GraphNode = {
        kind: 'leaf',
        absoluteFilePathIsID: folderIndexNoteId,
        outgoingEdges: [],
        contentWithoutYamlOrLinks: `Contains ${containedNodeCount} nodes.`,
        nodeUIMetadata: {
            color: O.none,
            position: computeFolderIndexPosition(movedNodes.map(({ oldNode }) => oldNode)),
            additionalYAMLProps: {},
            isContextNode: false
        }
    }

    const movedNodeUpserts: GraphDelta = movedNodes.map(({ movedNode, oldNode }) => ({
        type: 'UpsertNode' as const,
        nodeToUpsert: movedNode,
        previousNode: O.some(oldNode)
    }))

    const movedNodeDeletes: GraphDelta = movedNodes.map(({ oldNodeId, oldNode }) => ({
        type: 'DeleteNode' as const,
        nodeId: oldNodeId,
        deletedNode: O.some(oldNode)
    }))

    return {
        delta: [
            ...movedNodeUpserts,
            ...externalNodeUpserts,
            {
                type: 'UpsertNode' as const,
                nodeToUpsert: folderIndexNote,
                previousNode: O.none
            },
            ...movedNodeDeletes
        ],
        newFolderId
    }
}
