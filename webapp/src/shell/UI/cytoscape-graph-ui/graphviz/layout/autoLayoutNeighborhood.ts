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
 * Compute hybrid topology+spatial neighborhood for local Cola layout.
 *
 * Run set: 4-hop topology (Cola needs edges for force computation).
 * Pin set: 6-hop topology boundary ∪ spatially nearby nodes from R-tree query.
 * Both topology and spatial pin sets are capped at MAX_PINS each (sorted by
 * distance from run-set centroid) to bound Cola's O(n²) iteration cost.
 */
export function getLocalNeighborhood(
  cy: Core,
  newNodes: CollectionReturnValue,
  spatialIndex: SpatialIndex | undefined
): { runNodes: CollectionReturnValue; pinNodes: CollectionReturnValue } {
  const MAX_PINS: number = 30;

  // Run set: 4-hop topology, filtered for non-context nodes (Cola needs edge structure)
  const runNodes: CollectionReturnValue = getNHopNeighborhood(newNodes, 4).filter(
    ele => !ele.data('isContextNode')
  );

  // Topology pins: hop 5-6 boundary anchors
  const allTopologyNodes: CollectionReturnValue = getNHopNeighborhood(newNodes, 6).filter(
    ele => !ele.data('isContextNode')
  );
  let pinNodes: CollectionReturnValue = allTopologyNodes.difference(runNodes);

  // Compute run-set bounding box centroid (reused for topology cap + spatial query)
  if (runNodes.length === 0) {
    return { runNodes, pinNodes };
  }
  const bb: { x1: number; y1: number; x2: number; y2: number } = runNodes.boundingBox({
    includeLabels: false, includeOverlays: false, includeEdges: false
  });
  const centroidX: number = (bb.x1 + bb.x2) / 2;
  const centroidY: number = (bb.y1 + bb.y2) / 2;

  // Cap topology pins at MAX_PINS, keeping closest to run-set centroid
  if (pinNodes.length > MAX_PINS) {
    pinNodes = pinNodes.sort((a, b) => {
      const aPos: { x: number; y: number } = (a as NodeSingular).position();
      const bPos: { x: number; y: number } = (b as NodeSingular).position();
      return ((aPos.x - centroidX) ** 2 + (aPos.y - centroidY) ** 2)
           - ((bPos.x - centroidX) ** 2 + (bPos.y - centroidY) ** 2);
    }).slice(0, MAX_PINS);
  }

  // Spatial augmentation: merge nearby nodes from R-tree when index available
  if (spatialIndex) {
    const halfDiag: number = Math.sqrt((bb.x2 - bb.x1) ** 2 + (bb.y2 - bb.y1) ** 2) / 2;
    const searchRadius: number = halfDiag + DEFAULT_EDGE_LENGTH * 3;

    const searchRect: { minX: number; minY: number; maxX: number; maxY: number } = {
      minX: centroidX - searchRadius,
      minY: centroidY - searchRadius,
      maxX: centroidX + searchRadius,
      maxY: centroidY + searchRadius,
    };

    const nearbyEntries: readonly SpatialNodeEntry[] = queryNodesInRect(spatialIndex, searchRect);

    // Sort by distance from centroid, closest first; cap at MAX_PINS new spatial pins
    const sortedEntries: SpatialNodeEntry[] = [...nearbyEntries].sort((a, b) => {
      return (((a.minX + a.maxX) / 2 - centroidX) ** 2 + ((a.minY + a.maxY) / 2 - centroidY) ** 2)
           - (((b.minX + b.maxX) / 2 - centroidX) ** 2 + ((b.minY + b.maxY) / 2 - centroidY) ** 2);
    });

    let spatialPinCount: number = 0;
    for (const entry of sortedEntries) {
      if (spatialPinCount >= MAX_PINS) break;
      const node: CollectionReturnValue = cy.getElementById(entry.nodeId);
      if (node.length > 0 && !runNodes.contains(node) && !pinNodes.contains(node) && !node.data('isContextNode')) {
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
