
// FUNCTION, TAKES GRAPH, APPLIES calculateInitialPosition to EVERY NODE if position is none, returns GRAPH

// DOES a PREORDER TRAVERSAL STARTING FROM ALL ROOTS OF GRAPH (NODE WITH NO PARENT)

// pre order to ensure parents already have position set before positioning children

// mimick A GHOST ROOT NODE FOR THE INITIAL ROOTS, TO MIMICK AS IF THE ROOT NODES ALL HAVE A COMMON PARENT for positioning

// uses src/functional/pure/positioning/calculateInitialPosition.ts

// SEEN SET TO AVOID CYCLES

import type { Graph, GraphNode, NodeIdAndFilePath, Position } from '@/pure/graph'
import { createGraph } from '@/pure/graph/createGraph'
import * as O from 'fp-ts/lib/Option.js'
import { findFirstParentNode } from '@/pure/graph/graph-operations/findFirstParentNode'
import { calculateInitialPositionForChild } from './calculateInitialPosition'

const GHOST_ROOT_ID: NodeIdAndFilePath = '__GHOST_ROOT__'
const GHOST_ROOT_POSITION: Position = { x: 0, y: 0 }

/**
 * Apply positions to all nodes in the graph that don't have a position.
 *
 * Algorithm:
 * 1. Find all root nodes (nodes with no parent)
 * 2. Create a ghost root node at origin with edges to all root nodes
 * 3. Preorder traversal from ghost root positions all nodes naturally
 * 4. Remove ghost root from final result
 * 5. Uses a seen set to avoid cycles
 *
 * @param graph - The graph to apply positions to
 * @returns A new graph with all nodes positioned
 */
export function applyPositions(graph: Graph): Graph {
    const rootNodes: readonly string[] = findRootNodes(graph)

    // Create ghost root node with outgoing edges to all root nodes
    const ghostRootNode: GraphNode = {
        relativeFilePathIsID: GHOST_ROOT_ID,
        outgoingEdges: rootNodes.map(targetId => ({ targetId, label: '' })),
        contentWithoutYamlOrLinks: '',
        nodeUIMetadata: {
            color: O.none,
            position: O.some(GHOST_ROOT_POSITION),
            additionalYAMLProps: new Map(),
            isContextNode: false
        }
    }

    // Add ghost root to graph temporarily
    const graphWithGhostRoot: Graph = createGraph({
        ...graph.nodes,
        [GHOST_ROOT_ID]: ghostRootNode
    })

    // Traverse from ghost root - this will position all nodes
    const graphWithAllPositions: Graph = traverseAndPosition(
        graphWithGhostRoot,
        GHOST_ROOT_ID,
        new Set<NodeIdAndFilePath>(),
        undefined // ghost root has no parent or sibling index
    ).graph

    // Remove ghost root from final result

    const { [GHOST_ROOT_ID]: _, ...finalNodes } = graphWithAllPositions.nodes

    return createGraph(finalNodes)
}

/**
 * Find all root nodes (nodes with no parent)
 */
function findRootNodes(graph: Graph): readonly NodeIdAndFilePath[] {
    return Object.values(graph.nodes)
        .filter((node) => findFirstParentNode(node, graph) === undefined)
        .map((node) => node.relativeFilePathIsID)
}

/**
 * Preorder traversal to position nodes
 * Returns both the updated graph and the updated seen set
 * @param childIndexInParent - The index of this node among its parent's children (undefined for ghost root)
 */
function traverseAndPosition(
    tree: Graph,
    nodeId: NodeIdAndFilePath,
    seen: ReadonlySet<NodeIdAndFilePath>,
    childIndexInParent: number | undefined
): { readonly graph: Graph; readonly seen: ReadonlySet<NodeIdAndFilePath> } {

    // PRE ORDER RECURSIVE TRAVERSAL OF GRAPH (WHICH WE ASSUME SI TREE)

    // base case: already visited (cycle detection)
    if (seen.has(nodeId)) {
        return { graph: tree, seen }
    }

    // Mark as seen
    const updatedSeen: ReadonlySet<NodeIdAndFilePath> = new Set(seen).add(nodeId)

    // Get current node
    const node: GraphNode = tree.nodes[nodeId]
    if (!node) {
        return { graph: tree, seen: updatedSeen }
    }

    // PREORDER: Process current node - ensure it has a position
    const graphAfterPositioningCurrentNode: Graph = nodeId === GHOST_ROOT_ID
        ? tree  // Don't position ghost root
        : positionNodeIfNeeded(node, nodeId, tree, childIndexInParent)

    // RECURSIVE CASE: Process all children using reduce with index
    return node.outgoingEdges.reduce(
        (acc, edge, childIndex) => {
            const childResult: { readonly graph: Graph; readonly seen: ReadonlySet<NodeIdAndFilePath>; } = traverseAndPosition(acc.graph, edge.targetId, acc.seen, childIndex)
            return {
                graph: childResult.graph,
                seen: childResult.seen
            }
        },
        { graph: graphAfterPositioningCurrentNode, seen: updatedSeen }
    )
}

/**
 * Position a node based on its parent's position and child index.
 * Respects existing YAML positions - only calculates if node has no position.
 */
function positionNodeIfNeeded(
    node: GraphNode,
    nodeId: NodeIdAndFilePath,
    tree: Graph,
    childIndexInParent: number | undefined
): Graph {
    // If node already has a position (from YAML), keep it
    if (O.isSome(node.nodeUIMetadata.position)) {
        return tree
    }

    const parentNode: GraphNode | undefined = findFirstParentNode(node, tree)

    if (!parentNode || childIndexInParent === undefined) {
        return tree
    }

    const newPosition: O.Option<Position> = calculateInitialPositionForChild(
        parentNode,
        tree,
        childIndexInParent
    )

    if (O.isNone(newPosition)) {
        return tree
    }

    const updatedNode: GraphNode = {
        ...node,
        nodeUIMetadata: {
            ...node.nodeUIMetadata,
            position: newPosition
        }
    }

    // Preserve the existing incomingEdgesIndex since we're only updating node metadata, not edges
    return {
        nodes: {
            ...tree.nodes,
            [nodeId]: updatedNode
        },
        incomingEdgesIndex: tree.incomingEdgesIndex
    }
}
