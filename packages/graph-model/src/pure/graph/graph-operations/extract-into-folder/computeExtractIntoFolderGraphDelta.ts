import normalizePath from 'normalize-path'
import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphDelta, GraphNode, NodeIdAndFilePath, Position } from '../..'
import { linkMatchScore } from '../../markdown-parsing/extract-edges'
import { getFolderDescendantNodeIds, getFolderParent } from '../../folderCollapse'
import { getIncomingEdgesToSubgraph } from '../merge/getIncomingEdgesToSubgraph'
import { redirectEdgeTarget } from '../merge/redirectEdgeTarget'

export interface ExtractIntoFolderSelectionSupport {
    readonly canExtract: boolean
    readonly commonParentPath: string | null
    readonly supportedSelectionCount: number
}

function getSelectedItemParent(selectedItemId: NodeIdAndFilePath): string | null {
    return selectedItemId.endsWith('/')
        ? getFolderParent(selectedItemId.slice(0, -1))
        : getFolderParent(selectedItemId)
}

export function getExtractIntoFolderSelectionSupport(
    selectedItemIds: readonly NodeIdAndFilePath[]
): ExtractIntoFolderSelectionSupport {
    if (selectedItemIds.length === 0) {
        return {
            canExtract: false,
            commonParentPath: null,
            supportedSelectionCount: 0
        }
    }

    const parentPaths: readonly (string | null)[] = selectedItemIds.map(getSelectedItemParent)
    const firstParentPath: string | null = parentPaths[0] ?? null
    const sharesSameParent: boolean = parentPaths.every((parentPath) => parentPath === firstParentPath)
    const supportedSelectionCount: number = sharesSameParent ? selectedItemIds.length : 0

    return {
        canExtract: supportedSelectionCount >= 2,
        commonParentPath: sharesSameParent ? firstParentPath : null,
        supportedSelectionCount
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

    return content.replace(/\[([^\]]+)\]\*/g, (match: string, linkText: string): string => {
        return linkMatchScore(linkText, oldTargetId) > 0
            ? `[${newTargetId}]*`
            : match
    })
}

function applyTargetRedirects(
    node: GraphNode,
    targetRedirects: ReadonlyMap<NodeIdAndFilePath, NodeIdAndFilePath>
): GraphNode {
    let redirectedNode: GraphNode = node
    let redirectedContent: string = node.contentWithoutYamlOrLinks

    targetRedirects.forEach((newTargetId, oldTargetId) => {
        redirectedNode = redirectEdgeTarget(redirectedNode, oldTargetId, newTargetId)
        redirectedContent = replaceTargetPlaceholders(redirectedContent, oldTargetId, newTargetId)
    })

    return {
        ...redirectedNode,
        contentWithoutYamlOrLinks: redirectedContent
    }
}

function computeHubPosition(nodesToMove: readonly GraphNode[]): O.Option<Position> {
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

function createExtractionNames(): {
    readonly folderName: string
    readonly hubNoteName: string
} {
    const timestamp: number = Date.now()
    const randomSuffix: string = Math.random().toString(36).slice(2, 7)

    return {
        folderName: `extract_${timestamp}_${randomSuffix}`,
        hubNoteName: `hub_${timestamp}_${randomSuffix}.md`
    }
}

export function computeExtractIntoFolderGraphDelta(
    selectedItemIds: readonly NodeIdAndFilePath[],
    graph: Graph,
    writePath: string
): GraphDelta {
    const selectionSupport: ExtractIntoFolderSelectionSupport = getExtractIntoFolderSelectionSupport(selectedItemIds)
    if (!selectionSupport.canExtract) {
        return []
    }

    const extractionBasePath: string = selectionSupport.commonParentPath ?? normalizeNodePath(writePath)
    if (extractionBasePath.length === 0) {
        return []
    }

    const { folderName, hubNoteName } = createExtractionNames()
    const newFolderPath: string = joinNodePath(extractionBasePath, folderName)

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
        return []
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
        return []
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
        return []
    }

    const incomingEdges = getIncomingEdgesToSubgraph(Array.from(movedNodeIdMap.keys()), graph)
    const externalSourceNodeIds: Set<NodeIdAndFilePath> = new Set(
        incomingEdges.map((incomingEdge) => incomingEdge.sourceNodeId)
    )

    Object.entries(graph.nodes).forEach(([sourceNodeId, sourceNode]) => {
        if (sourceNode.nodeUIMetadata.isContextNode === true) {
            return
        }

        if (sourceNode.outgoingEdges.some((edge) => selectedFolderIds.includes(edge.targetId))) {
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

    const hubNoteId: NodeIdAndFilePath = joinNodePath(newFolderPath, hubNoteName)
    const hubNote: GraphNode = {
        absoluteFilePathIsID: hubNoteId,
        outgoingEdges: Array.from(selectedItemTargetIds.values()).map((targetId) => ({
            targetId,
            label: ''
        })),
        contentWithoutYamlOrLinks: '# Hub',
        nodeUIMetadata: {
            color: O.none,
            position: computeHubPosition(movedNodes.map(({ oldNode }) => oldNode)),
            additionalYAMLProps: new Map(),
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

    return [
        ...movedNodeUpserts,
        ...externalNodeUpserts,
        {
            type: 'UpsertNode' as const,
            nodeToUpsert: hubNote,
            previousNode: O.none
        },
        ...movedNodeDeletes
    ]
}
