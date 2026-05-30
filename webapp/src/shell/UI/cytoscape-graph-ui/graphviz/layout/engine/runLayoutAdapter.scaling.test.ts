import cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';
import { describe, expect, it } from 'vitest';
import type { LayoutConfig } from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/auto/autoLayoutTypes';
import { DEFAULT_OPTIONS } from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/auto/autoLayoutTypes';
import { runLayoutAdapter } from './runLayoutAdapter';

// Wide rectangular cards (w >> h), the realistic VoiceTree node shape, packed
// in a dense cluster and lightly chained so ForceAtlas2 has structure to lay
// out. This is the worst case for a circular finisher and the exact scenario
// the rectangular VPSC finisher must resolve at scale.
const createDenseChainedGraph = (nodeCount: number): Core => cytoscape({
  headless: true,
  styleEnabled: true,
  style: [{ selector: 'node', style: { width: 300, height: 80 } }],
  elements: [
    ...Array.from({ length: nodeCount }, (_, index) => ({
      data: { id: `node-${index}` },
      position: { x: (index % 7) * 4, y: Math.floor(index / 7) * 3 },
    })),
    ...Array.from({ length: Math.max(0, nodeCount - 1) }, (_, index) => ({
      data: { id: `edge-${index}`, source: `node-${index}`, target: `node-${index + 1}` },
    })),
  ],
});

const config: LayoutConfig = {
  engine: 'forceatlas2',
  cola: { ...DEFAULT_OPTIONS, animate: false, nodeSpacing: 80, edgeLength: 180, maxSimulationTime: 250 },
};

const countBoundingBoxOverlaps = (cy: Core, epsilon: number): number => {
  const boxes = cy.nodes().map((node) => (
    node.boundingBox({ includeLabels: true, includeOverlays: false, includeEdges: false })
  ));
  let overlaps = 0;
  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      const overlapX = Math.min(boxes[left].x2, boxes[right].x2) - Math.max(boxes[left].x1, boxes[right].x1);
      const overlapY = Math.min(boxes[left].y2, boxes[right].y2) - Math.max(boxes[left].y1, boxes[right].y1);
      if (overlapX > epsilon && overlapY > epsilon) overlaps += 1;
    }
  }
  return overlaps;
};

type ScalePoint = { readonly nodeCount: number; readonly ms: number; readonly overlaps: number };

const layoutAt = async (nodeCount: number): Promise<ScalePoint> => {
  const cy = createDenseChainedGraph(nodeCount);
  try {
    const start = performance.now();
    await runLayoutAdapter({ cy, eles: cy.elements(), config, mode: 'full' });
    const ms = performance.now() - start;
    return { nodeCount, ms, overlaps: countBoundingBoxOverlaps(cy, 1) };
  } finally {
    cy.destroy();
  }
};

describe('runLayoutAdapter ForceAtlas2 scaling', () => {
  // 60s: four full FA2 + VPSC runs up to 2000 nodes on a headless core.
  it('stays overlap-free and sub-quadratic as node count doubles', async () => {
    const counts = [250, 500, 1000, 2000];
    const points: ScalePoint[] = [];
    for (const nodeCount of counts) {
      // eslint-disable-next-line no-await-in-loop
      points.push(await layoutAt(nodeCount));
    }

    // eslint-disable-next-line no-console
    console.log('[FA2 scaling]', points.map((p) => `n=${p.nodeCount}: ${p.ms.toFixed(0)}ms, ${p.overlaps} overlaps`).join(' | '));

    // (a) The hard goal: zero overlapping bounding boxes at every scale.
    for (const point of points) {
      expect(point.overlaps, `n=${point.nodeCount} must be overlap-free`).toBe(0);
    }

    // (b) Sub-quadratic: doubling node count must NOT ~quadruple the time.
    // Quadratic would give a ratio ~4x per doubling; we allow a generous 3.0x
    // ceiling to absorb constant-factor and timer noise while still failing hard
    // if an O(n^2) all-pairs loop ever creeps back in. Only measure on points
    // large enough that wall-clock dominates timer granularity.
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      if (previous.ms < 5) continue;
      const ratio = current.ms / previous.ms;
      // eslint-disable-next-line no-console
      console.log(`[FA2 scaling] n ${previous.nodeCount}->${current.nodeCount}: ${ratio.toFixed(2)}x time`);
      expect(ratio, `doubling ${previous.nodeCount}->${current.nodeCount} must stay sub-quadratic`).toBeLessThan(3.0);
    }
  }, 60000);
});
