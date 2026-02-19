import type {Graph, GraphNode, NodeIdAndFilePath, Position} from "@/pure/graph";
import * as O from 'fp-ts/lib/Option.js'
import {
    calculateChildAngle,
    calculateParentAngle,
    DEFAULT_EDGE_LENGTH,
    polarToCartesian,
    SPAWN_RADIUS
} from "@/pure/graph/positioning/angularPositionSeeding";
import {findFirstParentNode} from "@/pure/graph/graph-operations/findFirstParentNode";
import type {ObstacleBBox, EdgeSegment} from "@/pure/graph/positioning/findBestPosition";
import {findBestPosition} from "@/pure/graph/positioning/findBestPosition";
import {extractEdgeSegmentsFromGraph} from "@/pure/graph/positioning/extractObstaclesFromGraph";

/**
 * Calculate initial position for a new child node (pure function)
 *
 * Uses angular position seeding to place the child at an appropriate angle
 * from the parent, based on how many siblings already exist.
 *
 * @param parentNode - The parent node that the child will spawn from
 * @param graph - The graph to search for grandparent node
 * @param childIndex - Optional specific index for this child (0-indexed). If not provided, uses siblingCount (for adding new child)
 * @returns Position for the new child node, or None if parent has no position
 */
export function calculateInitialPositionForChild(
    parentNode: GraphNode,
    graph: Graph,
    childIndex?: number,
    spawnRadius: number = SPAWN_RADIUS
): O.Option<Position> {
    // Get parent's position
    return O.chain((parentPos: Position) => {
        // Find grandparent to determine parent's angle constraint
        const grandparentNode: GraphNode | undefined = findFirstParentNode(parentNode, graph);
        const parentAngle: number | undefined = calculateParentAngle(parentNode, grandparentNode);

        // Use provided child index, or count existing children for new child
        const indexToUse: number = childIndex ?? parentNode.outgoingEdges.length;

        // Calculate angle for this child (will be the Nth child, 0-indexed)
        const angle: number = calculateChildAngle(indexToUse, parentAngle);

        // Convert to cartesian offset
        const offset: { readonly x: number; readonly y: number; } = polarToCartesian(angle, spawnRadius);

        return O.some({
            x: parentPos.x + offset.x,
            y: parentPos.y + offset.y
        });
    })(parentNode.nodeUIMetadata.position);
}

// export calculateInitialPosition()
// todo, this function if parent will return  calculateInitialPositionForChild
// else will return 0,0

const CHILD_NODE_DIMENSIONS: { readonly width: number; readonly height: number } = { width: 250, height: 250 };

/**
 * Calculate a collision-aware position for a new child node (pure function).
 *
 * Takes pre-extracted obstacles and pure graph data — no cytoscape dependency.
 * Computes the desired angle from the graph topology, then delegates to findBestPosition.
 *
 * @param edgeSegments - Optional pre-extracted edge segments (e.g., from spatial index).
 *   When provided, skips internal BFS extraction. When omitted, falls back to
 *   extractEdgeSegmentsFromGraph (5-hop BFS).
 */
export function calculateCollisionAwareChildPosition(
    parentPos: Position,
    graph: Graph,
    parentNodeId: NodeIdAndFilePath,
    obstacles: readonly ObstacleBBox[],
    distance: number = DEFAULT_EDGE_LENGTH,
    edgeSegments?: readonly EdgeSegment[]
): Position {
    const parentGraphNode: GraphNode | undefined = graph.nodes[parentNodeId];
    const grandparentNode: GraphNode | undefined = parentGraphNode ? findFirstParentNode(parentGraphNode, graph) : undefined;
    const parentAngle: number | undefined = parentGraphNode && grandparentNode
        ? calculateParentAngle(parentGraphNode, grandparentNode)
        : undefined;

    const childIndex: number = parentGraphNode ? parentGraphNode.outgoingEdges.length : 0;
    const desiredAngle: number = calculateChildAngle(childIndex, parentAngle);

    const segments: readonly EdgeSegment[] = edgeSegments ?? extractEdgeSegmentsFromGraph(parentNodeId, graph);

    return findBestPosition(
        parentPos,
        desiredAngle,
        distance,
        CHILD_NODE_DIMENSIONS,
        obstacles,
        undefined,
        segments
    );
}