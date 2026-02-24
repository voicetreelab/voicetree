/**
 * Local Cola layout: incremental refinement on the neighborhood of newly added nodes.
 *
 * Extracted from autoLayout.ts to keep file sizes manageable.
 * Hop 1-4: run set (free to move) — Cola can rearrange the local region.
 * Hop 5-6: pin boundary (locked anchors) — prevents ripple to distant nodes.
 * On completion, unlocks pins and chains to onComplete.
 * Falls back to a global Cola pass if edge crossings are detected post-layout.
 */

import type { Core, CollectionReturnValue } from 'cytoscape';
import { computeColaAndAnimate } from './computeColaAndAnimate';
import { refreshSpatialIndex, getCurrentIndex } from '@/shell/UI/cytoscape-graph-ui/services/spatialIndexSync';
import { queryEdgesInRect } from '@/pure/graph/spatial';
import type { SpatialIndex, SpatialEdgeEntry } from '@/pure/graph/spatial';
import { needsLayoutCorrection, hasEdgeCrossingsAmong } from '@/pure/graph/geometry';
import type { LocalGeometry, EdgeSegment } from '@/pure/graph/geometry';
import type { AutoLayoutOptions } from './autoLayoutTypes';
import { DEFAULT_OPTIONS, COLA_ANIMATE_DURATION, COLA_FAST_ANIMATE_DURATION } from './autoLayoutTypes';
import { getLocalNeighborhood, extractLocalGeometry } from './autoLayoutNeighborhood';

/**
 * Run Cola on the local neighborhood of newly added nodes.
 *
 * @param cy - Cytoscape instance
 * @param newNodeIds - Set of newly added node IDs to center the local layout on
 * @param colaConfig - Current Cola layout options (from settings)
 * @param onComplete - Called when local Cola finishes without needing global fallback
 * @param runGlobalColaFallback - Called when edge crossings are detected post-layout;
 *   caller should run a full global Cola pass to resolve them
 */
export function runLocalCola(
  cy: Core,
  newNodeIds: Set<string>,
  colaConfig: AutoLayoutOptions,
  onComplete: () => void,
  runGlobalColaFallback: () => void,
): void {
  // Collect cy nodes for the new IDs, skip context nodes
  let newNodes: CollectionReturnValue = cy.collection();
  for (const id of newNodeIds) {
    const node: CollectionReturnValue = cy.getElementById(id);
    if (node.length > 0 && !node.data('isContextNode')) {
      newNodes = newNodes.merge(node);
    }
  }

  if (newNodes.length === 0) {
    onComplete();
    return;
  }

  // Hybrid topology+spatial neighborhood selection
  const { runNodes, pinNodes } = getLocalNeighborhood(cy, newNodes, getCurrentIndex(cy));
  pinNodes.lock();
  const allNodes: CollectionReturnValue = runNodes.union(pinNodes);

  // Collect edges where both endpoints are in the subgraph, excluding indicator edges
  const subgraphEdges: CollectionReturnValue = allNodes.connectedEdges().filter(
    edge => !edge.data('isIndicatorEdge')
      && allNodes.contains(edge.source()) && allNodes.contains(edge.target())
  );
  const subgraphElements: CollectionReturnValue = allNodes.union(subgraphEdges);

  // Check for edge crossings or node overlaps in the local region
  const geo: LocalGeometry = extractLocalGeometry(newNodes, subgraphEdges, runNodes);
  if (!needsLayoutCorrection(geo)) {
    // Fast-tier: no overlap — light Cola pass for edge-length polish
    computeColaAndAnimate({
      cy: cy,
      eles: subgraphElements,
      randomize: false,
      avoidOverlap: true,
      handleDisconnected: false,
      convergenceThreshold: 1.5,
      maxSimulationTime: 200,
      unconstrIter: 3,
      userConstIter: 3,
      allConstIter: 5,
      nodeSpacing: 120,
      edgeLength: colaConfig.edgeLength ?? DEFAULT_OPTIONS.edgeLength,
      centerGraph: false,
      fit: false,
      nodeDimensionsIncludeLabels: true,
    }, runNodes, COLA_FAST_ANIMATE_DURATION, () => {
      pinNodes.unlock();
      refreshSpatialIndex(cy);
      onComplete();
    });
    return;
  }

  computeColaAndAnimate({
    cy: cy,
    eles: subgraphElements,
    randomize: false,
    avoidOverlap: true,
    handleDisconnected: false,
    convergenceThreshold: 0.5,
    maxSimulationTime: 800,
    unconstrIter: 12,
    userConstIter: 12,
    allConstIter: 20,
    nodeSpacing: 120,
    edgeLength: colaConfig.edgeLength ?? DEFAULT_OPTIONS.edgeLength,
    centerGraph: false,
    fit: false,
    nodeDimensionsIncludeLabels: true,
  }, runNodes, COLA_ANIMATE_DURATION, () => {
    pinNodes.unlock();

    // Rebuild spatial index with post-animation positions (layoutstop rebuild is stale
    // because computeColaAndAnimate resets to startPos during animation)
    refreshSpatialIndex(cy);

    const postColaIndex: SpatialIndex | undefined = getCurrentIndex(cy);
    if (postColaIndex) {
      // Query edges in the region affected by local Cola
      const regionBB: { x1: number; y1: number; x2: number; y2: number } = allNodes.boundingBox({
        includeLabels: false, includeOverlays: false, includeEdges: false
      });
      const edgesInRegion: readonly SpatialEdgeEntry[] = queryEdgesInRect(postColaIndex, {
        minX: regionBB.x1, minY: regionBB.y1,
        maxX: regionBB.x2, maxY: regionBB.y2
      });

      // Convert spatial entries to EdgeSegments for intersection testing
      const segments: EdgeSegment[] = edgesInRegion.map(e => ({
        p1: { x: e.x1, y: e.y1 },
        p2: { x: e.x2, y: e.y2 }
      }));

      if (hasEdgeCrossingsAmong(segments)) {
        // Edge overlaps found in local region — run global Cola to resolve
        runGlobalColaFallback();
        return;
      }
    }

    onComplete();
  });
}
