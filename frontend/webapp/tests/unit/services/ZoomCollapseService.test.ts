import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import cytoscape, { type Core, type NodeSingular } from 'cytoscape';
import { ZoomCollapseService } from '@/graph-core/services/ZoomCollapseService';
import { StyleService } from '@/graph-core/services/StyleService';

describe('ZoomCollapseService', () => {
  let cy: Core;
  let container: HTMLDivElement;
  let service: ZoomCollapseService;

  beforeEach(() => {
    // Create container with dimensions
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);

    // Initialize cytoscape with a simple tree structure
    // NOTE: In our graph structure, edges go FROM child TO parent (child links to parent)
    cy = cytoscape({
      container: container,
      elements: [
        // Parent node at (100, 100)
        { data: { id: 'parent', label: 'Parent' }, position: { x: 100, y: 100 } },
        // Child node at (200, 100) - 100px away horizontally
        { data: { id: 'child', label: 'Child' }, position: { x: 200, y: 100 } },
        // Edge from CHILD to PARENT (matches our graph convention)
        { data: { id: 'edge1', source: 'child', target: 'parent' } },
      ],
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#666',
            'label': 'data(label)',
          },
        },
        {
          selector: 'edge',
          style: {
            'width': 3,
            'line-color': '#ccc',
          },
        },
      ],
      layout: { name: 'preset' },
      zoom: 1,
      pan: { x: 0, y: 0 },
    });
  });

  afterEach(() => {
    if (service) {
      service.destroy();
    }
    if (cy) {
      cy.destroy();
    }
    if (container) {
      container.remove();
    }
  });

  describe('initialization', () => {
    it('should create service with default threshold of 50px', () => {
      service = new ZoomCollapseService(cy);
      expect(service).toBeDefined();
    });

    it('should create service with custom threshold', () => {
      service = new ZoomCollapseService(cy, 100);
      expect(service).toBeDefined();
    });

    it('should perform initial collapse check on initialize', () => {
      service = new ZoomCollapseService(cy, 50);

      // Before initialization, child should be visible
      const childNode = cy.getElementById('child');
      expect(childNode.style('display')).toBe('element');

      service.initialize();

      // After initialization with threshold 50, and edge is ~100px,
      // child should still be visible (edge > threshold)
      expect(childNode.style('display')).toBe('element');
    });
  });

  describe('edge length calculation and node hiding', () => {
    it('should hide child node when edge pixel length is below threshold', () => {
      // Set threshold to 150px (edge is ~100px, so should not hide initially)
      service = new ZoomCollapseService(cy, 150);
      service.initialize();

      const childNode = cy.getElementById('child');
      const parentNode = cy.getElementById('parent');

      // Edge is ~100px, threshold is 150px, so child should be hidden
      expect(childNode.style('display')).toBe('none');
      expect(parentNode.hasClass('has-hidden-children')).toBe(true);
    });

    it('should show child node when edge pixel length is above threshold', () => {
      // Set threshold to 50px (edge is ~100px, so should remain visible)
      service = new ZoomCollapseService(cy, 50);
      service.initialize();

      const childNode = cy.getElementById('child');
      const parentNode = cy.getElementById('parent');

      // Edge is ~100px, threshold is 50px, so child should be visible
      expect(childNode.style('display')).toBe('element');
      expect(parentNode.hasClass('has-hidden-children')).toBe(false);
    });

    it('should update visibility when zooming in (edges get longer)', () => {
      // Start with threshold of 150px - child should be hidden at zoom=1
      service = new ZoomCollapseService(cy, 150);
      service.initialize();

      const childNode = cy.getElementById('child');
      const parentNode = cy.getElementById('parent');

      // Initially hidden (edge ~100px < 150px threshold)
      expect(childNode.style('display')).toBe('none');
      expect(parentNode.hasClass('has-hidden-children')).toBe(true);

      // Zoom in to 2x - edge becomes ~200px in screen space
      cy.zoom(2);
      cy.emit('zoom');

      // Now edge is ~200px > 150px threshold, so should be visible
      expect(childNode.style('display')).toBe('element');
      expect(parentNode.hasClass('has-hidden-children')).toBe(false);
    });

    it('should update visibility when zooming out (edges get shorter)', () => {
      // Start with threshold of 150px and zoom=2 - child should be visible
      cy.zoom(2);
      service = new ZoomCollapseService(cy, 150);
      service.initialize();

      const childNode = cy.getElementById('child');
      const parentNode = cy.getElementById('parent');

      // Initially visible (edge ~200px > 150px threshold at zoom=2)
      expect(childNode.style('display')).toBe('element');
      expect(parentNode.hasClass('has-hidden-children')).toBe(false);

      // Zoom out to 0.5x - edge becomes ~50px in screen space
      cy.zoom(0.5);
      cy.emit('zoom');

      // Now edge is ~50px < 150px threshold, so should be hidden
      expect(childNode.style('display')).toBe('none');
      expect(parentNode.hasClass('has-hidden-children')).toBe(true);
    });
  });

  describe('panning behavior', () => {
    it('should respond to pan events', () => {
      service = new ZoomCollapseService(cy, 150);
      service.initialize();

      const childNode = cy.getElementById('child');

      // Pan should not affect edge lengths (rendered positions stay same relative distance)
      cy.pan({ x: 100, y: 100 });
      cy.emit('pan');

      // Child visibility should remain consistent (edge ~100px < 150px)
      expect(childNode.style('display')).toBe('none');
    });
  });

  describe('has-hidden-children class', () => {
    it('should add class to parent when children are hidden', () => {
      service = new ZoomCollapseService(cy, 150);
      service.initialize();

      const parentNode = cy.getElementById('parent');

      // Edge is ~100px < 150px, so child hidden and parent should have class
      expect(parentNode.hasClass('has-hidden-children')).toBe(true);
    });

    it('should remove class from parent when children are shown', () => {
      service = new ZoomCollapseService(cy, 150);
      service.initialize();

      const parentNode = cy.getElementById('parent');

      // Initially hidden
      expect(parentNode.hasClass('has-hidden-children')).toBe(true);

      // Zoom in so edge becomes visible
      cy.zoom(2);
      cy.emit('zoom');

      // Class should be removed
      expect(parentNode.hasClass('has-hidden-children')).toBe(false);
    });
  });

  describe('ghost root handling', () => {
    it('should skip edges connected to ghost root nodes', () => {
      // Add a ghost root node (child links to ghost root parent)
      cy.add([
        { data: { id: 'ghostRoot', isGhostRoot: true }, position: { x: 0, y: 0 } },
        { data: { id: 'ghostChild', label: 'Ghost Child' }, position: { x: 10, y: 10 } },
        { data: { id: 'ghostEdge', source: 'ghostChild', target: 'ghostRoot' } },
      ]);

      service = new ZoomCollapseService(cy, 1000); // Very high threshold
      service.initialize();

      // Ghost child should not be hidden even with very high threshold
      const ghostChild = cy.getElementById('ghostChild');
      expect(ghostChild.style('display')).toBe('element');
    });
  });

  describe('multiple children', () => {
    it('should handle parent with multiple children correctly', () => {
      // Add more children at different distances
      cy.add([
        { data: { id: 'child2', label: 'Child 2' }, position: { x: 120, y: 100 } },
        { data: { id: 'edge2', source: 'child2', target: 'parent' } },
        { data: { id: 'child3', label: 'Child 3' }, position: { x: 300, y: 100 } },
        { data: { id: 'edge3', source: 'child3', target: 'parent' } },
      ]);

      service = new ZoomCollapseService(cy, 50);
      service.initialize();

      const parentNode = cy.getElementById('parent');
      const child1 = cy.getElementById('child'); // at x=200, ~100px away
      const child2 = cy.getElementById('child2'); // at x=120, ~20px away
      const child3 = cy.getElementById('child3'); // at x=300, ~200px away

      // child2 is ~20px away (< 50px) - should be hidden
      expect(child2.style('display')).toBe('none');

      // child1 and child3 are > 50px away - should be visible
      expect(child1.style('display')).toBe('element');
      expect(child3.style('display')).toBe('element');

      // Parent should have class because at least one child is hidden
      expect(parentNode.hasClass('has-hidden-children')).toBe(true);
    });
  });

  describe('destroy', () => {
    it('should remove event listeners', () => {
      service = new ZoomCollapseService(cy, 150);
      service.initialize();

      // Child should be hidden initially
      const childNode = cy.getElementById('child');
      expect(childNode.style('display')).toBe('none');

      service.destroy();

      // Zoom in - but since listeners are removed, child should stay hidden
      // Actually, destroy() restores all nodes, so child should be visible
      expect(childNode.style('display')).toBe('element');

      // Further zoom events should not affect anything
      cy.zoom(2);
      cy.emit('zoom');
      expect(childNode.style('display')).toBe('element');
    });

    it('should restore all hidden nodes to visible', () => {
      service = new ZoomCollapseService(cy, 150);
      service.initialize();

      const childNode = cy.getElementById('child');
      const parentNode = cy.getElementById('parent');

      // Initially hidden
      expect(childNode.style('display')).toBe('none');
      expect(parentNode.hasClass('has-hidden-children')).toBe(true);

      service.destroy();

      // Should be restored
      expect(childNode.style('display')).toBe('element');
      expect(parentNode.hasClass('has-hidden-children')).toBe(false);
    });

    it('should clear hidden nodes set', () => {
      service = new ZoomCollapseService(cy, 150);
      service.initialize();

      // Child is hidden
      const childNode = cy.getElementById('child');
      expect(childNode.style('display')).toBe('none');

      service.destroy();

      // Re-initialize with same threshold
      service.initialize();

      // Should re-evaluate and hide again
      expect(childNode.style('display')).toBe('none');
    });
  });

  describe('dynamic graph changes', () => {
    it('should handle node state transitions correctly', () => {
      service = new ZoomCollapseService(cy, 150);
      service.initialize();

      const childNode = cy.getElementById('child');

      // Initially hidden (edge ~100px < 150px)
      expect(childNode.style('display')).toBe('none');

      // Zoom to make visible
      cy.zoom(2);
      cy.emit('zoom');
      expect(childNode.style('display')).toBe('element');

      // Zoom back to hide
      cy.zoom(1);
      cy.emit('zoom');
      expect(childNode.style('display')).toBe('none');
    });
  });

  describe('visual node size changes with StyleService', () => {
    it('should increase node width and height when has-hidden-children class is applied', () => {
      // Create a new Cytoscape instance WITH StyleService applied
      const styleService = new StyleService();
      const styledContainer = document.createElement('div');
      styledContainer.style.width = '800px';
      styledContainer.style.height = '600px';
      document.body.appendChild(styledContainer);

      const styledCy = cytoscape({
        container: styledContainer,
        elements: [
          { data: { id: 'parent', label: 'Parent', degree: 10 }, position: { x: 100, y: 100 } },
          { data: { id: 'child', label: 'Child', degree: 5 }, position: { x: 200, y: 100 } },
          { data: { id: 'edge1', source: 'child', target: 'parent' } },
        ],
        style: styleService.getCombinedStylesheet(),
        layout: { name: 'preset' },
        zoom: 1,
        pan: { x: 0, y: 0 },
      });

      const styledService = new ZoomCollapseService(styledCy, 150);
      styledService.initialize();

      const parentNode = styledCy.getElementById('parent');
      const childNode = styledCy.getElementById('child');

      // Child should be hidden
      expect(childNode.style('display')).toBe('none');
      // Parent should have the class
      expect(parentNode.hasClass('has-hidden-children')).toBe(true);

      // Get computed styles - these should be numbers (Cytoscape returns computed pixel values)
      const parentWidth = parseFloat(parentNode.style('width') as string);
      const parentHeight = parseFloat(parentNode.style('height') as string);

      // Remove the class temporarily to get the base size
      parentNode.removeClass('has-hidden-children');
      const baseWidth = parseFloat(parentNode.style('width') as string);
      const baseHeight = parseFloat(parentNode.style('height') as string);

      // Re-add the class
      parentNode.addClass('has-hidden-children');
      const scaledWidth = parseFloat(parentNode.style('width') as string);
      const scaledHeight = parseFloat(parentNode.style('height') as string);

      // Verify that nodes with has-hidden-children are 1.5x larger
      expect(scaledWidth).toBeGreaterThan(baseWidth);
      expect(scaledHeight).toBeGreaterThan(baseHeight);

      // The ratio should be approximately 1.5x (within 10% tolerance for rounding)
      const widthRatio = scaledWidth / baseWidth;
      const heightRatio = scaledHeight / baseHeight;
      expect(widthRatio).toBeGreaterThanOrEqual(1.4);
      expect(widthRatio).toBeLessThanOrEqual(1.6);
      expect(heightRatio).toBeGreaterThanOrEqual(1.4);
      expect(heightRatio).toBeLessThanOrEqual(1.6);

      // Cleanup
      styledCy.destroy();
      document.body.removeChild(styledContainer);
    });
  });
});
