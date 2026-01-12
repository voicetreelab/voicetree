/**
 * TDD TEST - Context Node Highlighting
 *
 * BEHAVIORAL SPEC:
 * When a user selects a context node in the graph, all nodes whose content
 * is contained within that context node should be visually highlighted.
 * This helps users understand which nodes contributed to the context.
 *
 * PRECONDITION: Requires a context node with:
 * - isContextNode: true in frontmatter
 * - containedNodeIds array pointing to existing nodes
 *
 * This test should FAIL until implementation is complete.
 *
 * EXPECTED FAILURE MODES (before implementation):
 * - No .context-contained class on nodes
 * - No .context-edge class on edges
 *
 * IMPLEMENTATION CHECKLIST:
 * 1. Add CONTEXT_CONTAINED_CLASS and CONTEXT_EDGE_CLASS to constants.ts
 * 2. Add gold dashed border styles in StyleService.ts
 * 3. Create highlightContextNodes.ts utility module
 * 4. Wire up select/unselect handlers in setupBasicCytoscapeEventListeners.ts
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

// Use absolute paths for example_folder_fixtures
const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');

// Type definitions
interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

// Extend test with Electron app
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    // Create a temporary userData directory for this test
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-ctx-highlight-test-'));

    // Write the config file to auto-load the test vault
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({
      lastDirectory: FIXTURE_VAULT_PATH,
      suffixes: {
        [FIXTURE_VAULT_PATH]: '' // Empty suffix means use directory directly
      }
    }, null, 2), 'utf8');
    console.log('[Test] Created config file to auto-load:', FIXTURE_VAULT_PATH);

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
        VOICETREE_PERSIST_STATE: '1'
      },
      timeout: 10000
    });

    await use(electronApp);

    // Graceful shutdown
    try {
      const window = await electronApp.firstWindow();
      await window.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (api) {
          await api.main.stopFileWatching();
        }
      });
      await window.waitForTimeout(300);
    } catch {
      console.log('Note: Could not stop file watching during cleanup');
    }

    await electronApp.close();

    // Cleanup temp directory
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15000 });

    // Log console messages for debugging
    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    // Capture page errors
    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');

    // Wait for cytoscape instance with retry logic
    try {
      await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
    } catch (error) {
      console.error('Failed to initialize cytoscape instance:', error);
      throw error;
    }

    await window.waitForTimeout(1000);

    await use(window);
  }
});

/**
 * Wait for graph to load and have nodes
 */
async function waitForGraphLoaded(appWindow: Page): Promise<void> {
  await expect.poll(async () => {
    return appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return 0;
      return cy.nodes().length;
    });
  }, {
    message: 'Waiting for graph to load nodes',
    timeout: 15000,
    intervals: [500, 1000, 1000]
  }).toBeGreaterThan(0);
}

/**
 * Create a context node for testing and wait for it to appear in the graph.
 * Returns the context node ID and its containedNodeIds.
 */
async function createTestContextNode(appWindow: Page): Promise<{ contextNodeId: string; containedNodeIds: string[] }> {
  // Create context node from Node 5 (aggregates ancestors)
  const parentNodeId = '5_Immediate_Test_Observation_No_Output.md';

  const contextNodeId = await appWindow.evaluate(async (nodeId) => {
    const api = (window as ExtendedWindow).electronAPI;
    if (!api) throw new Error('electronAPI not available');
    return await api.main.createContextNode(nodeId);
  }, parentNodeId);

  console.log(`[Test] Created context node: ${contextNodeId}`);

  // Wait for context node to appear in Cytoscape
  await expect.poll(async () => {
    return appWindow.evaluate((ctxId) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return false;
      return cy.getElementById(ctxId).length > 0;
    }, contextNodeId);
  }, {
    message: 'Waiting for context node to appear in graph',
    timeout: 10000
  }).toBe(true);

  // Get containedNodeIds from the context node via main process
  const containedNodeIds = await appWindow.evaluate(async (ctxId) => {
    const api = (window as ExtendedWindow).electronAPI;
    if (!api) throw new Error('electronAPI not available');
    const node = await api.main.getNode(ctxId);
    if (!node) throw new Error(`Node ${ctxId} not found`);
    // containedNodeIds is readonly string[] | undefined
    return [...(node.nodeUIMetadata.containedNodeIds ?? [])];
  }, contextNodeId);

  console.log(`[Test] Context node containedNodeIds: ${containedNodeIds.length} nodes`);

  return { contextNodeId, containedNodeIds };
}

/**
 * Select a node by ID via Cytoscape
 */
async function selectNode(appWindow: Page, nodeId: string): Promise<void> {
  await appWindow.evaluate((id) => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not available');
    cy.getElementById(id).select();
  }, nodeId);
}

/**
 * Unselect all nodes
 */
async function unselectAllNodes(appWindow: Page): Promise<void> {
  await appWindow.evaluate(() => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not available');
    cy.nodes().unselect();
  });
}

/**
 * Get IDs of nodes with a specific class
 */
async function getNodesWithClass(appWindow: Page, className: string): Promise<string[]> {
  return appWindow.evaluate((cls) => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) return [];
    return cy.nodes(`.${cls}`).map(n => n.id());
  }, className);
}

/**
 * Get count of edges with a specific class
 */
async function getEdgeCountWithClass(appWindow: Page, className: string): Promise<number> {
  return appWindow.evaluate((cls) => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) return 0;
    return cy.edges(`.${cls}`).length;
  }, className);
}

test.describe('Context Node Highlighting', () => {

  test('selecting context node highlights contained nodes', async ({ appWindow }) => {
    test.setTimeout(60000); // 60 second timeout for context node creation

    console.log('=== TEST: selecting context node highlights contained nodes ===');

    // ARRANGE: Wait for graph to load
    await waitForGraphLoaded(appWindow);
    console.log('✓ Graph loaded');

    // Create a context node for testing
    const { contextNodeId, containedNodeIds } = await createTestContextNode(appWindow);

    expect(containedNodeIds.length).toBeGreaterThan(0);
    console.log(`✓ Context node has ${containedNodeIds.length} contained nodes`);

    // ACT: Select the context node (triggers highlight)
    await selectNode(appWindow, contextNodeId);
    console.log('✓ Selected context node');

    // Small delay for async highlighting
    await appWindow.waitForTimeout(200);

    // Take screenshot of highlighted state
    await appWindow.screenshot({ path: 'e2e-tests/screenshots/context-node-highlighting.png' });

    // ASSERT: Contained nodes have highlight class
    const highlightedNodeIds = await getNodesWithClass(appWindow, 'context-contained');

    console.log(`Highlighted nodes: ${highlightedNodeIds.length}`);
    console.log(`Expected containedNodeIds: ${containedNodeIds.join(', ')}`);
    console.log(`Actual highlighted: ${highlightedNodeIds.join(', ')}`);

    // Every highlighted node should be in containedNodeIds
    // (Not all containedNodeIds may be in Cytoscape - some may be in subfolders not loaded)
    expect(highlightedNodeIds.length).toBeGreaterThan(0);
    for (const nodeId of highlightedNodeIds) {
      expect(containedNodeIds).toContain(nodeId);
    }

    console.log('✅ TEST PASSED: contained nodes are highlighted');
  });

  test('selecting different node clears highlights', async ({ appWindow }) => {
    test.setTimeout(60000);

    console.log('=== TEST: selecting different node clears highlights ===');

    // ARRANGE: Wait for graph to load and create context node
    await waitForGraphLoaded(appWindow);
    const { contextNodeId, containedNodeIds } = await createTestContextNode(appWindow);

    expect(containedNodeIds.length).toBeGreaterThan(0);

    // Select context node first (triggers highlight)
    await selectNode(appWindow, contextNodeId);
    await appWindow.waitForTimeout(200);

    // Verify highlights exist
    const initialHighlightCount = (await getNodesWithClass(appWindow, 'context-contained')).length;
    expect(initialHighlightCount).toBeGreaterThan(0);
    console.log(`✓ Initial highlights: ${initialHighlightCount}`);

    // ACT: Select a non-context node (first contained node)
    const nonContextNodeId = containedNodeIds[0];
    await selectNode(appWindow, nonContextNodeId);
    await appWindow.waitForTimeout(200);
    console.log(`✓ Selected non-context node: ${nonContextNodeId}`);

    // ASSERT: All highlights cleared
    const finalHighlightCount = (await getNodesWithClass(appWindow, 'context-contained')).length;

    console.log(`Final highlight count: ${finalHighlightCount}`);
    expect(finalHighlightCount).toBe(0);

    console.log('✅ TEST PASSED: highlights cleared when selecting different node');
  });

  test('edges to contained nodes are highlighted', async ({ appWindow }) => {
    test.setTimeout(60000);

    console.log('=== TEST: edges to contained nodes are highlighted ===');

    // ARRANGE: Wait for graph to load and create context node
    await waitForGraphLoaded(appWindow);
    const { contextNodeId, containedNodeIds } = await createTestContextNode(appWindow);

    expect(containedNodeIds.length).toBeGreaterThan(0);

    // ACT: Select context node
    await selectNode(appWindow, contextNodeId);
    await appWindow.waitForTimeout(200);
    console.log('✓ Selected context node');

    // ASSERT: Edges have highlight class
    const highlightedEdgeCount = await getEdgeCountWithClass(appWindow, 'context-edge');

    console.log(`Highlighted edges: ${highlightedEdgeCount}`);
    expect(highlightedEdgeCount).toBeGreaterThan(0);

    console.log('✅ TEST PASSED: edges to contained nodes are highlighted');
  });

  test('edge from task node to context node is highlighted', async ({ appWindow }) => {
    test.setTimeout(60000);

    console.log('=== TEST: edge from task node to context node is highlighted ===');

    // ARRANGE: Wait for graph to load and create context node
    await waitForGraphLoaded(appWindow);
    const { contextNodeId } = await createTestContextNode(appWindow);

    // ACT: Select context node
    await selectNode(appWindow, contextNodeId);
    await appWindow.waitForTimeout(200);
    console.log('✓ Selected context node');

    // ASSERT: The edge targeting the context node (from its parent/task node) is highlighted
    const edgeToContextNodeHighlighted = await appWindow.evaluate((ctxId) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return false;
      // Find edges where target is the context node
      const edgesToContextNode = cy.edges(`[target="${ctxId}"]`);
      return edgesToContextNode.filter('.context-edge').length > 0;
    }, contextNodeId);

    expect(edgeToContextNodeHighlighted).toBe(true);

    console.log('✅ TEST PASSED: edge from task node to context node is highlighted');
  });

  test('deselecting context node clears highlights', async ({ appWindow }) => {
    test.setTimeout(60000);

    console.log('=== TEST: deselecting context node clears highlights ===');

    // ARRANGE: Wait for graph to load and create context node
    await waitForGraphLoaded(appWindow);
    const { contextNodeId, containedNodeIds } = await createTestContextNode(appWindow);

    expect(containedNodeIds.length).toBeGreaterThan(0);

    // Select context node
    await selectNode(appWindow, contextNodeId);
    await appWindow.waitForTimeout(200);

    // Verify highlights exist
    const initialNodeHighlights = (await getNodesWithClass(appWindow, 'context-contained')).length;
    const initialEdgeHighlights = await getEdgeCountWithClass(appWindow, 'context-edge');

    expect(initialNodeHighlights).toBeGreaterThan(0);
    console.log(`✓ Initial node highlights: ${initialNodeHighlights}`);
    console.log(`✓ Initial edge highlights: ${initialEdgeHighlights}`);

    // ACT: Deselect all nodes
    await unselectAllNodes(appWindow);
    await appWindow.waitForTimeout(200);
    console.log('✓ Deselected all nodes');

    // ASSERT: Highlights cleared
    const nodeHighlights = (await getNodesWithClass(appWindow, 'context-contained')).length;
    const edgeHighlights = await getEdgeCountWithClass(appWindow, 'context-edge');

    console.log(`Final node highlights: ${nodeHighlights}`);
    console.log(`Final edge highlights: ${edgeHighlights}`);

    expect(nodeHighlights).toBe(0);
    expect(edgeHighlights).toBe(0);

    console.log('✅ TEST PASSED: highlights cleared when deselecting');
  });
});

export { test };
