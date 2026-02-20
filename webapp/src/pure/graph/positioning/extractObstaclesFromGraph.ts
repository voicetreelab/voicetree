/**
 * Pure obstacle extraction from graph data.
 *
 * Derives obstacle bounding boxes from node positions in the graph,
 * without requiring cytoscape. Used when cytoscape is unavailable
 * (e.g., main process FS event handling).
 *
 * Obstacle dimensions are estimated since rendered sizes aren't known
 * in pure context. This provides approximate collision avoidance.
 */

import type {Graph, GraphNode, NodeIdAndFilePath, Position} from "@/pure/graph";
import type {ObstacleBBox} from "@/pure/graph/positioning/findBestPosition";
import {boxObstacle, segmentObstacle} from "@/pure/graph/positioning/findBestPosition";
import type {Obstacle} from "@/pure/graph/positioning/findBestPosition";
import type {EdgeSegment} from "@/pure/graph/geometry";
import * as O from 'fp-ts/lib/Option.js';

/** Estimated dimensions for a typical graph node (approximate rendered size). */
const ESTIMATED_NODE_DIMENSIONS: { readonly width: number; readonly height: number } = { width: 200, height: 60 };

/**
 * Get immediate neighbors of a node (both outgoing and incoming).
 */
function getNeighborIds(nodeId: NodeIdAndFilePath, graph: Graph): readonly NodeIdAndFilePath[] {
    const node: GraphNode | undefined = graph.nodes[nodeId];
    if (!node) return [];

    const outgoing: readonly NodeIdAndFilePath[] = node.outgoingEdges.map(e => e.targetId);
    const incoming: readonly NodeIdAndFilePath[] = graph.incomingEdgesIndex.get(nodeId) ?? [];
    return [...outgoing, ...incoming];
}

/**
 * Expand a set of node IDs by one hop (adding all neighbors not already visited).
 */
function expandOneHop(
    visited: ReadonlySet<NodeIdAndFilePath>,
    frontier: ReadonlySet<NodeIdAndFilePath>,
    graph: Graph
): { readonly visited: ReadonlySet<NodeIdAndFilePath>; readonly frontier: ReadonlySet<NodeIdAndFilePath> } {
    const newVisited: ReadonlySet<NodeIdAndFilePath> = new Set([...visited, ...frontier]);
    const nextFrontier: ReadonlySet<NodeIdAndFilePath> = new Set(
        [...frontier]
            .flatMap((nodeId: NodeIdAndFilePath) => getNeighborIds(nodeId, graph))
            .filter((id: NodeIdAndFilePath) => !(newVisited as ReadonlySet<NodeIdAndFilePath>).has(id))
    );
    return { visited: newVisited, frontier: nextFrontier };
}

/**
 * Collect all node IDs within N hops via BFS (both edge directions).
 */
function collectNeighborhood(
    startNodeId: NodeIdAndFilePath,
    graph: Graph,
    hops: number
): ReadonlySet<NodeIdAndFilePath> {
    const initial: { readonly visited: ReadonlySet<NodeIdAndFilePath>; readonly frontier: ReadonlySet<NodeIdAndFilePath> } = {
        visited: new Set<NodeIdAndFilePath>(),
        frontier: new Set<NodeIdAndFilePath>([startNodeId])
    };

    const result: { readonly visited: ReadonlySet<NodeIdAndFilePath>; readonly frontier: ReadonlySet<NodeIdAndFilePath> } =
        Array.from({ length: hops }).reduce(
            (acc: { readonly visited: ReadonlySet<NodeIdAndFilePath>; readonly frontier: ReadonlySet<NodeIdAndFilePath> }) =>
                expandOneHop(acc.visited, acc.frontier, graph),
            initial
        );

    return new Set([...result.visited, ...result.frontier]);
}

/**
 * Extract obstacle bounding boxes from the graph neighborhood of a node.
 * Performs a 5-hop BFS traversal using both outgoing edges and the incoming edges index.
 * Excludes the parent node itself from the obstacle set.
 *
 * @param parentNodeId - The node to find neighbors around
 * @param graph - The graph to traverse
 * @returns Obstacle bounding boxes for nearby nodes that have positions
 */
export function extractObstaclesFromGraph(
    parentNodeId: NodeIdAndFilePath,
    graph: Graph
): readonly ObstacleBBox[] {
    if (!graph.nodes[parentNodeId]) return [];

    const neighborhood: ReadonlySet<NodeIdAndFilePath> = collectNeighborhood(parentNodeId, graph, 5);

    return [...neighborhood]
        .filter((nodeId: NodeIdAndFilePath) => nodeId !== parentNodeId)
        .map((nodeId: NodeIdAndFilePath) => graph.nodes[nodeId])
        .filter((node: GraphNode | undefined): node is GraphNode => node !== undefined && O.isSome(node.nodeUIMetadata.position))
        .map((node: GraphNode): ObstacleBBox => {
            const pos: Position = (node.nodeUIMetadata.position as O.Some<Position>).value;
            return {
                x1: pos.x - ESTIMATED_NODE_DIMENSIONS.width / 2,
                x2: pos.x + ESTIMATED_NODE_DIMENSIONS.width / 2,
                y1: pos.y - ESTIMATED_NODE_DIMENSIONS.height / 2,
                y2: pos.y + ESTIMATED_NODE_DIMENSIONS.height / 2,
            };
        });
}

/**
 * Extract edge line segments from the graph neighborhood of a node.
 * Uses the same 5-hop BFS as obstacle extraction.
 * Returns segments for all edges where both source and target have positions.
 */
export function extractEdgeSegmentsFromGraph(
    parentNodeId: NodeIdAndFilePath,
    graph: Graph
): readonly EdgeSegment[] {
    if (!graph.nodes[parentNodeId]) return [];

    const neighborhood: ReadonlySet<NodeIdAndFilePath> = collectNeighborhood(parentNodeId, graph, 5);

    return [...neighborhood].flatMap((nodeId: NodeIdAndFilePath): readonly EdgeSegment[] => {
        const node: GraphNode | undefined = graph.nodes[nodeId];
        if (!node || !O.isSome(node.nodeUIMetadata.position)) return [];
        const sourcePos: Position = (node.nodeUIMetadata.position as O.Some<Position>).value;

        return node.outgoingEdges
            .map((edge): EdgeSegment | null => {
                const targetNode: GraphNode | undefined = graph.nodes[edge.targetId];
                if (!targetNode || !O.isSome(targetNode.nodeUIMetadata.position)) return null;
                const targetPos: Position = (targetNode.nodeUIMetadata.position as O.Some<Position>).value;
                return { p1: sourcePos, p2: targetPos };
            })
            .filter((seg): seg is EdgeSegment => seg !== null);
    });
}

/**
 * Extract a unified obstacle array (node bboxes + edge segments) from the graph.
 * Combines both obstacle types into one array for single-pass collision detection.
 */
export function extractAllObstaclesFromGraph(
    parentNodeId: NodeIdAndFilePath,
    graph: Graph
): readonly Obstacle[] {
    const boxes: readonly Obstacle[] = extractObstaclesFromGraph(parentNodeId, graph).map(boxObstacle);
    const segments: readonly Obstacle[] = extractEdgeSegmentsFromGraph(parentNodeId, graph).map(segmentObstacle);
    return [...boxes, ...segments];
}
