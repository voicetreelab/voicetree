import { Page } from '@playwright/test';
import { ExtendedWindow } from './test-utils';

interface Position {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LayoutQuality {
  nodeCount: number;
  edgeCount: number;
  minDistance: number;
  closeNodes: Array<{ node1: string; node2: string; distance: number }>;
  edgeOverlaps: Array<{ edge1: string; edge2: string }>;
  graphSpread: { width: number; height: number };
  positions: Position[];
}

/**
 * Check layout quality including node spacing and edge overlaps
 */
export async function checkLayoutQuality(appWindow: Page): Promise<LayoutQuality> {
  return appWindow.evaluate(() => {
    const w = window as ExtendedWindow;
    const cy = w.cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not initialized');

    const nodes = cy.nodes();
    const edges = cy.edges();

    // Calculate minimum distance between all node pairs
    let minDistance = Infinity;
    const positions: Position[] = [];

    for (let i = 0; i < nodes.length; i++) {
      const n1 = nodes[i];
      const pos1 = n1.position();
      const bb1 = n1.boundingBox({ includeLabels: false });
      positions.push({
        id: n1.id(),
        x: pos1.x,
        y: pos1.y,
        width: bb1.w,
        height: bb1.h
      });

      for (let j = i + 1; j < nodes.length; j++) {
        const n2 = nodes[j];
        const pos2 = n2.position();
        const distance = Math.hypot(pos1.x - pos2.x, pos1.y - pos2.y);
        if (distance < minDistance) {
          minDistance = distance;
        }
      }
    }

    // Check for overlapping nodes
    const MINIMUM_NODE_DISTANCE = 50;
    const closeNodes: Array<{ node1: string; node2: string; distance: number }> = [];
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dist = Math.hypot(
          positions[i].x - positions[j].x,
          positions[i].y - positions[j].y
        );
        if (dist < MINIMUM_NODE_DISTANCE) {
          closeNodes.push({
            node1: positions[i].id,
            node2: positions[j].id,
            distance: dist
          });
        }
      }
    }

    // Check for edge overlaps
    const edgeOverlaps: Array<{ edge1: string; edge2: string }> = [];
    for (let i = 0; i < edges.length; i++) {
      const e1 = edges[i];
      const e1Source = e1.source().position();
      const e1Target = e1.target().position();

      for (let j = i + 1; j < edges.length; j++) {
        const e2 = edges[j];
        const e2Source = e2.source().position();
        const e2Target = e2.target().position();

        // Skip adjacent edges
        const shareNode =
          e1.source().id() === e2.source().id() ||
          e1.source().id() === e2.target().id() ||
          e1.target().id() === e2.source().id() ||
          e1.target().id() === e2.target().id();

        if (!shareNode && checkSegmentsClose(e1Source, e1Target, e2Source, e2Target, 10)) {
          edgeOverlaps.push({
            edge1: `${e1.source().id()}->${e1.target().id()}`,
            edge2: `${e2.source().id()}->${e2.target().id()}`
          });
        }
      }
    }

    // Check graph spread
    const allX = positions.map(p => p.x);
    const allY = positions.map(p => p.y);

    return {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      minDistance,
      closeNodes,
      edgeOverlaps,
      graphSpread: {
        width: Math.max(...allX) - Math.min(...allX),
        height: Math.max(...allY) - Math.min(...allY)
      },
      positions
    };

    function checkSegmentsClose(
      p1: { x: number; y: number },
      p2: { x: number; y: number },
      p3: { x: number; y: number },
      p4: { x: number; y: number },
      threshold: number
    ): boolean {
      const dist1 = pointToSegmentDistance(p3, p1, p2);
      const dist2 = pointToSegmentDistance(p4, p1, p2);
      const dist3 = pointToSegmentDistance(p1, p3, p4);
      const dist4 = pointToSegmentDistance(p2, p3, p4);
      return Math.min(dist1, dist2, dist3, dist4) < threshold;
    }

    function pointToSegmentDistance(
      p: { x: number; y: number },
      a: { x: number; y: number },
      b: { x: number; y: number }
    ): number {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy;

      if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);

      let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));

      const closestX = a.x + t * dx;
      const closestY = a.y + t * dy;

      return Math.hypot(p.x - closestX, p.y - closestY);
    }
  });
}
