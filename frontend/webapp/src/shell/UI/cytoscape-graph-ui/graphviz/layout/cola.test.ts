import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import cytoscape from 'cytoscape';
import * as cola from 'webcola';

// Import the ColaLayout constructor
import ColaLayout from './cola';

// Type for the ColaLayout constructor and instance
type ColaLayoutOptions = {
  cy: cytoscape.Core;
  eles: cytoscape.Collection;
  animate: boolean;
  maxSimulationTime: number;
};

type ColaLayoutInstance = {
  run: () => void;
};

type ColaLayoutConstructor = new (options: ColaLayoutOptions) => ColaLayoutInstance;

describe('ColaLayout', () => {
  let cy: cytoscape.Core;
  let mockAdaptor: {
    nodes: ReturnType<typeof vi.fn>;
    links: ReturnType<typeof vi.fn>;
    groups: ReturnType<typeof vi.fn>;
    size: ReturnType<typeof vi.fn>;
    linkDistance: ReturnType<typeof vi.fn>;
    avoidOverlaps: ReturnType<typeof vi.fn>;
    handleDisconnected: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    drag: ReturnType<typeof vi.fn>;
    constraints: ReturnType<typeof vi.fn>;
    convergenceThreshold: ReturnType<typeof vi.fn>;
    alpha: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    dragstart: ReturnType<typeof vi.fn>;
    dragend: ReturnType<typeof vi.fn>;
    tick: ReturnType<typeof vi.fn>;
  };
  let capturedLinks: unknown[];

  beforeEach(() => {
    capturedLinks = [];

    // Create mock adaptor that captures the links passed to it
    mockAdaptor = {
      nodes: vi.fn().mockReturnThis(),
      links: vi.fn().mockImplementation((links: unknown[]) => {
        capturedLinks = links;
        return mockAdaptor;
      }),
      groups: vi.fn().mockReturnThis(),
      size: vi.fn().mockReturnThis(),
      linkDistance: vi.fn().mockReturnThis(),
      avoidOverlaps: vi.fn().mockReturnThis(),
      handleDisconnected: vi.fn().mockReturnThis(),
      start: vi.fn().mockReturnThis(),
      stop: vi.fn(),
      on: vi.fn(),
      drag: vi.fn(),
      constraints: vi.fn().mockReturnThis(),
      convergenceThreshold: vi.fn().mockReturnThis(),
      alpha: vi.fn().mockReturnValue(0),
      resume: vi.fn(),
      dragstart: vi.fn(),
      dragend: vi.fn(),
      tick: vi.fn().mockReturnValue(true), // Return true to indicate convergence (end simulation)
    };

    // Mock the cola.adaptor function
    vi.spyOn(cola, 'adaptor').mockReturnValue(mockAdaptor as unknown as cola.LayoutAdaptor);
  });

  afterEach(() => {
    if (cy) {
      cy.destroy();
    }
    vi.restoreAllMocks();
  });

  it('should exclude edges with isIndicatorEdge flag from layout links', () => {
    // Setup: create cy instance with nodes and edges
    cy = cytoscape({
      headless: true,
      elements: [
        { data: { id: 'node1', label: 'Node 1' } },
        { data: { id: 'node2', label: 'Node 2' } },
        { data: { id: 'node3', label: 'Node 3' } },
        // Normal edge - should be included in layout
        { data: { id: 'edge1', source: 'node1', target: 'node2' } },
        // Indicator edge - should be EXCLUDED from layout
        { data: { id: 'edge2', source: 'node2', target: 'node3', isIndicatorEdge: true } },
      ],
    });

    // Act: run cola layout
    const layout: ColaLayoutInstance = new (ColaLayout as unknown as ColaLayoutConstructor)({
      cy,
      eles: cy.elements(),
      animate: false,
      maxSimulationTime: 100,
    });
    layout.run();

    // Assert: adaptor.links() was called
    expect(mockAdaptor.links).toHaveBeenCalled();

    // Assert: only the normal edge (edge1) was passed to adaptor.links()
    // The indicator edge (edge2) should have been filtered out
    expect(capturedLinks).toHaveLength(1);

    // The link should be the one from node1 to node2 (indices 0 and 1)
    // Cola uses indices from the nodes array, so source=0 (node1), target=1 (node2)
    const link: { source: number; target: number } = capturedLinks[0] as { source: number; target: number };
    expect(link.source).toBe(0);
    expect(link.target).toBe(1);
  });

  it('should include normal edges in layout links', () => {
    // Setup: create cy instance with only normal edges
    cy = cytoscape({
      headless: true,
      elements: [
        { data: { id: 'node1', label: 'Node 1' } },
        { data: { id: 'node2', label: 'Node 2' } },
        { data: { id: 'node3', label: 'Node 3' } },
        // All normal edges - should all be included
        { data: { id: 'edge1', source: 'node1', target: 'node2' } },
        { data: { id: 'edge2', source: 'node2', target: 'node3' } },
      ],
    });

    // Act: run cola layout
    const layout: ColaLayoutInstance = new (ColaLayout as unknown as ColaLayoutConstructor)({
      cy,
      eles: cy.elements(),
      animate: false,
      maxSimulationTime: 100,
    });
    layout.run();

    // Assert: both edges should be included
    expect(capturedLinks).toHaveLength(2);
  });

  it('should exclude all indicator edges when multiple exist', () => {
    // Setup: create cy instance with multiple indicator edges
    cy = cytoscape({
      headless: true,
      elements: [
        { data: { id: 'node1', label: 'Node 1' } },
        { data: { id: 'node2', label: 'Node 2' } },
        { data: { id: 'node3', label: 'Node 3' } },
        { data: { id: 'node4', label: 'Node 4' } },
        // One normal edge
        { data: { id: 'edge1', source: 'node1', target: 'node2' } },
        // Multiple indicator edges - all should be excluded
        { data: { id: 'edge2', source: 'node2', target: 'node3', isIndicatorEdge: true } },
        { data: { id: 'edge3', source: 'node3', target: 'node4', isIndicatorEdge: true } },
        { data: { id: 'edge4', source: 'node1', target: 'node4', isIndicatorEdge: true } },
      ],
    });

    // Act: run cola layout
    const layout: ColaLayoutInstance = new (ColaLayout as unknown as ColaLayoutConstructor)({
      cy,
      eles: cy.elements(),
      animate: false,
      maxSimulationTime: 100,
    });
    layout.run();

    // Assert: only the one normal edge should be included
    expect(capturedLinks).toHaveLength(1);
  });
});
