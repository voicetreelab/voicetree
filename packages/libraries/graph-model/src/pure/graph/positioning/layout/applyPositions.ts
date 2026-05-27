
// FUNCTION, TAKES GRAPH, APPLIES calculateInitialPosition to EVERY NODE if position is none, returns GRAPH

// DOES a PREORDER TRAVERSAL STARTING FROM ALL ROOTS OF GRAPH (NODE WITH NO PARENT)

// pre order to ensure parents already have position set before positioning children

// mimick A GHOST ROOT NODE FOR THE INITIAL ROOTS, TO MIMICK AS IF THE ROOT NODES ALL HAVE A COMMON PARENT for positioning

// uses src/functional/pure/positioning/calculateInitialPosition.ts

// SEEN SET TO AVOID CYCLES

import type { Graph, GraphNode, NodeIdAndFilePath, Position } from '../..'
import { createGraph, findFirstParentNode } from '../graphLayoutPrimitives'
import * as O from 'fp-ts/lib/Option.js'
import { calculateInitialPositionForChild } from '../placement/calculateInitialPosition'
import { componentsOverlap, packComponents, type ComponentSubgraph } from './packComponents'

const GHOST_ROOT_ID: NodeIdAndFilePath = '__GHOST_ROOT__'
const GHOST_ROOT_POSITION: Position = { x: 0, y: 0 }
const DEFAULT_NODE_WIDTH: number = 250
const DEFAULT_NODE_HEIGHT: number = 100

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
        kind: 'leaf',
        absoluteFilePathIsID: GHOST_ROOT_ID,
        outgoingEdges: rootNodes.map(targetId => ({ targetId, label: '' })),
        contentWithoutYamlOrLinks: '',
        nodeUIMetadata: {
            color: O.none,
            position: O.some(GHOST_ROOT_POSITION),
            additionalYAMLProps: {},
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

    // Angular seeding spawns every disconnected root around (0,0), so multiple
    // freshly-seeded components end up overlapping in screen space. Push them
    // apart so the renderer can show the graph without a manual Tidy pass.
    // Components containing any anchored (pre-positioned) node are pinned —
    // saved user positions never drift just because a fresh component landed
    // on top of them.
    return createGraph(separateFreshlySeededComponents(graph.nodes, finalNodes))
}

/**
 * Find connected components treating outgoing edges as undirected.
 * Returns each component as a list of node IDs.
 */
function findConnectedComponents(
    nodes: Readonly<Record<NodeIdAndFilePath, GraphNode>>,
): readonly (readonly NodeIdAndFilePath[])[] {
    const adjacency: Map<NodeIdAndFilePath, Set<NodeIdAndFilePath>> = new Map()
    const ensure: (id: NodeIdAndFilePath) => Set<NodeIdAndFilePath> = (id) => {
        const existing: Set<NodeIdAndFilePath> | undefined = adjacency.get(id)
        if (existing) return existing
        const fresh: Set<NodeIdAndFilePath> = new Set()
        adjacency.set(id, fresh)
        return fresh
    }

    for (const [id, node] of Object.entries(nodes) as readonly [NodeIdAndFilePath, GraphNode][]) {
        ensure(id)
        for (const edge of node.outgoingEdges) {
            if (!nodes[edge.targetId]) continue
            ensure(id).add(edge.targetId)
            ensure(edge.targetId).add(id)
        }
    }

    const visited: Set<NodeIdAndFilePath> = new Set()
    const components: NodeIdAndFilePath[][] = []
    for (const id of adjacency.keys()) {
        if (visited.has(id)) continue
        const stack: NodeIdAndFilePath[] = [id]
        const component: NodeIdAndFilePath[] = []
        while (stack.length > 0) {
            const current: NodeIdAndFilePath = stack.pop() as NodeIdAndFilePath
            if (visited.has(current)) continue
            visited.add(current)
            component.push(current)
            for (const neighbor of adjacency.get(current) ?? []) {
                if (!visited.has(neighbor)) stack.push(neighbor)
            }
        }
        components.push(component)
    }
    return components
}

function separateFreshlySeededComponents(
    inputNodes: Readonly<Record<NodeIdAndFilePath, GraphNode>>,
    seededNodes: Readonly<Record<NodeIdAndFilePath, GraphNode>>,
): Record<NodeIdAndFilePath, GraphNode> {
    const components: readonly (readonly NodeIdAndFilePath[])[] = findConnectedComponents(seededNodes)
    if (components.length < 2) {
        return { ...seededNodes }
    }

    // Only re-pack when every component is freshly seeded. If any component
    // contains an anchored node (positions.json, YAML frontmatter, prior
    // session), leave layout alone — the user's saved positions are the
    // source of truth and the renderer will reconcile via its own layout
    // pass for any newly-added clusters.
    const hasAnchoredComponent: boolean = components.some((component) =>
        component.some((id: NodeIdAndFilePath) => {
            const inputNode: GraphNode | undefined = inputNodes[id]
            return inputNode !== undefined && O.isSome(inputNode.nodeUIMetadata.position)
        }),
    )
    if (hasAnchoredComponent) {
        return { ...seededNodes }
    }

    const subgraphs: readonly ComponentSubgraph[] = components.map((component) => ({
        nodes: component
            .map((id: NodeIdAndFilePath) => O.toUndefined(seededNodes[id]?.nodeUIMetadata.position))
            .filter((p): p is Position => p !== undefined)
            .map((p) => ({ x: p.x, y: p.y, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT })),
        edges: [],
    }))

    // Skip packing when angular seeding already produced disjoint components
    // (e.g., one tiny graph) — packing would shift their positions for no
    // visible benefit.
    if (!componentsOverlap(subgraphs)) {
        return { ...seededNodes }
    }

    const { shifts } = packComponents(subgraphs)

    const result: Record<NodeIdAndFilePath, GraphNode> = { ...seededNodes }
    components.forEach((component, i) => {
        const shift: { readonly dx: number; readonly dy: number } | undefined = shifts[i]
        if (!shift || (shift.dx === 0 && shift.dy === 0)) return
        for (const id of component) {
            const node: GraphNode | undefined = result[id]
            if (!node || O.isNone(node.nodeUIMetadata.position)) continue
            const pos: Position = node.nodeUIMetadata.position.value
            result[id] = {
                ...node,
                nodeUIMetadata: {
                    ...node.nodeUIMetadata,
                    position: O.some({ x: pos.x + shift.dx, y: pos.y + shift.dy }),
                },
            }
        }
    })
    return result
}

/**
 * Find all root nodes (nodes with no parent)
 */
function findRootNodes(graph: Graph): readonly NodeIdAndFilePath[] {
    return Object.values(graph.nodes)
        .filter((node) => findFirstParentNode(node, graph) === undefined)
        .map((node) => node.absoluteFilePathIsID)
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
 * Respects existing positions (from positions.json or legacy YAML) - only calculates if node has no position.
 */
function positionNodeIfNeeded(
    node: GraphNode,
    nodeId: NodeIdAndFilePath,
    tree: Graph,
    childIndexInParent: number | undefined
): Graph {
    // If node already has a position (from positions.json or legacy YAML), keep it
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

    // Preserve all existing indexes since we're only updating node metadata, not edges
    return {
        nodes: {
            ...tree.nodes,
            [nodeId]: updatedNode
        },
        incomingEdgesIndex: tree.incomingEdgesIndex,
        nodeByBaseName: tree.nodeByBaseName,
        unresolvedLinksIndex: tree.unresolvedLinksIndex
    }
}
