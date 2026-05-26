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
});
