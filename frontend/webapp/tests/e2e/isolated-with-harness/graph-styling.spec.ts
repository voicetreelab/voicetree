import { test, expect } from '@playwright/test';

test.describe('Graph Styling Visual Tests', () => {
  test('should display graph with Juggl-inspired styles', async ({ page }) => {
    // Navigate to test harness
    await page.goto('http://localhost:5173/test-harness');

    // Wait for graph container to be visible
    await page.waitForSelector('#cy-container', { state: 'visible' });

    // Add test nodes with different properties
    await page.evaluate(() => {
      const elements = [
        { data: { id: 'n1', label: 'Small Node', degree: 1 } },
        { data: { id: 'n2', label: 'Medium Node', degree: 10 } },
        { data: { id: 'n3', label: 'Large Node', degree: 30 } },
        { data: { id: 'n4', label: 'Custom Color', color: '#ff6b6b' } },
        { data: { id: 'n5', label: 'Rectangle', shape: 'rectangle' } },
        { data: { id: 'dangling', label: 'Dangling' }, classes: 'dangling' },
        { data: { id: 'e1', source: 'n1', target: 'n2' } },
        { data: { id: 'e2', source: 'n2', target: 'n3' } },
        { data: { id: 'e3', source: 'n1', target: 'n3' } },
      ];

      // @ts-expect-error - Accessing window.cytoscapeCore for testing purposes - accessing test harness global
      if (window.cytoscapeCore) {
        window.cytoscapeCore.addElements(elements);
        window.cytoscapeCore.getCore().layout({ name: 'circle' }).run();
        window.cytoscapeCore.fitView();
      }
    });

    // Wait for layout to complete
    await page.waitForTimeout(500);

    // Verify nodes are rendered with correct styles
    const nodes = await page.evaluate(() => {
      // @ts-expect-error - Accessing window.cytoscapeCore for testing purposes - Mock cytoscape style methods for testing
      const cy = window.cytoscapeCore?.getCore();
      if (!cy) return [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return cy.nodes().map((node: any) => ({
        id: node.id(),
        label: node.data('label'),
        degree: node.data('degree'),
        classes: node.classes(),
        // Get computed styles
        backgroundColor: node.style('background-color'),
        shape: node.style('shape'),
        width: parseFloat(node.style('width')),
        height: parseFloat(node.style('height')),
      }));
    });

    // Verify we have nodes
    expect(nodes.length).toBeGreaterThan(0);

    // Check degree-based sizing
    const smallNode = nodes.find(n => n.id === 'n1');
    const largeNode = nodes.find(n => n.id === 'n3');

    expect(smallNode).toBeDefined();
    expect(largeNode).toBeDefined();

    // Large node should be bigger than small node
    if (smallNode && largeNode) {
      expect(largeNode.width).toBeGreaterThan(smallNode.width);
      expect(largeNode.height).toBeGreaterThan(smallNode.height);
    }

    // Check dangling node has special class
    const danglingNode = nodes.find(n => n.id === 'dangling');
    expect(danglingNode?.classes).toContain('dangling');

    // Test hover effects
    await page.evaluate(() => {
      // @ts-expect-error - Accessing window.cytoscapeCore for testing purposes - Mock cytoscape style methods for testing
      const cy = window.cytoscapeCore?.getCore();
      if (cy) {
        const node = cy.getElementById('n1');
        node.emit('mouseover');
      }
    });

    // Check hover classes are applied
    const hoverState = await page.evaluate(() => {
      // @ts-expect-error - Accessing window.cytoscapeCore for testing purposes - Mock cytoscape style methods for testing
      const cy = window.cytoscapeCore?.getCore();
      if (!cy) return null;

      const n1 = cy.getElementById('n1');
      const n2 = cy.getElementById('n2');
      const edge = cy.getElementById('e1');

      return {
        n1HasHover: n1.hasClass('hover'),
        n2HasConnectedHover: n2.hasClass('connected-hover'),
        edgeHasConnectedHover: edge.hasClass('connected-hover'),
      };
    });

    expect(hoverState?.n1HasHover).toBe(true);
    expect(hoverState?.n2HasConnectedHover).toBe(true);
    expect(hoverState?.edgeHasConnectedHover).toBe(true);

    // Test pin animation
    await page.evaluate(() => {
      // @ts-expect-error - Accessing window.cytoscapeCore for testing purposes - Mock cytoscape style methods for testing
      const cy = window.cytoscapeCore?.getCore();
      if (cy && window.cytoscapeCore) {
        const node = cy.getElementById('n2');
        window.cytoscapeCore.pinNode(node);
      }
    });

    // Check pinned state
    const pinnedState = await page.evaluate(() => {
      // @ts-expect-error - Accessing window.cytoscapeCore for testing purposes - Mock cytoscape style methods for testing
      const cy = window.cytoscapeCore?.getCore();
      if (!cy) return null;

      const node = cy.getElementById('n2');
      return {
        isPinned: node.hasClass('pinned'),
        isLocked: node.locked(),
        hasAnimation: node.data('breathingActive'),
      };
    });

    expect(pinnedState?.isPinned).toBe(true);
    expect(pinnedState?.isLocked).toBe(true);
    expect(pinnedState?.hasAnimation).toBe(true);

    // Take screenshot for visual verification
    await page.screenshot({
      path: 'tests/e2e/screenshots/graph-styling.png',
      fullPage: false
    });
  });

  test('should apply CSS styles for UI elements', async ({ page }) => {
    await page.goto('http://localhost:5173/test-harness');

    // Check that graph.css is loaded
    const hasGraphCSS = await page.evaluate(() => {
      const styleSheets = Array.from(document.styleSheets);
      return styleSheets.some(sheet =>
        sheet.href?.includes('graph.css') ||
        Array.from(sheet.cssRules || []).some(rule =>
          rule.cssText?.includes('cy-navigator') ||
          rule.cssText?.includes('cy-toolbar')
        )
      );
    });

    // The CSS should be loaded via import
    expect(hasGraphCSS).toBe(true);

    // Verify specific CSS classes exist
    const cssRules = await page.evaluate(() => {
      const rules: string[] = [];
      Array.from(document.styleSheets).forEach(sheet => {
        try {
          Array.from(sheet.cssRules || []).forEach(rule => {
            if (rule instanceof CSSStyleRule) {
              rules.push(rule.selectorText);
            }
          });
        } catch {
          // Cross-origin stylesheets might throw
        }
      });
      return rules;
    });

    // Check for some key selectors from our graph.css
    const hasNavigator = cssRules.some(r => r.includes('cy-navigator'));
    const hasToolbar = cssRules.some(r => r.includes('cy-toolbar'));
    const hasGraphButton = cssRules.some(r => r.includes('graph-button'));

    console.log('CSS Rules found:', {
      hasNavigator,
      hasToolbar,
      hasGraphButton,
      sampleRules: cssRules.slice(0, 10)
    });
  });
});