import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CytoscapeCore } from '@/graph-core/graphviz/CytoscapeCore';
import type { NodeDefinition, EdgeDefinition } from '@/graph-core/types';

describe('Degree-based node styling', () => {
  let container: HTMLElement;
  let cy: CytoscapeCore;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (cy) {
      cy.destroy();
    }
    document.body.removeChild(container);
  });

  it('should set degree attribute on all nodes', () => {
    const nodes: NodeDefinition[] = [
      { data: { id: 'A', label: 'Node A', linkedNodeIds: [] } },
      { data: { id: 'B', label: 'Node B', linkedNodeIds: [] } },
      { data: { id: 'C', label: 'Node C', linkedNodeIds: [] } },
    ];

    const edges: EdgeDefinition[] = [
      { data: { id: 'AB', source: 'A', target: 'B' } },
      { data: { id: 'AC', source: 'A', target: 'C' } },
    ];

    cy = new CytoscapeCore(container, [...nodes, ...edges], true /* headless */);

    const nodeA = cy.getCore().getElementById('A');
    const nodeB = cy.getCore().getElementById('B');
    const nodeC = cy.getCore().getElementById('C');

    console.log('Node A degree:', nodeA.data('degree'), 'actual degree:', nodeA.degree());
    console.log('Node B degree:', nodeB.data('degree'), 'actual degree:', nodeB.degree());
    console.log('Node C degree:', nodeC.data('degree'), 'actual degree:', nodeC.degree());

    // Node A connects to B and C, so degree = 2
    expect(nodeA.data('degree')).toBe(2);
    // Node B and C each connect to A only, so degree = 1
    expect(nodeB.data('degree')).toBe(1);
    expect(nodeC.data('degree')).toBe(1);
  });

  it('should apply width/height based on degree via mapData', () => {
    const nodes: NodeDefinition[] = [
      { data: { id: 'A', label: 'Node A', linkedNodeIds: [] } },
      { data: { id: 'B', label: 'Node B', linkedNodeIds: [] } },
    ];

    const edges: EdgeDefinition[] = [
      { data: { id: 'AB', source: 'A', target: 'B' } },
    ];

    cy = new CytoscapeCore(container, [...nodes, ...edges], true /* headless */);

    const nodeA = cy.getCore().getElementById('A');
    const nodeB = cy.getCore().getElementById('B');

    // Both nodes have degree 1
    expect(nodeA.data('degree')).toBe(1);
    expect(nodeB.data('degree')).toBe(1);

    // Check that they have the same size (since same degree)
    const aWidth = nodeA.width();
    const aHeight = nodeA.height();
    const bWidth = nodeB.width();
    const bHeight = nodeB.height();

    console.log('Node A dimensions:', { width: aWidth, height: aHeight });
    console.log('Node B dimensions:', { width: bWidth, height: bHeight });
    console.log('Node A computed style width:', nodeA.style('width'));
    console.log('Node A computed style height:', nodeA.style('height'));

    expect(aWidth).toBe(bWidth);
    expect(aHeight).toBe(bHeight);

    // Add more edges to increase A's degree
    const moreEdges: EdgeDefinition[] = [
      { data: { id: 'AC', source: 'A', target: 'C' } },
      { data: { id: 'AD', source: 'A', target: 'D' } },
    ];

    const moreNodes: NodeDefinition[] = [
      { data: { id: 'C', label: 'Node C', linkedNodeIds: [] } },
      { data: { id: 'D', label: 'Node D', linkedNodeIds: [] } },
    ];

    cy.addNodes(moreNodes);
    cy.addEdges(moreEdges);

    // Node A should now have degree 3
    expect(nodeA.data('degree')).toBe(3);

    const newAWidth = nodeA.width();
    const newAHeight = nodeA.height();

    // Log detailed information
    console.log('\n=== Degree Sizing Debug ===');
    console.log('Node A degree:', nodeA.data('degree'));
    console.log('Node B degree:', nodeB.data('degree'));
    console.log('Node A dimensions:', { width: newAWidth, height: newAHeight });
    console.log('Node B dimensions:', { width: nodeB.width(), height: nodeB.height() });
    console.log('Expected: Node A (degree 3) should be larger than Node B (degree 1)');

    // Node A should now be larger than Node B
    // If this fails, it means mapData isn't working
    expect(newAWidth).toBeGreaterThan(bWidth);
    expect(newAHeight).toBeGreaterThan(bHeight);
  });
});
