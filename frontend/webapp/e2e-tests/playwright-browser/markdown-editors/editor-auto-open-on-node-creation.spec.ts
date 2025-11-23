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
      applyGraphDeltaToDBAndMem: (delta: GraphDelta) => Promise<{ success: boolean }>;
      getGraph: () => Promise<{ nodes: Record<string, GraphNode> }>;
    };
    graph: {
      _graphState: { nodes: Record<string, unknown> };
      _updateCallback?: (delta: GraphDelta) => void;
    };
  };
  voiceTreeGraphView?: {
    floatingWindowManager?: {
      createAnchoredFloatingEditor: (nodeId: string) => Promise<void>;
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
      // Mock applyGraphDeltaToDBAndMem to update state immediately
      api.main.applyGraphDeltaToDBAndMem = async (delta: GraphDelta) => {
        console.log('[Mock] applyGraphDeltaToDBAndMem called with', delta.length, 'operations');

        // Update graph state
        delta.forEach((nodeDelta) => {
          if (nodeDelta.type === 'UpsertNode') {
            const node = nodeDelta.nodeToUpsert;
            api.graph._graphState.nodes[node.relativeFilePathIsID] = node;
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
          relativeFilePathIsID: 'parent-node.md',
          content: parentContent,
          outgoingEdges: [],
          nodeUIMetadata: {
            title: 'Parent Node',
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 400, y: 400 } } as const
          }
        }
      }
    ];
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(50); // Wait for layout
    console.log('✓ Parent node added to graph');

    console.log('=== Step 5: Simulate child node creation (mimicking context menu "Create Child") ===');
    // This simulates what happens when the context menu "Create Child" action is triggered
    const { childNodeId, editorOpened } = await page.evaluate(async () => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Get the parent node
      const parentNode = cy.$('#parent-node\\.md');
      if (parentNode.length === 0) throw new Error('Parent node not found');

      // Get graph state
      const graphState = await (window as unknown as ExtendedWindowWithAll).electronAPI?.main.getGraph();
      if (!graphState) throw new Error('No graph state');

      const parentGraphNode = graphState.nodes['parent-node.md'];
      if (!parentGraphNode) throw new Error('Parent graph node not found');

      // Manually create child node (simulating createNewChildNodeFromUI logic)
      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 5);
      const childId = `${timestamp}${randomSuffix}`;

      const childNode = {
        relativeFilePathIsID: childId,
        content: '# New Node',
        outgoingEdges: [],
        nodeUIMetadata: {
          title: 'New Node',
          color: { _tag: 'None' } as const,
          position: { _tag: 'None' } as const // Cola will position it
        }
      };

      // Update parent to have edge to child
      const updatedParent = {
        ...parentGraphNode,
        outgoingEdges: [...parentGraphNode.outgoingEdges, { targetId: childId, label: '' }]
      };

      const delta = [
        { type: 'UpsertNode' as const, nodeToUpsert: childNode },
        { type: 'UpsertNode' as const, nodeToUpsert: updatedParent }
      ];

      // Apply delta (this will trigger UI-edge update)
      await (window as unknown as ExtendedWindowWithAll).electronAPI?.main.applyGraphDeltaToDBAndMem(delta);

      // Wait a bit for node to be added to cy
      await new Promise(resolve => setTimeout(resolve, 500));

      // NOW call createAnchoredFloatingEditor (simulating what context menu does)
      // We need to access this via the global window object
      const view = (window as unknown as ExtendedWindowWithAll).voiceTreeGraphView;
      if (view?.floatingWindowManager?.createAnchoredFloatingEditor) {
        console.log('[Test] Calling createAnchoredFloatingEditor for child:', childId);
        await view.floatingWindowManager.createAnchoredFloatingEditor(childId);
      } else {
        console.error('[Test] Cannot access createAnchoredFloatingEditor');
      }

      // Check if editor window was created
      await new Promise(resolve => setTimeout(resolve, 500));
      const editorSelector = `#window-${childId}-editor`;
      const editorEl = document.querySelector(editorSelector);

      return {
        childNodeId: childId,
        editorOpened: editorEl !== null
      };
    });

    console.log(`✓ Created child node: ${childNodeId}`);
    console.log(`  Editor opened: ${editorOpened}`);

    // Log all windows and nodes for debugging
    const debugInfo = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      const windows = document.querySelectorAll('[id^="window-"]');
      const nodes = cy ? cy.nodes().map((n) => ({
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
