import type { Core, NodeSingular, CollectionReturnValue, EdgeSingular } from 'cytoscape';
import { queryNodesInRect } from '@/pure/graph/spatial';
import type { SpatialIndex, SpatialNodeEntry, Rect } from '@/pure/graph/spatial';
import type { LocalGeometry, EdgeSegment } from '@/pure/graph/geometry';
import { DEFAULT_EDGE_LENGTH } from './cytoscape-graph-constants';

/**
 * Expand a set of root nodes to their N-hop neighborhood.
 * Each iteration includes the closed neighborhood (node + all its direct neighbors).
 */
export function getNHopNeighborhood(roots: CollectionReturnValue, hops: number): CollectionReturnValue {
  let collection: CollectionReturnValue = roots;
  for (let i: number = 0; i < hops; i++) {
    collection = collection.closedNeighborhood();
  }
  // .filter() returns CollectionReturnValue (unlike .nodes() which returns NodeCollection)
  return collection.filter(ele => ele.isNode());
}

/**
 * Hop-by-hop BFS expansion with a hard cap on result size.
 * If any hop expansion exceeds maxNodes, trims to the closest nodes
 * by distance from the roots' centroid (roots are always kept).
 */
export function cappedBfsNeighborhood(
  roots: CollectionReturnValue,
  maxHops: number,
  maxNodes: number
): CollectionReturnValue {
  let visited: CollectionReturnValue = roots;
  for (let hop: number = 0; hop < maxHops; hop++) {
    const expanded: CollectionReturnValue = visited.closedNeighborhood().filter(
      ele => ele.isNode()
    );
    if (expanded.length > maxNodes) {
      // Trim: keep roots, fill remaining slots by distance from centroid
      const bb: { x1: number; y1: number; x2: number; y2: number } =
        roots.boundingBox({ includeLabels: false, includeOverlays: false, includeEdges: false });
      const cx: number = (bb.x1 + bb.x2) / 2;
      const cyPos: number = (bb.y1 + bb.y2) / 2;
      const nonRoots: CollectionReturnValue = expanded.difference(roots);
      const sorted: CollectionReturnValue = nonRoots.sort((a, b) => {
        const ap: { x: number; y: number } = (a as NodeSingular).position();
        const bp: { x: number; y: number } = (b as NodeSingular).position();
        return ((ap.x - cx) ** 2 + (ap.y - cyPos) ** 2)
             - ((bp.x - cx) ** 2 + (bp.y - cyPos) ** 2);
      });
      return roots.union(sorted.slice(0, Math.max(0, maxNodes - roots.length)));
    }
    visited = expanded;
  }
  return visited;
}

/**
 * Compute capped topology + spatial-only neighborhood for local Cola layout.
 *
 * Run set: 10-hop BFS capped at 50 (hard O(n²) bound for Cola).
 * Pin set: spatially nearby nodes from R-tree query only (no topology pins).
 * Spatial pins capped at MAX_PINS sorted by distance from run-set centroid.
 */
export function getLocalNeighborhood(
  cy: Core,
  newNodes: CollectionReturnValue,
  spatialIndex: SpatialIndex | undefined
): { runNodes: CollectionReturnValue; pinNodes: CollectionReturnValue } {
  const MAX_RUN_NODES: number = 50;
  const MAX_PINS: number = 30;

  // Run set: 3-hop BFS, capped at 50, non-context only
  const runNodes: CollectionReturnValue = cappedBfsNeighborhood(newNodes, 10, MAX_RUN_NODES)
    .filter(ele => !ele.data('isContextNode'));

  if (runNodes.length === 0) {
    return { runNodes, pinNodes: cy.collection() };
  }

  // Pin set: spatial R-tree query only (no topology pins)
  let pinNodes: CollectionReturnValue = cy.collection();

  if (spatialIndex) {
    const bb: { x1: number; y1: number; x2: number; y2: number } =
      runNodes.boundingBox({ includeLabels: false, includeOverlays: false, includeEdges: false });
    const centroidX: number = (bb.x1 + bb.x2) / 2;
    const centroidY: number = (bb.y1 + bb.y2) / 2;
    const halfDiag: number = Math.sqrt((bb.x2 - bb.x1) ** 2 + (bb.y2 - bb.y1) ** 2) / 2;
    const searchRadius: number = halfDiag + DEFAULT_EDGE_LENGTH * 3;

    const searchRect: { minX: number; minY: number; maxX: number; maxY: number } = {
      minX: centroidX - searchRadius,
      minY: centroidY - searchRadius,
      maxX: centroidX + searchRadius,
      maxY: centroidY + searchRadius,
    };

    const nearbyEntries: readonly SpatialNodeEntry[] = queryNodesInRect(spatialIndex, searchRect);
    const sortedEntries: SpatialNodeEntry[] = [...nearbyEntries].sort((a, b) =>
      (((a.minX + a.maxX) / 2 - centroidX) ** 2 + ((a.minY + a.maxY) / 2 - centroidY) ** 2)
      - (((b.minX + b.maxX) / 2 - centroidX) ** 2 + ((b.minY + b.maxY) / 2 - centroidY) ** 2));

    let spatialPinCount: number = 0;
    for (const entry of sortedEntries) {
      if (spatialPinCount >= MAX_PINS) break;
      const node: CollectionReturnValue = cy.getElementById(entry.nodeId);
      if (node.length > 0 && !runNodes.contains(node)
          && !pinNodes.contains(node) && !node.data('isContextNode')) {
        pinNodes = pinNodes.merge(node);
        spatialPinCount++;
      }
    }
  }

  return { runNodes, pinNodes };
}

/**
 * Extract plain geometry data from cytoscape collections for pure layout-correction check.
 * Shell boundary: reads cytoscape positions, produces immutable LocalGeometry.
 */
export function extractLocalGeometry(
    newNodes: CollectionReturnValue,
    subgraphEdges: CollectionReturnValue,
    runNodes: CollectionReturnValue
): LocalGeometry {
    const newEdgeSet: CollectionReturnValue = newNodes.connectedEdges().filter(
        (e: EdgeSingular) => subgraphEdges.contains(e)
    );
    const toSeg: (e: EdgeSingular) => EdgeSegment = (e: EdgeSingular): EdgeSegment => ({
        p1: (e.source() as NodeSingular).position(),
        p2: (e.target() as NodeSingular).position()
    });
    const toRect: (n: NodeSingular) => Rect = (n: NodeSingular): Rect => {
        const bb: { x1: number; y1: number; x2: number; y2: number } = n.boundingBox({
            includeLabels: false, includeOverlays: false, includeEdges: false
        });
        return { minX: bb.x1, minY: bb.y1, maxX: bb.x2, maxY: bb.y2 };
    };
    return {
        newEdges: newEdgeSet.map(toSeg),
        existingEdges: subgraphEdges.difference(newEdgeSet).map(toSeg),
        newNodeRects: newNodes.map(toRect),
        neighborRects: runNodes.difference(newNodes).map(toRect)
    };
}
