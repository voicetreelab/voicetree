/**
 * Local Cola layout: incremental refinement on the neighborhood of newly added nodes.
 *
 * Extracted from autoLayout.ts to keep file sizes manageable.
 * Run set: 2-hop BFS capped at 50 (free to move).
 * Pin set: spatial R-tree boundary (locked anchors).
 * Uses fast-tier Cola (5/5/8 iterations) — packing handles disconnected components.
 * Post-Cola overlap resolution pushes run-set nodes away from non-subgraph nodes.
 * On completion, unlocks pins and chains to onComplete.
 */

import type { Core, NodeSingular, CollectionReturnValue } from 'cytoscape';
import { computeColaAndAnimate } from './computeColaAndAnimate';
import { refreshSpatialIndex, getCurrentIndex } from '@/shell/UI/cytoscape-graph-ui/services/spatialIndexSync';
import { queryNodesInRect } from '@/pure/graph/spatial';
import type { SpatialIndex, SpatialNodeEntry } from '@/pure/graph/spatial';
import type { AutoLayoutOptions } from './autoLayoutTypes';
import { DEFAULT_OPTIONS, COLA_FAST_ANIMATE_DURATION } from './autoLayoutTypes';
import { getLocalNeighborhood } from './autoLayoutNeighborhood';

/**
 * Run Cola on the local neighborhood of newly added nodes.
 *
 * @param cy - Cytoscape instance
 * @param newNodeIds - Set of newly added node IDs to center the local layout on
 * @param colaConfig - Current Cola layout options (from settings)
 * @param onComplete - Called when local Cola finishes
 */
export function runLocalCola(
  cy: Core,
  newNodeIds: Set<string>,
  colaConfig: AutoLayoutOptions,
  onComplete: () => void,
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

  // Capped topology + spatial-only neighborhood selection
  const { runNodes, pinNodes } = getLocalNeighborhood(cy, newNodes, getCurrentIndex(cy));
  pinNodes.lock();
  const allNodes: CollectionReturnValue = runNodes.union(pinNodes);

  // Collect edges where both endpoints are in the subgraph, excluding indicator edges
  const subgraphEdges: CollectionReturnValue = allNodes.connectedEdges().filter(
    edge => !edge.data('isIndicatorEdge')
      && allNodes.contains(edge.source()) && allNodes.contains(edge.target())
  );

  // Fast-tier Cola (5/5/8 iterations, sub-100ms with <=50 nodes)
  // Enough iterations for the overlap constraint solver to fully converge
  computeColaAndAnimate({
    cy: cy,
    eles: allNodes.union(subgraphEdges),
    randomize: false,
    avoidOverlap: true,
    handleDisconnected: false,
    convergenceThreshold: 1.5,
    maxSimulationTime: 200,
    unconstrIter: 5,
    userConstIter: 5,
    allConstIter: 8,
    nodeSpacing: 120,
    edgeLength: colaConfig.edgeLength ?? DEFAULT_OPTIONS.edgeLength,
    centerGraph: false,
    fit: false,
    nodeDimensionsIncludeLabels: true,
  }, runNodes, COLA_FAST_ANIMATE_DURATION, () => {
    pinNodes.unlock();
    refreshSpatialIndex(cy);

    // Post-Cola overlap resolution: multi-pass (max 3 iterations).
    // Cola only avoids overlaps within its subgraph. Run-set nodes may overlap
    // non-subgraph nodes. Pushing node A away from B may cause overlap with C.
    const MAX_OVERLAP_PASSES: number = 3;
    for (let pass: number = 0; pass < MAX_OVERLAP_PASSES; pass++) {
      const postIndex: SpatialIndex | undefined = getCurrentIndex(cy);
      if (!postIndex) break;
      let didResolve: boolean = false;
      runNodes.forEach((node: NodeSingular) => {
        const bb: { x1: number; y1: number; x2: number; y2: number; w: number; h: number } = node.boundingBox({ includeLabels: false, includeOverlays: false, includeEdges: false });
        const nearby: readonly SpatialNodeEntry[] = queryNodesInRect(postIndex, { minX: bb.x1, minY: bb.y1, maxX: bb.x2, maxY: bb.y2 });
        for (const entry of nearby) {
          if (entry.nodeId === node.id()) continue;
          const other: CollectionReturnValue = cy.getElementById(entry.nodeId);
          if (other.length === 0 || allNodes.contains(other) || other.data('isContextNode')) continue;
          // Overlap with a non-subgraph node — push the run node away
          const nodeCx: number = (bb.x1 + bb.x2) / 2;
          const nodeCy: number = (bb.y1 + bb.y2) / 2;
          const otherCx: number = (entry.minX + entry.maxX) / 2;
          const otherCy: number = (entry.minY + entry.maxY) / 2;
          let dx: number = nodeCx - otherCx;
          let dy: number = nodeCy - otherCy;
          const dist: number = Math.sqrt(dx * dx + dy * dy);
          if (dist < 0.01) { dx = 1; dy = 0; }
          else { dx /= dist; dy /= dist; }
          const overlapW: number = Math.min(bb.x2, entry.maxX) - Math.max(bb.x1, entry.minX);
          const overlapH: number = Math.min(bb.y2, entry.maxY) - Math.max(bb.y1, entry.minY);
          const pushDist: number = Math.max(overlapW, overlapH) + 20;
          node.shift({ x: dx * pushDist, y: dy * pushDist });
          didResolve = true;
          break; // one push per node per pass
        }
      });
      if (!didResolve) break;
      refreshSpatialIndex(cy);
    }

    onComplete();
  });
}
