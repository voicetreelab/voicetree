/**
 * Browser-based test for Cmd+N and Cmd+Enter hotkeys
 * Tests:
 * - Cmd+N: Create new child node (when node selected) or orphan node (when no selection)
 * - Cmd+Enter: Run terminal/coding agent on selected node
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  createTestGraphDelta,
  sendGraphDelta,
  waitForCytoscapeReady,
  getNodeCount,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils';

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

test.describe('Cmd+N and Cmd+Enter Hotkeys (Browser)', () => {
  test('should create child node with Cmd+N when node is selected', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting Cmd+N with selection test (Browser) ===');

    console.log('=== Step 1: Mock Electron API ===');
    await setupMockElectronAPI(page);

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);

    console.log('=== Step 3: Wait for Cytoscape ===');
    await waitForCytoscapeReady(page);

    console.log('=== Step 4: Setup test graph ===');
    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);

    const initialNodeCount = await getNodeCount(page);
    expect(initialNodeCount).toBe(5);
    console.log(`✓ Test graph setup with ${initialNodeCount} nodes`);

    console.log('=== Step 5: Select a node ===');
    const selectedNodeId = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Get the first node and select it
      const firstNode = cy.nodes().first();
      firstNode.select();
      return firstNode.id();
    });
    console.log(`✓ Selected node: ${selectedNodeId}`);

    console.log('=== Step 6: Press Cmd+N ===');
    await page.keyboard.press('Meta+n');

    // Wait for node creation
    await page.waitForTimeout(100);

    console.log('=== Step 7: Verify new node was created ===');
    const finalNodeCount = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      // Filter out shadow nodes (floating editors) to count only real graph nodes
      return cy.nodes().filter(node => !node.data('isShadowNode')).length;
    });
    expect(finalNodeCount).toBe(initialNodeCount + 1);
    console.log(`✓ Node count increased from ${initialNodeCount} to ${finalNodeCount}`);

    console.log('=== Step 8: Verify new node is a child of selected node ===');
    const hasChildEdge = await page.evaluate((parentId: string) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Check if there's an edge from the parent to a newly created node
      const parentNode = cy.getElementById(parentId);
      const outgoingEdges = parentNode.outgoers('edge');

      return outgoingEdges.length > 0;
    }, selectedNodeId);

    expect(hasChildEdge).toBe(true);
    console.log('✓ Cmd+N successfully created child node with edge to parent');
  });

  test('should create orphan node at center with Cmd+N when no node selected', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting Cmd+N without selection test (Browser) ===');

    console.log('=== Step 1: Mock Electron API ===');
    await setupMockElectronAPI(page);

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);

    console.log('=== Step 3: Wait for Cytoscape ===');
    await waitForCytoscapeReady(page);

    console.log('=== Step 4: Setup test graph ===');
    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);

    const initialNodeCount = await getNodeCount(page);
    expect(initialNodeCount).toBe(5);
    console.log(`✓ Test graph setup with ${initialNodeCount} nodes`);

    console.log('=== Step 5: Ensure no nodes are selected ===');
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Deselect all nodes
      cy.nodes().unselect();
    });
    console.log('✓ All nodes deselected');

    console.log('=== Step 6: Press Cmd+N ===');
    await page.keyboard.press('Meta+n');

    // Wait for node creation
    await page.waitForTimeout(100);

    console.log('=== Step 7: Verify new node was created ===');
    const finalNodeCount = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      // Filter out shadow nodes (floating editors) to count only real graph nodes
      return cy.nodes().filter(node => !node.data('isShadowNode')).length;
    });
    expect(finalNodeCount).toBe(initialNodeCount + 1);
    console.log(`✓ Node count increased from ${initialNodeCount} to ${finalNodeCount}`);

    console.log('=== Step 8: Verify new node is an orphan (no incoming edges) ===');
    const newNodeIsOrphan = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Get all nodes and find the newest one (assuming it was just added)
      const allNodes = cy.nodes();
      // Find node with no incoming edges that was recently added
      const orphanNodes = allNodes.filter(node => node.incomers('edge').length === 0);

      // Should have at least one orphan node (could be multiple if graph had orphans before)
      return orphanNodes.length >= 1;
    });

    expect(newNodeIsOrphan).toBe(true);
    console.log('✓ Cmd+N successfully created orphan node at viewport center');
  });

  test('should open terminal with Cmd+Enter when node is selected', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting Cmd+Enter test (Browser) ===');

    console.log('=== Step 1: Mock Electron API with settings ===');
    // Use standard mock setup, then extend it with additional methods
    await setupMockElectronAPI(page);

    // Extend the mock with additional methods needed for terminal spawning
    await page.addInitScript(() => {
      interface ExtendedElectronAPI {
        main: {
          loadSettings: () => Promise<{ agentCommand: string; terminalSpawnPathRelativeToWatchedDirectory?: string }>;
          createContextNode: (parentNodeId: string) => Promise<string>;
          getAppSupportPath: () => Promise<string>;
        };
      }
      const electronAPI = (window as unknown as { electronAPI: ExtendedElectronAPI }).electronAPI;
      if (electronAPI) {
        // Override loadSettings to include agentCommand
        electronAPI.main.loadSettings = async () => ({
          agentCommand: './mock-claude.sh',
          terminalSpawnPathRelativeToWatchedDirectory: undefined
        });

        // Add createContextNode method
        electronAPI.main.createContextNode = async (parentNodeId: string) => {
          // For testing, just return a mock context node ID
          return `${parentNodeId}-context`;
        };

        // Add getAppSupportPath method
        electronAPI.main.getAppSupportPath = async () => '/mock/app-support';
      }
    });

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);

    console.log('=== Step 3: Wait for Cytoscape ===');
    await waitForCytoscapeReady(page);

    console.log('=== Step 4: Setup test graph ===');
    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);

    const initialNodeCount = await getNodeCount(page);
    expect(initialNodeCount).toBe(5);
    console.log(`✓ Test graph setup with ${initialNodeCount} nodes`);

    console.log('=== Step 5: Mark first node as context node and update mock graph state ===');
    // Mark the first node as a context node so terminal spawn doesn't try to create a new one
    await page.evaluate(() => {
      interface MockGraphAPI {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        _graphState: { nodes: Record<string, any>; edges: any[] };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        _updateCallback?: (delta: any) => void;
      }
      const electronAPI = (window as ExtendedWindow).electronAPI;
      const mockGraph = electronAPI?.graph as MockGraphAPI | undefined;
      if (!mockGraph?._graphState) throw new Error('Mock graph state not available');

      const firstNodeId = 'test-node-1.md';
      const node = mockGraph._graphState.nodes[firstNodeId];
      if (node) {
        // Mark it as a context node so spawnTerminalWithNewContextNode reuses it
        node.nodeUIMetadata.isContextNode = true;
      }
    });

    console.log('=== Step 6: Select the context node ===');
    const selectedNodeId = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Get the first node and select it
      const firstNode = cy.nodes().first();
      firstNode.select();
      return firstNode.id();
    });
    console.log(`✓ Selected node: ${selectedNodeId}`);

    console.log('=== Step 7: Count initial terminal nodes ===');
    const initialTerminalCount = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Count terminal shadow nodes
      const terminals = cy.nodes().filter(node =>
        node.data('isShadowNode') === true &&
        node.data('windowType') === 'terminal'
      );
      return terminals.length;
    });
    console.log(`Initial terminal count: ${initialTerminalCount}`);

    console.log('=== Step 8: Press Cmd+Enter ===');
    await page.keyboard.press('Meta+Enter');

    // Wait for terminal creation (spawnTerminalWithNewContextNode has a 1000ms setTimeout)
    await page.waitForTimeout(1200);

    console.log('=== Step 9: Verify terminal was created ===');
    const finalTerminalCount = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Count terminal shadow nodes
      const terminals = cy.nodes().filter(node =>
        node.data('isShadowNode') === true &&
        node.data('windowType') === 'terminal'
      );
      return terminals.length;
    });

    expect(finalTerminalCount).toBe(initialTerminalCount + 1);
    console.log(`✓ Terminal count increased from ${initialTerminalCount} to ${finalTerminalCount}`);
    console.log('✓ Cmd+Enter successfully created terminal for selected node');
  });

  test('should do nothing with Cmd+Enter when no node is selected', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting Cmd+Enter without selection test (Browser) ===');

    console.log('=== Step 1: Mock Electron API ===');
    await setupMockElectronAPI(page);

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);

    console.log('=== Step 3: Wait for Cytoscape ===');
    await waitForCytoscapeReady(page);

    console.log('=== Step 4: Setup test graph ===');
    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);

    const initialNodeCount = await getNodeCount(page);
    expect(initialNodeCount).toBe(5);
    console.log(`✓ Test graph setup with ${initialNodeCount} nodes`);

    console.log('=== Step 5: Ensure no nodes are selected ===');
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Deselect all nodes
      cy.nodes().unselect();
    });
    console.log('✓ All nodes deselected');

    console.log('=== Step 6: Count initial terminal nodes ===');
    const initialTerminalCount = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Count terminal shadow nodes
      const terminals = cy.nodes().filter(node =>
        node.data('isShadowNode') === true &&
        node.data('windowType') === 'terminal'
      );
      return terminals.length;
    });
    console.log(`Initial terminal count: ${initialTerminalCount}`);

    console.log('=== Step 7: Press Cmd+Enter ===');
    await page.keyboard.press('Meta+Enter');

    // Wait to ensure nothing happens
    await page.waitForTimeout(200);

    console.log('=== Step 8: Verify no terminal was created ===');
    const finalTerminalCount = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Count terminal shadow nodes
      const terminals = cy.nodes().filter(node =>
        node.data('isShadowNode') === true &&
        node.data('windowType') === 'terminal'
      );
      return terminals.length;
    });

    expect(finalTerminalCount).toBe(initialTerminalCount);
    console.log(`✓ Terminal count remained at ${finalTerminalCount}`);
    console.log('✓ Cmd+Enter correctly did nothing when no node selected');
  });
});
