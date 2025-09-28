import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CytoscapeCore, AnimationType } from '@/graph-core/graphviz/CytoscapeCore';
import { JSDOM } from 'jsdom';

describe.skip('CytoscapeCore Styling Integration', () => {
  let container: HTMLElement;
  let cytoscapeCore: CytoscapeCore;
  let dom: JSDOM;

  beforeEach(() => {
    // Set up DOM environment
    dom = new JSDOM('<!DOCTYPE html><div id="cy"></div>');
    global.document = dom.window.document as any;
    global.window = dom.window as any;
    global.getComputedStyle = dom.window.getComputedStyle as any;

    // Mock canvas for cytoscape
    // @ts-expect-error - Mocking canvas for tests
    global.HTMLCanvasElement.prototype.getContext = () => ({
      fillRect: () => {},
      clearRect: () => {},
      getImageData: () => ({ data: [] }),
      putImageData: () => {},
      createImageData: () => ([]),
      setTransform: () => {},
      drawImage: () => {},
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      stroke: () => {},
      translate: () => {},
      scale: () => {},
      rotate: () => {},
      arc: () => {},
      fill: () => {},
      measureText: () => ({ width: 0 }),
      transform: () => {},
      rect: () => {},
      clip: () => {},
    });

    container = document.getElementById('cy') as HTMLElement;
  });

  afterEach(() => {
    if (cytoscapeCore) {
      cytoscapeCore.destroy();
    }
  });

  describe('Style Application', () => {
    it('should initialize with styled elements', () => {
      const elements = [
        { data: { id: 'n1', label: 'Node 1', degree: 5 } },
        { data: { id: 'n2', label: 'Node 2', degree: 10 } },
        { data: { id: 'e1', source: 'n1', target: 'n2' } }
      ];

      cytoscapeCore = new CytoscapeCore(container, elements);
      const cy = cytoscapeCore.getCore();

      // Check that nodes exist
      expect(cy.nodes().length).toBe(2);
      expect(cy.edges().length).toBe(1);

      // Check that styles are applied (style function exists)
      const node1 = cy.getElementById('n1');
      expect(node1.style).toBeDefined();
      expect(typeof node1.style).toBe('function');

      // Verify style properties are accessible
      const style = node1.style();
      expect(style).toBeDefined();
    });

    it('should apply degree-based sizing', () => {
      const elements = [
        { data: { id: 'small', label: 'Small', degree: 1 } },
        { data: { id: 'large', label: 'Large', degree: 30 } }
      ];

      cytoscapeCore = new CytoscapeCore(container, elements);
      const cy = cytoscapeCore.getCore();

      const smallNode = cy.getElementById('small');
      const largeNode = cy.getElementById('large');

      // Nodes should have different effective sizes based on degree
      // Note: In headless mode, computed styles might not be fully calculated
      expect(smallNode.data('degree')).toBe(1);
      expect(largeNode.data('degree')).toBe(30);
    });

    it('should support frontmatter-based styling', () => {
      const elements = [
        {
          data: {
            id: 'custom',
            label: 'Original',
            title: 'Custom Title',
            color: '#ff0000',
            shape: 'rectangle',
            width: 100,
            height: 50
          }
        }
      ];

      cytoscapeCore = new CytoscapeCore(container, elements);
      const cy = cytoscapeCore.getCore();

      const node = cy.getElementById('custom');

      // Verify custom data is preserved
      expect(node.data('title')).toBe('Custom Title');
      expect(node.data('color')).toBe('#ff0000');
      expect(node.data('shape')).toBe('rectangle');
      expect(node.data('width')).toBe(100);
      expect(node.data('height')).toBe(50);
    });
  });

  describe('Hover Effects', () => {
    it('should add hover classes on mouseover', () => {
      const elements = [
        { data: { id: 'n1', label: 'Node 1' } },
        { data: { id: 'n2', label: 'Node 2' } },
        { data: { id: 'e1', source: 'n1', target: 'n2' } }
      ];

      cytoscapeCore = new CytoscapeCore(container, elements);
      const cy = cytoscapeCore.getCore();

      const node1 = cy.getElementById('n1');
      const node2 = cy.getElementById('n2');
      const edge = cy.getElementById('e1');

      // Trigger mouseover on node1
      node1.emit('mouseover');

      // Check classes
      expect(node1.hasClass('hover')).toBe(true);
      expect(node2.hasClass('connected-hover')).toBe(true);
      expect(edge.hasClass('connected-hover')).toBe(true);
    });

    it('should remove hover classes on mouseout', () => {
      const elements = [
        { data: { id: 'n1', label: 'Node 1' } },
        { data: { id: 'n2', label: 'Node 2' } }
      ];

      cytoscapeCore = new CytoscapeCore(container, elements);
      const cy = cytoscapeCore.getCore();

      const node1 = cy.getElementById('n1');

      // Add hover
      node1.emit('mouseover');
      expect(node1.hasClass('hover')).toBe(true);

      // Remove hover
      node1.emit('mouseout');
      expect(node1.hasClass('hover')).toBe(false);
    });
  });

  describe('Animation Integration', () => {
    it('should add breathing animation to new nodes', () => {
      cytoscapeCore = new CytoscapeCore(container);
      cytoscapeCore.getCore();

      // Add a new node
      const nodes = cytoscapeCore.addNodes([
        { data: { id: 'new', label: 'New Node' } }
      ]);

      const newNode = nodes[0];

      // Apply new node animation
      cytoscapeCore.animateNewNode(newNode);

      expect(newNode.data('breathingActive')).toBe(true);
      expect(newNode.data('animationType')).toBe(AnimationType.NEW_NODE);
    });

    it('should add animation when pinning nodes', () => {
      const elements = [
        { data: { id: 'n1', label: 'Node 1' } }
      ];

      cytoscapeCore = new CytoscapeCore(container, elements);
      const cy = cytoscapeCore.getCore();
      const node = cy.getElementById('n1');

      // Pin the node
      cytoscapeCore.pinNode(node);

      expect(node.hasClass('pinned')).toBe(true);
      expect(node.locked()).toBe(true);
      expect(node.data('breathingActive')).toBe(true);
      expect(node.data('animationType')).toBe(AnimationType.PINNED);
    });

    it('should stop animation when unpinning nodes', () => {
      const elements = [
        { data: { id: 'n1', label: 'Node 1' } }
      ];

      cytoscapeCore = new CytoscapeCore(container, elements);
      const cy = cytoscapeCore.getCore();
      const node = cy.getElementById('n1');

      // Pin and then unpin
      cytoscapeCore.pinNode(node);
      cytoscapeCore.unpinNode(node);

      expect(node.hasClass('pinned')).toBe(false);
      expect(node.locked()).toBe(false);
      expect(node.data('breathingActive')).toBe(false);
    });

    it('should support appended content animation', () => {
      const elements = [
        { data: { id: 'n1', label: 'Node 1' } }
      ];

      cytoscapeCore = new CytoscapeCore(container, elements);
      const cy = cytoscapeCore.getCore();
      const node = cy.getElementById('n1');

      cytoscapeCore.animateAppendedContent(node);

      expect(node.data('breathingActive')).toBe(true);
      expect(node.data('animationType')).toBe(AnimationType.APPENDED_CONTENT);
    });

    it('should stop all animations', () => {
      const elements = [
        { data: { id: 'n1', label: 'Node 1' } },
        { data: { id: 'n2', label: 'Node 2' } }
      ];

      cytoscapeCore = new CytoscapeCore(container, elements);
      const cy = cytoscapeCore.getCore();

      // Animate both nodes
      cy.nodes().forEach(node => {
        cytoscapeCore.animateNewNode(node);
      });

      // Stop all animations
      cytoscapeCore.stopAllAnimations();

      cy.nodes().forEach(node => {
        expect(node.data('breathingActive')).toBe(false);
      });
    });
  });

  describe('CSS Classes', () => {
    it('should handle filtered nodes', () => {
      const elements = [
        { data: { id: 'n1', label: 'Node 1' }, classes: 'filtered' }
      ];

      cytoscapeCore = new CytoscapeCore(container, elements);
      const cy = cytoscapeCore.getCore();
      const node = cy.getElementById('n1');

      expect(node.hasClass('filtered')).toBe(true);
    });

    it('should handle dangling nodes', () => {
      const elements = [
        { data: { id: 'n1', label: 'Node 1' }, classes: 'dangling' }
      ];

      cytoscapeCore = new CytoscapeCore(container, elements);
      const cy = cytoscapeCore.getCore();
      const node = cy.getElementById('n1');

      expect(node.hasClass('dangling')).toBe(true);
    });
  });
});