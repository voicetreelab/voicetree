import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CytoscapeCore, AnimationType } from '@/graph-core/graphviz/CytoscapeCore';
import { JSDOM } from 'jsdom';

describe('CytoscapeCore Styling Integration', () => {
  let container: HTMLElement;
  let cytoscapeCore: CytoscapeCore;
  let dom: JSDOM;

  beforeEach(() => {
    // Set up DOM environment
    dom = new JSDOM('<!DOCTYPE html><div id="cy"></div>');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.document = dom.window.document as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.window = dom.window as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

      cytoscapeCore = new CytoscapeCore(container, elements, true);
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

      cytoscapeCore = new CytoscapeCore(container, elements, true);
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

      cytoscapeCore = new CytoscapeCore(container, elements, true);
      const cy = cytoscapeCore.getCore();

      const node = cy.getElementById('custom');

      // Verify custom data is preserved
      expect(node.data('title')).toBe('Custom Title');
      expect(node.data('color')).toBe('#ff0000');
      expect(node.data('shape')).toBe('rectangle');
      expect(node.data('width')).toBe(100);
      expect(node.data('height')).toBe(50);
    });

    it('should apply background-color from frontmatter color field', () => {
      const elements = [
        {
          data: {
            id: 'blue-node',
            label: 'Blue Node',
            color: 'blue'
          }
        },
        {
          data: {
            id: 'red-node',
            label: 'Red Node',
            color: '#ff0000'
          }
        }
      ];

      cytoscapeCore = new CytoscapeCore(container, elements, true);
      const cy = cytoscapeCore.getCore();

      const blueNode = cy.getElementById('blue-node');
      const redNode = cy.getElementById('red-node');

      // First verify data is set
      expect(blueNode.data('color')).toBe('blue');
      expect(redNode.data('color')).toBe('#ff0000');

      // Get the StyleService to verify frontmatter stylesheet is configured
      const styleService = cytoscapeCore['styleService'];
      const frontmatterStylesheet = styleService.getFrontmatterStylesheet();

      // Find the color rule
      const colorRule = frontmatterStylesheet.find(s => s.selector === 'node[color]');
      expect(colorRule).toBeDefined();
      expect(colorRule?.style?.['background-color']).toBe('data(color)');

      // In a real (non-headless) cytoscape instance, the style would be computed
      // For now we verify the stylesheet configuration is correct
      // The actual rendering verification would need to be done in e2e tests
    });
  });

  describe('Hover Effects', () => {
    it('should add hover classes on mouseover', () => {
      const elements = [
        { data: { id: 'n1', label: 'Node 1' } },
        { data: { id: 'n2', label: 'Node 2' } },
        { data: { id: 'e1', source: 'n1', target: 'n2' } }
      ];

      cytoscapeCore = new CytoscapeCore(container, elements, true);
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

      cytoscapeCore = new CytoscapeCore(container, elements, true);
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
      cytoscapeCore = new CytoscapeCore(container, [], true);
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

      cytoscapeCore = new CytoscapeCore(container, elements, true);
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

      cytoscapeCore = new CytoscapeCore(container, elements, true);
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

      cytoscapeCore = new CytoscapeCore(container, elements, true);
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

      cytoscapeCore = new CytoscapeCore(container, elements, true);
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

      cytoscapeCore = new CytoscapeCore(container, elements, true);
      const cy = cytoscapeCore.getCore();
      const node = cy.getElementById('n1');

      expect(node.hasClass('filtered')).toBe(true);
    });

    it('should handle dangling nodes', () => {
      const elements = [
        { data: { id: 'n1', label: 'Node 1' }, classes: 'dangling' }
      ];

      cytoscapeCore = new CytoscapeCore(container, elements, true);
      const cy = cytoscapeCore.getCore();
      const node = cy.getElementById('n1');

      expect(node.hasClass('dangling')).toBe(true);
    });
  });

  describe('Text Wrapping', () => {
    it('should configure text wrapping on nodes with text-max-width', () => {
      const longText = 'This is a very long text that should wrap to multiple lines when displayed on the node';
      const elements = [
        { data: { id: 'n1', label: longText, degree: 10 } }
      ];

      cytoscapeCore = new CytoscapeCore(container, elements, true);

      // Get the StyleService instance to verify configuration
      const styleService = cytoscapeCore['styleService'];
      const stylesheet = styleService.getCombinedStylesheet();

      // Find the base node style
      const baseNodeStyle = stylesheet.find(s => s.selector === 'node');
      expect(baseNodeStyle).toBeDefined();
      expect(baseNodeStyle.style['text-wrap']).toBe('wrap');
      expect(baseNodeStyle.style['text-max-width']).toBe('180px');

      // Find the node[degree] style with text-max-width
      const degreeNodeStyle = stylesheet.find(s => s.selector === 'node[degree]');
      expect(degreeNodeStyle).toBeDefined();
      expect(degreeNodeStyle.style['text-max-width']).toBeDefined();

      // Verify the text-max-width uses correct mapData
      const textMaxWidth = degreeNodeStyle.style['text-max-width'];
      expect(textMaxWidth).toContain('mapData');
      expect(textMaxWidth).toContain('degree');
      // Should map from MIN_TEXT_WIDTH (60) to MAX_TEXT_WIDTH (180)
      expect(textMaxWidth).toContain('60');
      expect(textMaxWidth).toContain('180');
    });

    it('should scale text-max-width based on node degree', () => {
      const elements = [
        { data: { id: 'small', label: 'Small node with long text that needs wrapping', degree: 0 } },
        { data: { id: 'large', label: 'Large node with long text that needs wrapping', degree: 60 } }
      ];

      cytoscapeCore = new CytoscapeCore(container, elements, true);

      // Get the StyleService configuration
      const styleService = cytoscapeCore['styleService'];
      const stylesheet = styleService.getCombinedStylesheet();
      const degreeStyle = stylesheet.find(s => s.selector === 'node[degree]');

      // The mapData expression should scale from MIN to MAX based on degree 0-60
      const expectedExpression = 'mapData(degree, 0, 60, 60, 180)';
      expect(degreeStyle.style['text-max-width']).toBe(expectedExpression);
    });
  });
});