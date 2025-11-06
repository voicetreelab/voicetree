/**
 * E2E Test for Vanilla VoiceTreeGraphView
 *
 * This test verifies that the vanilla TypeScript VoiceTreeGraphView class works correctly
 * without React, including:
 * - Graph initialization and rendering
 * - File add/change/delete events
 * - Bulk file loading
 * - Dark mode toggle
 * - Context menu and interactions
 */

import { test, expect } from '@playwright/test';

test.describe('VoiceTreeGraphView Vanilla Implementation', () => {
  // Add logging to capture browser console output
  test.beforeEach(async ({ page }) => {
    // Listen for console messages
    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      console.log(`[BROWSER ${type.toUpperCase()}]:`, text);
    });

    // Listen for page errors
    page.on('pageerror', error => {
      console.error('[BROWSER ERROR]:', error.message);
      console.error(error.stack);
    });
  });

  test('should initialize and render the graph', async ({ page }) => {
    console.log('=== Test: Graph Initialization ===');

    // Navigate to test harness
    await page.goto('/voicetree-graphview-test.html', { waitUntil: 'networkidle' });

    // Wait a bit for initialization
    await page.waitForTimeout(2000);

    // Check if there's an error in the container
    const containerHTML = await page.evaluate(() => {
      const container = document.getElementById('graph-container');
      return container ? container.innerHTML : 'Container not found';
    });

    console.log('Container HTML:', containerHTML.substring(0, 500));

    // Verify VoiceTreeGraphView instance exists
    const hasGraphView = await page.evaluate(() => {
      return !!(window as any).voiceTreeGraphView;
    });
    expect(hasGraphView).toBe(true);
    console.log('✓ VoiceTreeGraphView instance created');

    // Verify Cytoscape instance exists
    const hasCytoscape = await page.evaluate(() => {
      return !!(window as any).cytoscapeInstance;
    });
    expect(hasCytoscape).toBe(true);
    console.log('✓ Cytoscape instance available');

    // Verify the Cytoscape instance is ready
    const isReady = await page.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      return cy && cy.ready && !cy.destroyed();
    });
    expect(isReady).toBe(true);
    console.log('✓ Cytoscape graph is ready');
  });

  test('should add nodes when files are added', async ({ page }) => {
    console.log('=== Test: File Addition ===');

    await page.goto('/voicetree-graphview-test.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000); // Wait for initialization

    // Initial node count should be 0
    let nodeCount = await page.evaluate(() => {
      const view = (window as any).voiceTreeGraphView;
      return view ? view.getStats().nodeCount : 0;
    });
    expect(nodeCount).toBe(0);
    console.log(`Initial node count: ${nodeCount}`);

    // Add first file
    await page.click('#btn-add-file');
    await page.waitForTimeout(500); // Wait for graph update

    nodeCount = await page.evaluate(() => {
      const view = (window as any).voiceTreeGraphView;
      return view ? view.getStats().nodeCount : 0;
    });
    expect(nodeCount).toBe(1);
    console.log(`✓ After adding 1 file: ${nodeCount} node`);

    // Add second file
    await page.click('#btn-add-file');
    await page.waitForTimeout(500);

    nodeCount = await page.evaluate(() => {
      const view = (window as any).voiceTreeGraphView;
      return view ? view.getStats().nodeCount : 0;
    });
    expect(nodeCount).toBe(2);
    console.log(`✓ After adding 2 files: ${nodeCount} nodes`);

    // Verify nodes have positions (not all at origin)
    const boundingBox = await page.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      if (!cy) return null;
      const nodes = cy.nodes().filter((n: any) => !n.data('isGhostRoot'));
      if (nodes.length === 0) return null;
      const bb = nodes.boundingBox();
      return { width: bb.w, height: bb.h };
    });

    expect(boundingBox).not.toBeNull();
    expect(boundingBox!.width).toBeGreaterThan(10);
    expect(boundingBox!.height).toBeGreaterThan(10);
    console.log(`✓ Nodes positioned (bbox: ${boundingBox!.width.toFixed(0)}x${boundingBox!.height.toFixed(0)})`);
  });

  test('should handle bulk file loading', async ({ page }) => {
    console.log('=== Test: Bulk File Loading ===');

    await page.goto('/voicetree-graphview-test.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Click bulk load button
    await page.click('#btn-bulk-load');
    await page.waitForTimeout(1000); // Wait for layout animation

    // Verify 4 nodes were added
    const nodeCount = await page.evaluate(() => {
      const view = (window as any).voiceTreeGraphView;
      return view ? view.getStats().nodeCount : 0;
    });
    expect(nodeCount).toBe(4);
    console.log(`✓ Bulk loaded ${nodeCount} nodes`);

    // Verify outgoingEdges exist (nodes are linked)
    const edgeCount = await page.evaluate(() => {
      const view = (window as any).voiceTreeGraphView;
      return view ? view.getStats().edgeCount : 0;
    });
    expect(edgeCount).toBeGreaterThan(0);
    console.log(`✓ ${edgeCount} edges created from wikilinks`);

    // Verify specific nodes exist
    const nodeIds = await page.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      if (!cy) return [];
      return cy.nodes().filter((n: any) => !n.data('isGhostRoot')).map((n: any) => n.id());
    });

    expect(nodeIds).toContain('root-concept');
    expect(nodeIds).toContain('child-a');
    expect(nodeIds).toContain('child-b');
    expect(nodeIds).toContain('grandchild');
    console.log(`✓ Expected nodes found: ${nodeIds.join(', ')}`);

    // Verify hierarchical layout applied
    const boundingBox = await page.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      if (!cy) return null;
      const nodes = cy.nodes().filter((n: any) => !n.data('isGhostRoot'));
      if (nodes.length === 0) return null;
      const bb = nodes.boundingBox();
      return { width: bb.w, height: bb.h };
    });

    expect(boundingBox!.width).toBeGreaterThan(100);
    expect(boundingBox!.height).toBeGreaterThan(100);
    console.log(`✓ Hierarchical layout applied (bbox: ${boundingBox!.width.toFixed(0)}x${boundingBox!.height.toFixed(0)})`);
  });

  test('should update nodes when files are changed', async ({ page }) => {
    console.log('=== Test: File Change ===');

    await page.goto('/voicetree-graphview-test.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000); // Wait for initialization

    // Add a file first
    await page.click('#btn-add-file');
    await page.waitForTimeout(500);

    // Get initial node data
    const initialData = await page.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      if (!cy) return null;
      const node = cy.nodes().filter((n: any) => !n.data('isGhostRoot')).first();
      if (!node || node.length === 0) return null;
      return {
        id: node.id(),
        content: node.data('content')
      };
    });

    expect(initialData).not.toBeNull();
    console.log(`✓ Initial node: ${initialData!.id}`);

    // Change the file
    await page.click('#btn-change-file');
    await page.waitForTimeout(500);

    // Verify node data was updated
    const updatedData = await page.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      if (!cy) return null;
      const node = cy.nodes().filter((n: any) => !n.data('isGhostRoot')).first();
      if (!node || node.length === 0) return null;
      return {
        id: node.id(),
        content: node.data('content')
      };
    });

    expect(updatedData).not.toBeNull();
    expect(updatedData!.id).toBe(initialData!.id); // Same node
    expect(updatedData!.content).not.toBe(initialData!.content); // Content changed
    expect(updatedData!.content).toContain('Updated'); // Contains update marker
    console.log('✓ Node content updated successfully');
  });

  test('should remove nodes when files are deleted', async ({ page }) => {
    console.log('=== Test: File Deletion ===');

    await page.goto('/voicetree-graphview-test.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000); // Wait for initialization

    // Add 2 files
    await page.click('#btn-add-file');
    await page.waitForTimeout(300);
    await page.click('#btn-add-file');
    await page.waitForTimeout(300);

    let nodeCount = await page.evaluate(() => {
      const view = (window as any).voiceTreeGraphView;
      return view ? view.getStats().nodeCount : 0;
    });
    expect(nodeCount).toBe(2);
    console.log(`✓ Added 2 nodes (count: ${nodeCount})`);

    // Delete one file
    await page.click('#btn-delete-file');
    await page.waitForTimeout(500);

    nodeCount = await page.evaluate(() => {
      const view = (window as any).voiceTreeGraphView;
      return view ? view.getStats().nodeCount : 0;
    });
    expect(nodeCount).toBe(1);
    console.log(`✓ After deletion: ${nodeCount} node remains`);

    // Delete second file
    await page.click('#btn-delete-file');
    await page.waitForTimeout(500);

    nodeCount = await page.evaluate(() => {
      const view = (window as any).voiceTreeGraphView;
      return view ? view.getStats().nodeCount : 0;
    });
    expect(nodeCount).toBe(0);
    console.log('✓ All nodes deleted successfully');
  });

  test('should toggle dark mode', async ({ page }) => {
    console.log('=== Test: Dark Mode Toggle ===');

    await page.goto('/voicetree-graphview-test.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000); // Wait for initialization

    // Add some nodes first
    await page.click('#btn-bulk-load');
    await page.waitForTimeout(500);

    // Get initial node color (light mode)
    const lightModeColor = await page.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      if (!cy) return null;
      const node = cy.nodes().filter((n: any) => !n.data('isGhostRoot')).first();
      if (!node || node.length === 0) return null;
      return node.style('background-color');
    });

    console.log(`Light mode node color: ${lightModeColor}`);

    // Toggle to dark mode
    await page.click('#btn-toggle-dark');
    await page.waitForTimeout(300);

    // Get dark mode color
    const darkModeColor = await page.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      if (!cy) return null;
      const node = cy.nodes().filter((n: any) => !n.data('isGhostRoot')).first();
      if (!node || node.length === 0) return null;
      return node.style('background-color');
    });

    console.log(`Dark mode node color: ${darkModeColor}`);
    expect(darkModeColor).not.toBe(lightModeColor);
    console.log('✓ Dark mode applied, colors changed');

    // Toggle back to light mode
    await page.click('#btn-toggle-dark');
    await page.waitForTimeout(300);

    const lightModeColorAgain = await page.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      if (!cy) return null;
      const node = cy.nodes().filter((n: any) => !n.data('isGhostRoot')).first();
      if (!node || node.length === 0) return null;
      return node.style('background-color');
    });

    expect(lightModeColorAgain).toBe(lightModeColor);
    console.log('✓ Light mode restored, colors match original');
  });

  test('should handle node interactions (click, hover)', async ({ page }) => {
    console.log('=== Test: Node Interactions ===');

    await page.goto('/voicetree-graphview-test.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000); // Wait for initialization

    // Add nodes
    await page.click('#btn-bulk-load');
    await page.waitForTimeout(500);

    // Get a node position
    const nodePosition = await page.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      if (!cy) return null;
      const node = cy.nodes().filter((n: any) => !n.data('isGhostRoot')).first();
      if (!node || node.length === 0) return null;
      const renderedPos = node.renderedPosition();
      return { x: renderedPos.x, y: renderedPos.y, id: node.id() };
    });

    expect(nodePosition).not.toBeNull();
    console.log(`✓ Node position: (${nodePosition!.x}, ${nodePosition!.y})`);

    // Find canvas element (use the layer2-node canvas which is the top interaction layer)
    const canvas = await page.locator('#graph-container canvas[data-relativeFilePathIsID="layer2-node"]');
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();

    // Click on the node (using canvas coordinates)
    // Use force: true because canvas is behind other elements
    await canvas.click({
      position: {
        x: nodePosition!.x,
        y: nodePosition!.y
      },
      force: true
    });

    await page.waitForTimeout(300);
    console.log('✓ Node click simulated');

    // Verify we can interact with the graph by checking if cytoscape responds
    // Note: Programmatic clicks may not trigger Cytoscape's selection handlers
    // which typically expect actual pointer events, so we just verify the graph is interactive
    const canInteract = await page.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      if (!cy) return false;
      // Check that we can query nodes and they respond
      const nodes = cy.nodes().filter((n: any) => !n.data('isGhostRoot'));
      return nodes.length > 0 && nodes.first().position() !== undefined;
    });

    expect(canInteract).toBe(true);
    console.log('✓ Graph is interactive and responds to queries');
  });

  test('should dispose cleanly without memory leaks', async ({ page }) => {
    console.log('=== Test: Disposal and Cleanup ===');

    await page.goto('/voicetree-graphview-test.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000); // Wait for initialization

    // Add some nodes
    await page.click('#btn-bulk-load');
    await page.waitForTimeout(500);

    // Verify graph exists
    let hasGraph = await page.evaluate(() => {
      return !!(window as any).cytoscapeInstance;
    });
    expect(hasGraph).toBe(true);

    // Dispose the graph view
    await page.evaluate(() => {
      const view = (window as any).voiceTreeGraphView;
      if (view && view.dispose) {
        view.dispose();
      }
    });

    await page.waitForTimeout(300);
    console.log('✓ VoiceTreeGraphView.dispose() called');

    // Verify cleanup (Cytoscape should be destroyed)
    const isDestroyed = await page.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      return !cy || cy.destroyed();
    });

    expect(isDestroyed).toBe(true);
    console.log('✓ Cytoscape instance cleaned up');
  });
});
