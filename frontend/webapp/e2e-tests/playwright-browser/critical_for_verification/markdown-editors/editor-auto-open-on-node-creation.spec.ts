/**
 * Browser-based test for automatic editor opening when creating nodes
 * Tests that editors automatically open after:
 * 1. Creating a child node via context menu "Create Child" action
 * 2. Creating a standalone node via context menu "Add GraphNode Here" action
 *
 * This test currently REPRODUCES A BUG where the editor does not auto-open
 * despite createAnchoredFloatingEditor being called after node creation.
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  selectMockProject,
  sendGraphDelta,
  waitForCytoscapeReady,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils.ts';
import type { GraphDelta } from '@/pure/graph';

import type { Page } from '@playwright/test';
import type { GraphNode } from '@/pure/graph';

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

interface ExtendedWindowWithAll extends ExtendedWindow {
  electronAPI?: {
    main: {
      applyGraphDeltaToDBThroughMem: (delta: GraphDelta) => Promise<{ success: boolean }>;
      getGraph: () => Promise<{ nodes: Record<string, GraphNode> }>;
    };
    graph: {
      _graphState: { nodes: Record<string, unknown> };
      _updateCallback?: (delta: GraphDelta) => void;
    };
  };
}

// Extended mock that exposes the context menu handlers for testing
async function setupExtendedMockElectronAPI(page: Page): Promise<void> {
  await setupMockElectronAPI(page);

  // Add additional handlers needed for node creation
  await page.addInitScript(() => {
    const api = (window as unknown as ExtendedWindowWithAll).electronAPI;
    if (api && api.main && api.graph) {
      // Mock applyGraphDeltaToDBThroughMem to update state immediately
      api.main.applyGraphDeltaToDBThroughMem = async (delta: GraphDelta) => {
        console.log('[Mock] applyGraphDeltaToDBThroughMem called with', delta.length, 'operations');

        // Update graph state
        delta.forEach((nodeDelta) => {
          if (nodeDelta.type === 'UpsertNode') {
            const node = nodeDelta.nodeToUpsert;
            api.graph._graphState.nodes[node.absoluteFilePathIsID] = node;
          } else if (nodeDelta.type === 'DeleteNode') {
            delete api.graph._graphState.nodes[nodeDelta.nodeId];
          }
        });

        // Immediately trigger the graph update callback to apply to UI-edge
        if (api.graph._updateCallback) {
          api.graph._updateCallback(delta);
        }

        return { success: true };
      };
    }
  });
}

test.describe('Editor Auto-Open on GraphNode Creation (Browser)', () => {

  test('should auto-open editor when creating child node via context menu action', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Testing child node creation with auto-open ===');

    console.log('=== Step 1: Setup mock Electron API ===');
    await setupExtendedMockElectronAPI(page);
    console.log('✓ Electron API mock prepared');

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    console.log('✓ React rendered');

    await page.waitForTimeout(50);

    console.log('=== Step 3: Wait for Cytoscape ===');
    await waitForCytoscapeReady(page);
    console.log('✓ Cytoscape initialized');

    console.log('=== Step 4: Send graph delta with parent node ===');
    const parentContent = '# Parent Node\nThis is the parent node.';
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'parent-node.md',
          contentWithoutYamlOrLinks: parentContent,
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 400, y: 400 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      }
    ];
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(50); // Wait for layout
    console.log('✓ Parent node added to graph');

    console.log('=== Step 5: Simulate Cmd+N to create child node ===');
    // Select the parent node first
    await page.evaluate(() => {
      const cytoscapeInst = (window as ExtendedWindow).cytoscapeInstance;
      if (!cytoscapeInst) throw new Error('Cytoscape not initialized');

      const parentNode = cytoscapeInst.$('#parent-node\\.md');
      if (parentNode.length === 0) throw new Error('Parent node not found');

      parentNode.select();
    });

    // Press Cmd+N to create child node (this triggers createNewNodeAction -> createAnchoredFloatingEditor)
    await page.keyboard.press('Meta+n'); // todo, incorrect, this only triggers create child if parent was :selected

    // Wait for node creation and editor to open
    await page.waitForTimeout(800);

    console.log('=== Step 6: Verify child node and editor were created ===');
    const { childNodeId, editorOpened } = await page.evaluate(() => {
      const cytoscapeInst = (window as ExtendedWindow).cytoscapeInstance;
      if (!cytoscapeInst) throw new Error('Cytoscape not initialized');

      // Find the newly created child node (should have edge from parent)
      const parentNode = cytoscapeInst.$('#parent-node\\.md');
      const childNodes = parentNode.outgoers('node').filter((n) => !n.data('isShadowNode'));

      if (childNodes.length === 0) {
        return { childNodeId: 'none', editorOpened: false };
      }

      const childId = childNodes[0].id();

      // Check if editor window exists
      // The window ID format is: window-{nodeId}-editor
      const windows = Array.from(document.querySelectorAll('[id^="window-"]'));
      const editorWindow = windows.find((w) => w.id.includes(childId) && w.id.includes('editor'));

      return {
        childNodeId: childId,
        editorOpened: editorWindow !== undefined
      };
    });

    console.log(`✓ Created child node: ${childNodeId}`);
    console.log(`  Editor opened: ${editorOpened}`);

    // Log all windows and nodes for debugging
    const debugInfo = await page.evaluate(() => {
      const cytoscapeInst = (window as ExtendedWindow).cytoscapeInstance;
      const windows = document.querySelectorAll('[id^="window-"]');
      const nodes = cytoscapeInst ? cytoscapeInst.nodes().map((n) => ({
        id: n.id(),
        isShadow: n.data('isShadowNode')
      })) : [];

      return {
        windows: Array.from(windows).map((w) => w.id),
        nodes
      };
    });

    console.log(`  Existing windows: ${debugInfo.windows.join(', ') || 'none'}`);
    console.log(`  Nodes in graph: ${JSON.stringify(debugInfo.nodes, null, 2)}`);

    // THIS TEST SHOULD PASS but currently FAILS - reproducing the bug
    expect(editorOpened).toBe(true);
  });
});
