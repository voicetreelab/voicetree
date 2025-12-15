/**
 * Visual test for handleSearchSelect padding
 * Creates a larger graph and screenshots the viewport after navigating to a node
 */

import { test, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  sendGraphDelta,
  waitForCytoscapeReady,
  getNodeCount,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils.ts';
import type { GraphDelta } from '@/pure/graph';

/**
 * Creates a larger test graph with 10 nodes spread across the viewport
 */
function createLargerTestGraphDelta(): GraphDelta {
  const nodes: GraphDelta = [];

  // Create 10 nodes in a grid-like pattern
  const nodeData = [
    { id: 'node-1.md', title: 'Introduction', x: 0, y: 0 },
    { id: 'node-2.md', title: 'Architecture', x: 300, y: 0 },
    { id: 'node-3.md', title: 'Core Principles', x: 600, y: 0 },
    { id: 'node-4.md', title: 'API Design', x: 0, y: 200 },
    { id: 'node-5.md', title: 'Testing Guide', x: 300, y: 200 },
    { id: 'node-6.md', title: 'Deployment', x: 600, y: 200 },
    { id: 'node-7.md', title: 'Monitoring', x: 0, y: 400 },
    { id: 'node-8.md', title: 'Security', x: 300, y: 400 },
    { id: 'node-9.md', title: 'Performance', x: 600, y: 400 },
    { id: 'node-10.md', title: 'Troubleshooting', x: 300, y: 600 },
  ];

  // Create edges to form a tree structure
  const edges: { from: string; to: string }[] = [
    { from: 'node-1.md', to: 'node-2.md' },
    { from: 'node-1.md', to: 'node-4.md' },
    { from: 'node-2.md', to: 'node-3.md' },
    { from: 'node-2.md', to: 'node-5.md' },
    { from: 'node-4.md', to: 'node-7.md' },
    { from: 'node-5.md', to: 'node-6.md' },
    { from: 'node-5.md', to: 'node-8.md' },
    { from: 'node-8.md', to: 'node-9.md' },
    { from: 'node-8.md', to: 'node-10.md' },
  ];

  for (const node of nodeData) {
    const outgoingEdges = edges
      .filter(e => e.from === node.id)
      .map(e => ({ targetId: e.to, label: '' }));

    nodes.push({
      type: 'UpsertNode' as const,
      nodeToUpsert: {
        relativeFilePathIsID: node.id,
        contentWithoutYamlOrLinks: `# ${node.title}\nContent for ${node.title} node.`,
        outgoingEdges,
        nodeUIMetadata: {
          color: { _tag: 'None' } as const,
          position: { _tag: 'Some', value: { x: node.x, y: node.y } } as const,
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      },
      previousNode: { _tag: 'None' } as const
    });
  }

  return nodes;
}

test.describe('handleSearchSelect Padding Visual Test', () => {
  test('screenshot after handleSearchSelect with 40% padding', async ({ page }) => {
    // Setup
    await setupMockElectronAPI(page);
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);

    // Send larger test graph
    const graphDelta = createLargerTestGraphDelta();
    await sendGraphDelta(page, graphDelta);

    const nodeCount = await getNodeCount(page);
    expect(nodeCount).toBe(10);

    // Wait for layout to settle
    await page.waitForTimeout(200);

    // Take screenshot of initial state (full graph)
    await page.screenshot({
      path: 'e2e-tests/screenshots/handle-search-select-initial.png',
      fullPage: false
    });

    // Call handleSearchSelect directly via the exposed voiceTreeGraphView
    await page.evaluate(() => {
      const graphView = (window as ExtendedWindow).voiceTreeGraphView as {
        navigateToNodeAndTrack: (nodeId: string) => void;
      };
      if (!graphView) throw new Error('voiceTreeGraphView not found');

      // Call navigateToNodeAndTrack which calls handleSearchSelect internally
      graphView.navigateToNodeAndTrack('node-8.md');
    });

    // Wait for fit animation to complete
    await page.waitForTimeout(300);

    // Take screenshot after handleSearchSelect
    await page.screenshot({
      path: 'e2e-tests/screenshots/handle-search-select-after-40-percent-padding.png',
      fullPage: false
    });

    // Log viewport info for debugging
    const viewportInfo = await page.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return null;
      return {
        zoom: cy.zoom(),
        pan: cy.pan(),
        extent: cy.extent(),
        width: cy.width(),
        height: cy.height()
      };
    });

    console.log('Viewport after handleSearchSelect:', JSON.stringify(viewportInfo, null, 2));

    // Verify the node was selected
    const selectedNodeId = await page.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return null;
      const selected = cy.$(':selected').nodes();
      return selected.length > 0 ? selected[0].id() : null;
    });

    expect(selectedNodeId).toBe('node-8.md');
    console.log('✓ Screenshot saved to e2e-tests/screenshots/handle-search-select-after-40-percent-padding.png');
  });
});
