import cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';
import { describe, expect, it } from 'vitest';
import type { LayoutEngine, LayoutConfig } from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/auto/autoLayoutTypes';
import { DEFAULT_OPTIONS, DEFAULT_FORCEATLAS2_OPTIONS } from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/auto/autoLayoutTypes';
import { runLayoutAdapter } from './runLayoutAdapter';

const createGraph = (): Core => cytoscape({
  headless: true,
  elements: [
    { data: { id: 'root' }, position: { x: 0, y: 0 } },
    { data: { id: 'folder-a' }, position: { x: 40, y: 0 } },
    { data: { id: 'leaf-a' }, position: { x: 80, y: 0 } },
    { data: { id: 'leaf-b' }, position: { x: 120, y: 0 } },
    { data: { id: 'orphan' }, position: { x: 0, y: 80 } },
    { data: { id: 'edge-a', source: 'leaf-a', target: 'leaf-b' } },
    { data: { id: 'edge-b', source: 'leaf-b', target: 'orphan' } },
  ],
});

const createDenseGraph = (nodeCount: number): Core => cytoscape({
  headless: true,
  styleEnabled: true,
  style: [
    {
      selector: 'node',
      style: {
        width: 80,
        height: 80,
      },
    },
  ],
  elements: Array.from({ length: nodeCount }, (_, index) => ({
    data: { id: `node-${index}` },
    position: { x: 0, y: 0 },
  })),
});

const configFor = (engine: LayoutEngine): LayoutConfig => ({
  engine,
  cola: {
    ...DEFAULT_OPTIONS,
    animate: false,
    nodeSpacing: 80,
    edgeLength: 180,
    maxSimulationTime: 250,
  },
  forceatlas2: DEFAULT_FORCEATLAS2_OPTIONS,
});

const expectFinitePositions = (cy: Core): void => {
  cy.nodes().forEach((node): void => {
    const position = node.position();
    expect(Number.isFinite(position.x)).toBe(true);
    expect(Number.isFinite(position.y)).toBe(true);
  });
};

// Counts pairs of nodes whose true label-inclusive bounding boxes overlap by
// more than `epsilon` on BOTH axes (a real rectangular intersection, not the
// circular proxy the old finisher was tuned against).
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

describe('runLayoutAdapter', () => {
  it.each<LayoutEngine>(['forceatlas2', 'combocombined', 'mindmap', 'webcola'])(
    'runs the %s backend without producing invalid positions',
    async (engine) => {
      const cy = createGraph();
      try {
        await runLayoutAdapter({
          cy,
          eles: cy.elements(),
          config: configFor(engine),
          mode: 'full',
        });

        expectFinitePositions(cy);
      } finally {
        cy.destroy();
      }
    },
  );

  it.each<LayoutEngine>(['forceatlas2', 'combocombined'])(
    'leaves zero overlapping bounding boxes after the %s backend de-overlaps dense nodes',
    async (engine) => {
      const cy = createDenseGraph(24);
      try {
        await runLayoutAdapter({
          cy,
          eles: cy.elements(),
          config: configFor(engine),
          mode: 'full',
        });

        expectFinitePositions(cy);
        // The rectangular VPSC finisher converges to hard non-overlap; a 1px
        // epsilon only tolerates float noise, not the residual pile-ups the old
        // soft circular pass left behind.
        expect(countBoundingBoxOverlaps(cy, 1)).toBe(0);
      } finally {
        cy.destroy();
      }
    },
  );
});
