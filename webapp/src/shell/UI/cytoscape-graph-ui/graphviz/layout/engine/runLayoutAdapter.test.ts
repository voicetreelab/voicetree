import cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';
import { describe, expect, it } from 'vitest';
import type { LayoutEngine, LayoutConfig } from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/auto/autoLayoutTypes';
import { DEFAULT_OPTIONS, DEFAULT_FORCEATLAS2_OPTIONS, DEFAULT_PIVOTMDS_OPTIONS } from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/auto/autoLayoutTypes';
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

const createChain = (nodeCount: number): Core => cytoscape({
  headless: true,
  styleEnabled: true,
  style: [{ selector: 'node', style: { width: 80, height: 80 } }],
  elements: [
    ...Array.from({ length: nodeCount }, (_, index) => ({
      data: { id: `node-${index}` },
      position: { x: index, y: 0 },
    })),
    ...Array.from({ length: Math.max(0, nodeCount - 1) }, (_, index) => ({
      data: { id: `edge-${index}`, source: `node-${index}`, target: `node-${index + 1}` },
    })),
  ],
});

const medianEdgeLength = (cy: Core): number => {
  const lengths = cy.edges()
    .map((edge) => {
      const source = edge.source().position();
      const target = edge.target().position();
      return Math.hypot(target.x - source.x, target.y - source.y);
    })
    .filter((length) => length > 1e-6)
    .sort((left, right) => left - right);
  return lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0;
};

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
  pivotmds: DEFAULT_PIVOTMDS_OPTIONS,
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
  it.each<LayoutEngine>(['forceatlas2', 'combocombined', 'mindmap', 'pivotmds', 'webcola'])(
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

  it('keeps fixed nodes pinned when running the pivotmds backend', async () => {
    const cy = createChain(8);
    try {
      cy.getElementById('node-0').position({ x: -250, y: 75 });
      cy.getElementById('node-0').lock();
      await runLayoutAdapter({
        cy,
        eles: cy.elements(),
        config: configFor('pivotmds'),
        mode: 'full',
        fixedNodeIds: new Set(['node-0']),
      });

      expect(cy.getElementById('node-0').position()).toEqual({ x: -250, y: 75 });
      expectFinitePositions(cy);
    } finally {
      cy.destroy();
    }
  });

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

  it('scales ForceAtlas2 output so the median edge approaches the configured edgeLength', async () => {
    const target = 600;
    const layoutChain = async (edgeLength: number): Promise<number> => {
      const cy = createChain(12);
      try {
        await runLayoutAdapter({
          cy,
          eles: cy.elements(),
          config: {
            engine: 'forceatlas2',
            cola: configFor('forceatlas2').cola,
            forceatlas2: { ...DEFAULT_FORCEATLAS2_OPTIONS, edgeLength },
          },
          mode: 'full',
        });
        return medianEdgeLength(cy);
      } finally {
        cy.destroy();
      }
    };

    const scaledMedian = await layoutChain(target);
    const rawMedian = await layoutChain(0);

    // With scaling the median edge lands near the target (VPSC may nudge a few
    // edges, hence the band); without it the raw FA2 + finisher output is far
    // tighter. The contrast proves scale-then-separate, not the finisher, sets
    // the layout's scale.
    expect(scaledMedian).toBeGreaterThan(target * 0.6);
    expect(scaledMedian).toBeLessThan(target * 1.6);
    expect(scaledMedian).toBeGreaterThan(rawMedian * 2);
  });
});
