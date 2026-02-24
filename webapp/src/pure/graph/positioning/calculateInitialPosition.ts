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
import type {Obstacle} from "@/pure/graph/positioning/findBestPosition";
import {findBestPosition} from "@/pure/graph/positioning/findBestPosition";
import type {Rect, SpatialIndex} from "@/pure/graph/spatial";
import {hasGraphCollision} from "@/pure/graph/spatial";
import {extractFromSpatialIndex} from "@/pure/graph/positioning/spatialAdapters";

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

const CHILD_NODE_DIMENSIONS: { readonly width: number; readonly height: number } = { width: 250, height: 250 };

/**
 * Calculate a collision-aware position for a new child node (pure function).
 *
 * Takes pre-extracted unified obstacles (node bboxes + edge segments) and pure
 * graph data — no cytoscape dependency.
 * Computes the desired angle from the graph topology, then delegates to findBestPosition.
 *
 * @param childIndexOverride - Optional explicit child index. When provided, overrides
 *   the default outgoingEdges.length count. Needed when edges point child→parent
 *   (e.g., createGraphTool batch) rather than parent→child.
 */
export function calculateCollisionAwareChildPosition(
    parentPos: Position,
    graph: Graph,
    parentNodeId: NodeIdAndFilePath,
    obstacles: readonly Obstacle[],
    distance: number = DEFAULT_EDGE_LENGTH,
    childIndexOverride?: number
): Position {
    const parentGraphNode: GraphNode | undefined = graph.nodes[parentNodeId];
    const grandparentNode: GraphNode | undefined = parentGraphNode ? findFirstParentNode(parentGraphNode, graph) : undefined;
    const parentAngle: number | undefined = parentGraphNode && grandparentNode
        ? calculateParentAngle(parentGraphNode, grandparentNode)
        : undefined;

    const childIndex: number = childIndexOverride ?? (parentGraphNode ? parentGraphNode.outgoingEdges.length : 0);
    const desiredAngle: number = calculateChildAngle(childIndex, parentAngle);

    return findBestPosition(
        parentPos,
        desiredAngle,
        distance,
        CHILD_NODE_DIMENSIONS,
        obstacles,
    );
}

/**
 * Compute the centroid (center of mass) of all positioned nodes in the graph.
 * Falls back to the origin if no nodes have positions yet.
 */
export function computeGraphCentroid(graph: Graph): Position {
    const allNodes: readonly GraphNode[] = Object.values(graph.nodes) as readonly GraphNode[]
    const {sumX, sumY, count} = allNodes.reduce(
        (acc: {readonly sumX: number; readonly sumY: number; readonly count: number}, node: GraphNode) =>
            O.isSome(node.nodeUIMetadata.position)
                ? {sumX: acc.sumX + node.nodeUIMetadata.position.value.x, sumY: acc.sumY + node.nodeUIMetadata.position.value.y, count: acc.count + 1}
                : acc,
        {sumX: 0, sumY: 0, count: 0}
    )
    return count === 0 ? {x: 0, y: 0} : {x: sumX / count, y: sumY / count}
}

// ============================================================================
// Free-slot search (parentless node placement)
// ============================================================================

/** Minimum clear area (px) required for a parentless node spawn. */
const FREE_SLOT_SIZE: number = 400;

/** Centre-to-centre step between hex-grid candidates (px). Equal to FREE_SLOT_SIZE so adjacent slots touch without overlapping horizontally/vertically. */
const FREE_SLOT_STEP: number = 400;

/** Safety limit: stop searching after this many rings (~20 000 px from COM). */
const FREE_SLOT_MAX_RINGS: number = 50;

/**
 * Six hex-grid direction vectors (pointy-top layout, step = FREE_SLOT_STEP).
 *
 * Ring traversal: ring r starts at origin + r*dirs[4] (SW), then walks
 * r steps in each direction 0..5 in sequence to cover the full ring.
 *
 * Verification for r=1: SW→SE→E→NE→NW→W (all 6 neighbours). ✓
 */
const HEX_DIRS: readonly {readonly dx: number; readonly dy: number}[] = [
    {dx: FREE_SLOT_STEP,       dy: 0                                   },  // 0: E
    {dx: FREE_SLOT_STEP / 2,   dy: -FREE_SLOT_STEP * Math.sqrt(3) / 2 },  // 1: NE
    {dx: -FREE_SLOT_STEP / 2,  dy: -FREE_SLOT_STEP * Math.sqrt(3) / 2 },  // 2: NW
    {dx: -FREE_SLOT_STEP,      dy: 0                                   },  // 3: W
    {dx: -FREE_SLOT_STEP / 2,  dy: FREE_SLOT_STEP * Math.sqrt(3) / 2  },  // 4: SW  ← ring start
    {dx: FREE_SLOT_STEP / 2,   dy: FREE_SLOT_STEP * Math.sqrt(3) / 2  },  // 5: SE
];

/**
 * Find the nearest free 400×400 slot to `origin` using a hex-grid spiral.
 *
 * Checks `origin` itself first (ring 0), then expands outward ring by ring.
 * Returns the first collision-free centre position.
 * Falls back to the last candidate if FREE_SLOT_MAX_RINGS is exhausted.
 */
export function findFreeSlotNearPosition(
    index: SpatialIndex,
    origin: Position,
): Position {
    const half: number = FREE_SLOT_SIZE / 2;

    const isFree: (pos: Position) => boolean = (pos: Position): boolean => {
        const rect: Rect = {
            minX: pos.x - half, minY: pos.y - half,
            maxX: pos.x + half, maxY: pos.y + half,
        };
        return !hasGraphCollision(index, rect);
    };

    // Offset from ring-start to the beginning of side i = r × Σ HEX_DIRS[0..i-1]
    const sideStartOffset: (r: number, i: number) => Position = (r: number, i: number): Position =>
        Array.from({length: i}, (_: unknown, k: number): number => k).reduce(
            (acc: Position, k: number): Position => ({
                x: acc.x + r * HEX_DIRS[k].dx,
                y: acc.y + r * HEX_DIRS[k].dy,
            }),
            {x: 0, y: 0}
        );

    // All candidate positions in ring r (6×r positions)
    const hexRing: (r: number) => readonly Position[] = (r: number): readonly Position[] => {
        const ringStart: Position = {
            x: origin.x + r * HEX_DIRS[4].dx,
            y: origin.y + r * HEX_DIRS[4].dy,
        };
        return Array.from(
            {length: 6},
            (_: unknown, i: number): readonly Position[] => {
                const sideOff: Position = sideStartOffset(r, i);
                return Array.from({length: r}, (_: unknown, j: number): Position => ({
                    x: ringStart.x + sideOff.x + j * HEX_DIRS[i].dx,
                    y: ringStart.y + sideOff.y + j * HEX_DIRS[i].dy,
                }));
            }
        ).flat();
    };

    // All candidates: origin (ring 0) then rings 1..MAX_RINGS
    const candidates: readonly Position[] = [
        origin,
        ...Array.from(
            {length: FREE_SLOT_MAX_RINGS},
            (_: unknown, rIdx: number): readonly Position[] => hexRing(rIdx + 1)
        ).flat(),
    ];

    return candidates.find(isFree) ?? candidates[candidates.length - 1];
}

// ============================================================================
// Unified entry point
// ============================================================================

/**
 * Unified node placement — single entry point for all positioning paths.
 *
 * WITH parentNodeId:
 *   Angular seeding + collision-aware child placement (findBestPosition).
 *   Returns O.none if the parent has no position yet.
 *
 * WITHOUT parentNodeId:
 *   Graph centroid → hex-spiral free-slot search (400×400 min clearance).
 *   Always returns O.some.
 */
export function calculateNodePosition(
    graph: Graph,
    spatialIndex: SpatialIndex,
    parentNodeId?: NodeIdAndFilePath,
): O.Option<Position> {
    if (parentNodeId !== undefined) {
        const parentNode: GraphNode | undefined = graph.nodes[parentNodeId];
        if (!parentNode || !O.isSome(parentNode.nodeUIMetadata.position)) return O.none;
        const parentPos: Position = (parentNode.nodeUIMetadata.position as O.Some<Position>).value;
        const obstacles: readonly Obstacle[] = extractFromSpatialIndex(spatialIndex, parentPos, parentNodeId);
        return O.some(calculateCollisionAwareChildPosition(parentPos, graph, parentNodeId, obstacles));
    }

    const centroid: Position = computeGraphCentroid(graph);
    return O.some(findFreeSlotNearPosition(spatialIndex, centroid));
}