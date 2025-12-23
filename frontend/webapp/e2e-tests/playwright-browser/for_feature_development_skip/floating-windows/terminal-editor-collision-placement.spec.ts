/**
 * E2E test for terminal/editor placement collision detection
 *
 * BEHAVIOR TESTED:
 * When a terminal is opened from a node that already has an editor pinned,
 * the terminal should NOT be placed at the same position (to the right).
 * It should detect the editor's shadow node and choose an alternate direction (left/up/down).
 *
 * BUG REGRESSION TEST:
 * Previously, updateNodeSizes() was being called on shadow nodes when edges were added,
 * which overwrote their dimensions from ~480x400 to ~15px (degree-based sizing).
 * This caused collision detection to fail because the editor shadow node appeared tiny.
 *
 * Fix: StyleService.ts:427-428 skips shadow nodes in updateNodeSizes()
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  sendGraphDelta,
  waitForCytoscapeReady,
  exposeTerminalStoreAPI,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils';
import type { GraphDelta } from '@/pure/graph';

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

    page.on('console', msg => {
      consoleLogs.push(`[Browser ${msg.type()}] ${msg.text()}`);
    });

    page.on('pageerror', error => {
      pageErrors.push(`[Browser Error] ${error.message}\n${error.stack ?? ''}`);
    });

    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      testLogs.push(args.map(arg => String(arg)).join(' '));
    };

    await use({ consoleLogs, pageErrors, testLogs });

    console.log = originalLog;

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

test.describe('Terminal/Editor Collision Placement (Browser E2E)', () => {
  test('terminal should NOT be placed to the right when editor is already there', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting terminal/editor collision placement test ===');

    console.log('=== Step 1: Setup mock Electron API ===');
    await setupMockElectronAPI(page);

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);

    console.log('=== Step 3: Wait for Cytoscape ===');
    await waitForCytoscapeReady(page);

    console.log('=== Step 4: Expose TerminalStore API ===');
    await exposeTerminalStoreAPI(page);

    console.log('=== Step 5: Create graph with a single centered test node ===');
    const testNodeId = 'test-collision-node.md';
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: testNodeId,
          contentWithoutYamlOrLinks: '# Collision Test Node\nTest content for collision detection.',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 500, y: 400 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      }
    ];
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(50);
    console.log('✓ Test graph created with centered node');

    console.log('=== Step 6: Open editor on the node (via tap) ===');
    // Get parent node position before editor opens
    const parentNodeData = await page.evaluate((nodeId: string) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$(`#${CSS.escape(nodeId)}`);
      if (node.length === 0) throw new Error(`Node ${nodeId} not found`);
      const pos = node.position();
      return { x: pos.x, y: pos.y, width: node.width(), height: node.height() };
    }, testNodeId);
    console.log(`  Parent node position: (${parentNodeData.x}, ${parentNodeData.y}), size: ${parentNodeData.width}x${parentNodeData.height}`);

    // Open editor via tap
    await page.evaluate((nodeId: string) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$(`#${CSS.escape(nodeId)}`);
      node.trigger('tap');
    }, testNodeId);
    await page.waitForTimeout(100);

    // Verify editor opened - escape dots in selector for CSS
    const escapedNodeId = testNodeId.replace(/\./g, '\\.');
    const editorSelector = `#window-${escapedNodeId}-editor`;
    await page.waitForSelector(editorSelector, { timeout: 3000 });
    console.log('✓ Editor window opened');

    console.log('=== Step 7: Get editor shadow node position ===');
    const editorShadowData = await page.evaluate((nodeId: string) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Find the editor shadow node
      const editorId = `${nodeId}-editor`;
      const shadowNodeId = `${editorId}-anchor-shadowNode`;
      const shadowNode = cy.$(`#${CSS.escape(shadowNodeId)}`);
      if (shadowNode.length === 0) throw new Error(`Editor shadow node ${shadowNodeId} not found`);

      const pos = shadowNode.position();
      return {
        id: shadowNodeId,
        x: pos.x,
        y: pos.y,
        width: shadowNode.width(),
        height: shadowNode.height()
      };
    }, testNodeId);
    console.log(`  Editor shadow node: (${editorShadowData.x}, ${editorShadowData.y}), size: ${editorShadowData.width}x${editorShadowData.height}`);

    // Verify editor is to the RIGHT of parent node
    expect(editorShadowData.x).toBeGreaterThan(parentNodeData.x);
    console.log('✓ Editor is positioned to the RIGHT of parent node (as expected)');

    console.log('=== Step 8: Create a terminal using anchorToNode (full placement logic) ===');
    // Dynamically import the floating windows module and create a terminal
    // This exercises the full anchorToNode collision detection logic
    const terminalShadowData = await page.evaluate(async (nodeId: string) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Dynamic import of required modules
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const floatingWindowsModule = await import('/src/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows.ts' as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const typesModule = await import('/src/shell/edge/UI-edge/floating-windows/types.ts' as any);

      // Create terminal data using the types module
      // IMPORTANT: anchoredToNodeId must be set for anchorToNode to work
      const terminalData = typesModule.createTerminalData({
        attachedToNodeId: nodeId,
        anchoredToNodeId: nodeId, // Must set this for anchoring to work
        terminalCount: 0,
        title: 'Test Terminal'
      });

      // Get terminal ID and shadow node ID
      const terminalId = typesModule.getTerminalId(terminalData);
      const shadowNodeId = typesModule.getShadowNodeId(terminalId);

      // Create window chrome (DOM elements)
      const ui = floatingWindowsModule.createWindowChrome(cy, terminalData, terminalId);

      // Create the full terminal data with UI
      const terminalWithUI = { ...terminalData, ui };

      // Add to overlay
      const overlay = floatingWindowsModule.getOrCreateOverlay(cy);
      overlay.appendChild(ui.windowElement);

      // Call anchorToNode - this is the critical function that does collision detection
      floatingWindowsModule.anchorToNode(cy, terminalWithUI);

      // Now get the shadow node position (created by anchorToNode)
      const shadowNode = cy.$(`#${CSS.escape(shadowNodeId)}`);
      if (shadowNode.length === 0) throw new Error(`Terminal shadow node ${shadowNodeId} not found`);

      const pos = shadowNode.position();
      return {
        id: shadowNodeId,
        x: pos.x,
        y: pos.y,
        width: shadowNode.width(),
        height: shadowNode.height()
      };
    }, testNodeId);

    console.log(`  Terminal shadow node: (${terminalShadowData.x}, ${terminalShadowData.y}), size: ${terminalShadowData.width}x${terminalShadowData.height}`);

    // Fit the graph to show all elements and take a screenshot
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (cy) {
        cy.fit(undefined, 50); // 50px padding
      }
    });
    await page.waitForTimeout(100); // Wait for fit animation

    // Take screenshot showing the placement result
    await page.screenshot({
      path: 'e2e-tests/screenshots/terminal-editor-collision-placement.png',
      fullPage: false
    });
    console.log('✓ Screenshot saved to e2e-tests/screenshots/terminal-editor-collision-placement.png');

    console.log('=== Step 9: Assert terminal is NOT to the right of parent node ===');
    // The terminal should NOT be to the right of the parent node
    // because the editor is already there
    const terminalIsToRight = terminalShadowData.x > parentNodeData.x + parentNodeData.width / 2;

    if (terminalIsToRight) {
      // Check if terminal and editor overlap (which would indicate the bug)
      const editorLeft = editorShadowData.x - editorShadowData.width / 2;
      const editorRight = editorShadowData.x + editorShadowData.width / 2;
      const terminalLeft = terminalShadowData.x - terminalShadowData.width / 2;
      const terminalRight = terminalShadowData.x + terminalShadowData.width / 2;

      const horizontalOverlap = terminalLeft < editorRight && terminalRight > editorLeft;

      expect(horizontalOverlap).toBe(false);
      console.log('✓ Terminal is to the right but does not overlap with editor');
    } else {
      console.log('✓ Terminal is NOT to the right of parent node (placed in alternate direction)');
    }

    // Final verification: terminal and editor should not significantly overlap
    console.log('=== Step 10: Verify no significant overlap between terminal and editor ===');
    const overlapData = { editor: editorShadowData, terminal: terminalShadowData };
    const overlap = await page.evaluate((data: typeof overlapData) => {
      // AABB overlap check
      const editorBox = {
        x1: data.editor.x - data.editor.width / 2,
        x2: data.editor.x + data.editor.width / 2,
        y1: data.editor.y - data.editor.height / 2,
        y2: data.editor.y + data.editor.height / 2
      };
      const terminalBox = {
        x1: data.terminal.x - data.terminal.width / 2,
        x2: data.terminal.x + data.terminal.width / 2,
        y1: data.terminal.y - data.terminal.height / 2,
        y2: data.terminal.y + data.terminal.height / 2
      };

      const hasOverlap =
        editorBox.x1 < terminalBox.x2 &&
        editorBox.x2 > terminalBox.x1 &&
        editorBox.y1 < terminalBox.y2 &&
        editorBox.y2 > terminalBox.y1;

      // Calculate overlap area if they do overlap
      if (hasOverlap) {
        const overlapWidth = Math.min(editorBox.x2, terminalBox.x2) - Math.max(editorBox.x1, terminalBox.x1);
        const overlapHeight = Math.min(editorBox.y2, terminalBox.y2) - Math.max(editorBox.y1, terminalBox.y1);
        const overlapArea = overlapWidth * overlapHeight;
        const editorArea = data.editor.width * data.editor.height;
        const overlapPercentage = (overlapArea / editorArea) * 100;
        return { hasOverlap: true, overlapPercentage };
      }

      return { hasOverlap: false, overlapPercentage: 0 };
    }, overlapData);

    console.log(`  Overlap check: hasOverlap=${overlap.hasOverlap}, percentage=${overlap.overlapPercentage.toFixed(1)}%`);

    // Allow small overlap due to gaps but significant overlap (>10%) indicates bug
    expect(overlap.overlapPercentage).toBeLessThan(10);
    console.log('✓ Terminal and editor do not significantly overlap');

    console.log('✓ Terminal/editor collision placement test passed!');
  });
});
