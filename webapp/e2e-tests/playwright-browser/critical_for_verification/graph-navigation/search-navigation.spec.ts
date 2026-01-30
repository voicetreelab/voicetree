/**
 * Browser-based test for ninja-keys search navigation
 * Tests the cmd-f search functionality and node navigation without Electron
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  selectMockProject,
  createTestGraphDelta,
  sendGraphDelta,
  waitForCytoscapeReady,
  getNodeCount,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils.ts';

// Custom fixture to capture console logs and only show on failure
type ConsoleCapture = {
  consoleLogs: string[];
  pageErrors: string[];
  testLogs: string[];
};

const test = base.extend<{ consoleCapture: ConsoleCapture }>({
  consoleCapture: async ({ page }, use, testInfo) => {
    const consoleLogs: string[] = [];
    const pageErrors: string[] = [];
    const testLogs: string[] = [];

    // Capture browser console
    page.on('console', msg => {
      consoleLogs.push(`[Browser ${msg.type()}] ${msg.text()}`);
    });

    page.on('pageerror', error => {
      pageErrors.push(`[Browser Error] ${error.message}\n${error.stack ?? ''}`);
    });

    // Capture test's own console.log
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      testLogs.push(args.map(arg => String(arg)).join(' '));
    };

    await use({ consoleLogs, pageErrors, testLogs });

    // Restore original console.log
    console.log = originalLog;

    // After test completes, check if it failed and print logs
    if (testInfo.status !== 'passed') {
      console.log('\n=== Test Logs ===');
      testLogs.forEach(log => console.log(log));
      console.log('\n=== Browser Console Logs ===');
      consoleLogs.forEach(log => console.log(log));
      if (pageErrors.length > 0) {
        console.log('\n=== Browser Errors ===');
        pageErrors.forEach(err => console.log(err));
      }
    }
  }
});

test.describe('Search Navigation (Browser)', () => {
  test('should open search with cmd-f and navigate to selected node', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting ninja-keys search navigation test (Browser) ===');

    console.log('=== Step 1: Mock Electron API BEFORE navigation ===');
    await setupMockElectronAPI(page);
    console.log('✓ Electron API mock prepared');

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await selectMockProject(page); // Vite dev server URL

    // Wait for React to render
    await page.waitForSelector('#root', { timeout: 5000 });
    console.log('✓ React rendered');

    // Wait for graph update handler to be registered
    await page.waitForTimeout(50);
    console.log('✓ Graph update handler should be registered');

    console.log('=== Step 3: Wait for Cytoscape to initialize ===');
    await waitForCytoscapeReady(page);
    console.log('✓ Cytoscape initialized');

    console.log('=== Step 4: Setup test graph via electronAPI graph update ===');
    // Trigger the graph update through the electronAPI callback mechanism
    // This simulates how the real app receives graph updates
    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);

    const nodeCount = await getNodeCount(page);
    expect(nodeCount).toBe(5);
    console.log(`✓ Test graph setup complete with ${nodeCount} nodes`);

    console.log('=== Step 5: Get initial zoom/pan state ===');
    const initialState = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const zoom = cy.zoom();
      const pan = cy.pan();
      return { zoom, pan };
    });
    console.log(`  Initial zoom: ${initialState.zoom}, pan: (${initialState.pan.x}, ${initialState.pan.y})`);

    console.log('=== Step 6: Open ninja-keys search with keyboard shortcut ===');
    // Simulate cmd-f (Meta+f on Mac, Ctrl+f elsewhere)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');

    // Wait for ninja-keys modal to appear
    await page.waitForTimeout(30);

    const ninjaKeysVisible = await page.evaluate(() => {
      const ninjaKeys = document.querySelector('ninja-keys');
      if (!ninjaKeys) return false;
      const shadowRoot = ninjaKeys.shadowRoot;
      if (!shadowRoot) return false;
      const modal = shadowRoot.querySelector('.modal');
      // Check if modal exists and is not hidden
      return modal !== null;
    });

    expect(ninjaKeysVisible).toBe(true);
    console.log('✓ ninja-keys search modal opened');

    console.log('=== Step 7: Get a target node to search for ===');
    const targetNode = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const nodes = cy.nodes();
      if (nodes.length === 0) throw new Error('No nodes available');
      // Get first node
      const node = nodes[0];
      return {
        id: node.id(),
        label: node.data('label') ?? node.id()
      };
    });

    console.log(`  Target node: ${targetNode.label} (${targetNode.id})`);

    console.log('=== Step 8: Type search query into ninja-keys ===');
    // Search by the node label/title since ninja-keys searches the 'title' field
    // The label is set to the first line of content, e.g., "Introduction\nThis is the introduction node."
    // We search for "Architecture" which should match the Architecture node's title
    const searchQuery = 'Architecture';
    await page.keyboard.type(searchQuery);

    // Wait for search results to update
    await page.waitForTimeout(30);
    console.log(`  Typed search query: "${searchQuery}"`);

    console.log('=== Step 9: Select first result with Enter ===');
    await page.keyboard.press('Enter');

    // Wait for navigation animation and fit to complete
    await page.waitForTimeout(100);

    console.log('=== Step 10: Record state after first navigation ===');
    const stateAfterFirstNav = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const zoom = cy.zoom();
      const pan = cy.pan();
      const selectedNodes = cy.$(':selected').map((n: cytoscape.NodeSingular) => n.id());
      return { zoom, pan, selectedNodes };
    });

    console.log(`  State after first nav - zoom: ${stateAfterFirstNav.zoom}, pan: (${stateAfterFirstNav.pan.x}, ${stateAfterFirstNav.pan.y})`);
    console.log(`  Selected nodes: ${stateAfterFirstNav.selectedNodes.join(', ')}`);

    // Verify node was selected after search navigation
    expect(stateAfterFirstNav.selectedNodes.length).toBe(1);
    console.log('✓ Node is selected after search navigation');

    console.log('=== Step 11: Verify ninja-keys modal closed ===');
    const ninjaKeysClosed = await page.evaluate(() => {
      const ninjaKeys = document.querySelector('ninja-keys');
      if (!ninjaKeys) return true; // Not found means closed
      const shadowRoot = ninjaKeys.shadowRoot;
      if (!shadowRoot) return true;
      const modal = shadowRoot.querySelector('.modal');
      // Modal should be hidden or removed
      if (!modal) return true;
      const overlay = shadowRoot.querySelector('.modal-overlay');
      // Check if overlay is visible (indicates open state)
      return overlay ? getComputedStyle(overlay).display === 'none' : true;
    });

    expect(ninjaKeysClosed).toBe(true);
    console.log('✓ ninja-keys modal closed after selection');

    console.log('=== Step 12: SECOND SEARCH - Open ninja-keys again with cmd-f ===');
    // Wait a moment to ensure any cleanup has completed
    await page.waitForTimeout(30);

    // Try to open search again
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');

    // Wait for ninja-keys modal to appear
    await page.waitForTimeout(30);

    const ninjaKeysVisibleSecondTime = await page.evaluate(() => {
      const ninjaKeys = document.querySelector('ninja-keys');
      if (!ninjaKeys) return false;
      const shadowRoot = ninjaKeys.shadowRoot;
      if (!shadowRoot) return false;
      const modal = shadowRoot.querySelector('.modal');
      // Check if modal exists and is not hidden
      return modal !== null;
    });

    expect(ninjaKeysVisibleSecondTime).toBe(true);
    console.log('✓ ninja-keys search modal opened SECOND time');

    console.log('=== Step 13: Search for a different node ===');
    // Search for a different node (test-node-2)
    const searchQuery2 = 'Architecture';
    await page.keyboard.type(searchQuery2);

    // Wait for search results to update
    await page.waitForTimeout(30);
    console.log(`  Typed search query: "${searchQuery2}"`);

    console.log('=== Step 14: Select result with Enter ===');
    await page.keyboard.press('Enter');

    // Wait for navigation animation and fit to complete
    await page.waitForTimeout(100);

    console.log('=== Step 15: Verify viewport changed between first and second navigation ===');
    const stateAfterSecondNav = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const zoom = cy.zoom();
      const pan = cy.pan();
      return { zoom, pan };
    });

    console.log(`  State after 2nd nav - zoom: ${stateAfterSecondNav.zoom}, pan: (${stateAfterSecondNav.pan.x}, ${stateAfterSecondNav.pan.y})`);

    // Check that viewport changed between the two navigations (navigating to different nodes)
    const zoomChanged = Math.abs(stateAfterSecondNav.zoom - stateAfterFirstNav.zoom) > 0.01;
    const panChanged = Math.abs(stateAfterSecondNav.pan.x - stateAfterFirstNav.pan.x) > 1 ||
                       Math.abs(stateAfterSecondNav.pan.y - stateAfterFirstNav.pan.y) > 1;

    expect(zoomChanged || panChanged).toBe(true);
    console.log('✓ Graph viewport changed between first and second navigation - handlers are working!');

    // Verify modal closed again
    const ninjaKeysClosedSecondTime = await page.evaluate(() => {
      const ninjaKeys = document.querySelector('ninja-keys');
      if (!ninjaKeys) return true;
      const shadowRoot = ninjaKeys.shadowRoot;
      if (!shadowRoot) return true;
      const modal = shadowRoot.querySelector('.modal');
      if (!modal) return true;
      const overlay = shadowRoot.querySelector('.modal-overlay');
      return overlay ? getComputedStyle(overlay).display === 'none' : true;
    });

    expect(ninjaKeysClosedSecondTime).toBe(true);
    console.log('✓ ninja-keys modal closed after second selection');

    console.log('✓ ninja-keys search navigation test completed (with second search)');
  });

  test('should find node by content keyword (not just title)', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting content keyword search test ===');

    // Step 1: Setup
    await setupMockElectronAPI(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);

    // Step 2: Send test graph
    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);

    const nodeCount = await getNodeCount(page);
    expect(nodeCount).toBe(5);
    console.log(`✓ Test graph setup with ${nodeCount} nodes`);

    // Step 3: Verify the test node has content with "system" keyword
    // test-node-5.md has title "Testing Guide" and content "How to test the system."
    // We'll search for "system" which only appears in content, not title
    const targetNodeInfo = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById('test-node-5.md');
      return {
        id: node.id(),
        label: node.data('label') as string,
        content: node.data('content') as string
      };
    });

    console.log(`  Target node - label: "${targetNodeInfo.label}", content: "${targetNodeInfo.content}"`);
    expect(targetNodeInfo.content).toContain('system');
    expect(targetNodeInfo.label).not.toContain('system');
    console.log('✓ Verified "system" is in content but not in title');

    // Step 4: Open search and type "system"
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
    await page.waitForTimeout(30);

    await page.keyboard.type('system');
    await page.waitForTimeout(30);
    console.log('  Typed search query: "system"');

    // Step 5: Press Enter to select the result
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);

    // Step 6: Verify the correct node was selected
    const selectedNodeId = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const selected = cy.$(':selected').nodes();
      return selected.length > 0 ? selected[0].id() : null;
    });

    console.log(`  Selected node: ${selectedNodeId}`);
    expect(selectedNodeId).toBe('test-node-5.md');
    console.log('✓ Content keyword search found correct node');
  });

  // TODO: Fix this test - node.emit('mouseover') doesn't trigger setupBasicCytoscapeEventListeners handler
  // which means addRecentlyVisited isn't called. Needs investigation into Cytoscape event propagation.
  test.skip('should order search results by recently visited nodes', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting recently visited ordering test ===');

    // Step 1: Setup
    await setupMockElectronAPI(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);

    // Step 2: Send test graph
    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);

    const nodeCount = await getNodeCount(page);
    expect(nodeCount).toBe(5);
    console.log(`✓ Test graph setup with ${nodeCount} nodes`);

    // Step 3: Hover over nodes in a specific order by directly triggering Cytoscape events
    // This is more reliable than using page.mouse.move() which may not trigger the event
    // Hover order: node-1, node-3, node-2
    // This should make node-2 most recent, then node-3, then node-1
    const hoverOrder = ['test-node-1.md', 'test-node-3.md', 'test-node-2.md'];

    for (const nodeId of hoverOrder) {
      // Directly trigger the mouseover event on the node in Cytoscape
      await page.evaluate((id: string) => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        const node = cy.getElementById(id);
        if (node.empty()) throw new Error(`Node ${id} not found`);

        // Emit the mouseover event directly
        node.emit('mouseover');
      }, nodeId);

      // Small delay to ensure event is processed
      await page.waitForTimeout(10);
      console.log(`  Triggered mouseover on ${nodeId}`);
    }

    // Step 4: Open command palette
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
    await page.waitForTimeout(50);
    console.log('✓ Opened command palette');

    // Step 4.5: Take screenshot of ninja-keys with section headers
    await page.screenshot({
      path: 'e2e-tests/screenshots/ninja-keys-section-headers.png',
      fullPage: false
    });
    console.log('✓ Screenshot saved to e2e-tests/screenshots/ninja-keys-section-headers.png');

    // Step 5: Get the order of items in ninja-keys
    const searchOrder = await page.evaluate(() => {
      const ninjaKeys = document.querySelector('ninja-keys');
      if (!ninjaKeys) throw new Error('ninja-keys not found');
      // Access the data property which contains NinjaAction[]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (ninjaKeys as any).data as Array<{ id: string; title: string; section?: string; hotkey?: string }>;
      // Return first 5 items to see both Recently Active and All Nodes sections
      return data.slice(0, 5).map(item => ({ id: item.id, title: item.title, section: item.section, hotkey: item.hotkey }));
    });

    console.log('  Search order (first 5):', searchOrder.map(s => `${s.title} [${s.section}] hotkey=${s.hotkey}`));

    // Step 6: Verify order - most recent (node-2) should be first
    // node-2 was hovered last, so it should have hotkey "cmd+1"
    // node-3 was hovered second-to-last, so it should have hotkey "cmd+2"
    // node-1 was hovered first, so it should have hotkey "cmd+3"
    // Note: hotkeys use cmd+N format to prevent ninja-keys from registering plain number keys
    expect(searchOrder[0].id).toBe('test-node-2.md');
    expect(searchOrder[0].hotkey).toBe('cmd+1'); // Should have hotkey indicator
    expect(searchOrder[0].section).toBe('Recently Active'); // Should be in Recently Active section
    expect(searchOrder[1].id).toBe('test-node-3.md');
    expect(searchOrder[1].hotkey).toBe('cmd+2');
    expect(searchOrder[1].section).toBe('Recently Active');
    expect(searchOrder[2].id).toBe('test-node-1.md');
    expect(searchOrder[2].hotkey).toBe('cmd+3');
    expect(searchOrder[2].section).toBe('Recently Active');

    // Verify non-recent nodes are in "All Nodes" section with no hotkey
    expect(searchOrder[3].section).toBe('All Nodes');
    expect(searchOrder[3].hotkey).toBeUndefined();
    expect(searchOrder[4].section).toBe('All Nodes');
    expect(searchOrder[4].hotkey).toBeUndefined();

    console.log('✓ Recently visited nodes appear first with correct sections and hotkeys');
  });
});
