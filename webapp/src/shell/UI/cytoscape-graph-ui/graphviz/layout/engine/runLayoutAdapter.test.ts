import cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';
import { describe, expect, it } from 'vitest';
import type { LayoutEngine, LayoutConfig } from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/auto/autoLayoutTypes';
import { DEFAULT_OPTIONS } from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/auto/autoLayoutTypes';
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
});

const expectFinitePositions = (cy: Core): void => {
  cy.nodes().forEach((node): void => {
    const position = node.position();
    expect(Number.isFinite(position.x)).toBe(true);
    expect(Number.isFinite(position.y)).toBe(true);
  });
};

const countOverlaps = (cy: Core, minDistance: number): number => {
  const positions = cy.nodes().map((node) => node.position());
  let overlaps = 0;
  for (let left = 0; left < positions.length; left += 1) {
    for (let right = left + 1; right < positions.length; right += 1) {
      const dx = positions[left].x - positions[right].x;
      const dy = positions[left].y - positions[right].y;
      if (Math.hypot(dx, dy) < minDistance) overlaps += 1;
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

  it('keeps the ForceAtlas2 backend from leaving dense nodes piled up', async () => {
    const cy = createDenseGraph(24);
    try {
      await runLayoutAdapter({
        cy,
        eles: cy.elements(),
        config: configFor('forceatlas2'),
        mode: 'full',
      });

      expectFinitePositions(cy);
      expect(countOverlaps(cy, 40)).toBeLessThan(10);
    } finally {
      cy.destroy();
    }
  });
});
