/**
 * E2E test for terminal/editor placement collision detection
 *
 * BEHAVIOR TESTED:
 * When a terminal is opened from a node that already has an editor pinned,
 * the terminal should NOT be placed at the same position (to the right).
 * It should detect the editor's shadow node and choose an alternate direction (left/up/down).
 *
 * BUG REGRESSION TEST:
 * Previously, collision detection could fail due to incorrect boundingBox() values.
 * The fix uses node.width()/height() instead of boundingBox() for reliable dimensions.
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  selectMockProject,
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

/**
 * Expose floating window API for creating terminals with full collision detection
 */
async function exposeFloatingWindowAPI(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async () => {
    // Import the actual modules now that Vite has loaded them
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const floatingWindowsModule = await import('/src/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows.ts' as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createWindowChromeModule = await import('/src/shell/edge/UI-edge/floating-windows/create-window-chrome.ts' as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anchorModule = await import('/src/shell/edge/UI-edge/floating-windows/anchor-to-node.ts' as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const types = await import('/src/shell/edge/UI-edge/floating-windows/types.ts' as any);

    (window as unknown as {
      floatingWindowAPI: {
        createWindowChrome: typeof createWindowChromeModule.createWindowChrome;
        getOrCreateOverlay: typeof floatingWindowsModule.getOrCreateOverlay;
        anchorToNode: typeof anchorModule.anchorToNode;
        createTerminalData: typeof types.createTerminalData;
        getTerminalId: typeof types.getTerminalId;
        getShadowNodeId: typeof types.getShadowNodeId;
      };
    }).floatingWindowAPI = {
      createWindowChrome: createWindowChromeModule.createWindowChrome,
      getOrCreateOverlay: floatingWindowsModule.getOrCreateOverlay,
      anchorToNode: anchorModule.anchorToNode,
      createTerminalData: types.createTerminalData,
      getTerminalId: types.getTerminalId,
      getShadowNodeId: types.getShadowNodeId
    };
    console.log('[Test] FloatingWindow API exposed for browser tests');
  });
}

test.describe('Terminal/Editor Collision Detection (Browser E2E)', () => {
  test('terminal should NOT overlap with editor when opened on same node', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting terminal/editor collision test ===');

    console.log('=== Step 1: Setup mock Electron API ===');
    await setupMockElectronAPI(page);

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);

    console.log('=== Step 3: Wait for Cytoscape ===');
    await waitForCytoscapeReady(page);

    console.log('=== Step 4: Expose APIs ===');
    await exposeTerminalStoreAPI(page);
    await exposeFloatingWindowAPI(page);

    console.log('=== Step 5: Create test node at center ===');
    const testNodeId = 'test-collision-node.md';
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: testNodeId,
          contentWithoutYamlOrLinks: '# Collision Test Node\nTest content.',
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
    console.log('✓ Test graph created');

    console.log('=== Step 6: Get parent node position ===');
    const parentNodeData = await page.evaluate((nodeId: string) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$(`#${CSS.escape(nodeId)}`);
      if (node.length === 0) throw new Error(`Node ${nodeId} not found`);
      const pos = node.position();
      return { x: pos.x, y: pos.y, width: node.width(), height: node.height() };
    }, testNodeId);
    console.log(`  Parent node: (${parentNodeData.x}, ${parentNodeData.y}), size: ${parentNodeData.width}x${parentNodeData.height}`);

    console.log('=== Step 7: Open editor via tap (creates editor shadow node to the right) ===');
    await page.evaluate((nodeId: string) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$(`#${CSS.escape(nodeId)}`);
      node.trigger('tap');
    }, testNodeId);
    await page.waitForTimeout(100);

    // Wait for editor window
    const escapedNodeId = testNodeId.replace(/\./g, '\\.');
    const editorSelector = `#window-${escapedNodeId}-editor`;
    await page.waitForSelector(editorSelector, { timeout: 3000 });
    console.log('✓ Editor window opened');

    console.log('=== Step 8: Get editor shadow node position ===');
    const editorShadowData = await page.evaluate((nodeId: string) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

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
    console.log(`  Editor shadow: (${editorShadowData.x}, ${editorShadowData.y}), size: ${editorShadowData.width}x${editorShadowData.height}`);

    // Verify editor is to the RIGHT of parent node
    expect(editorShadowData.x).toBeGreaterThan(parentNodeData.x);
    console.log('✓ Editor positioned to the RIGHT of parent node');

    console.log('=== Step 9: Create terminal using anchorToNode (full collision detection) ===');
    const terminalShadowData = await page.evaluate((nodeId: string) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Get exposed API
      const api = (window as unknown as {
        floatingWindowAPI: {
          createWindowChrome: (cy: unknown, fw: unknown, id: string) => { windowElement: HTMLElement; contentContainer: HTMLElement; titleBar: HTMLElement };
          getOrCreateOverlay: (cy: unknown) => HTMLElement;
          anchorToNode: (cy: unknown, fw: unknown) => unknown;
          createTerminalData: (params: { attachedToNodeId: string; anchoredToNodeId?: string; terminalCount: number; title: string }) => unknown;
          getTerminalId: (data: unknown) => string;
          getShadowNodeId: (id: string) => string;
        };
      }).floatingWindowAPI;
      if (!api) throw new Error('FloatingWindow API not exposed');

      // Create terminal data with anchoredToNodeId set for collision detection
      const terminalData = api.createTerminalData({
        attachedToNodeId: nodeId,
        anchoredToNodeId: nodeId,
        terminalCount: 0,
        title: 'Test Terminal'
      });

      const terminalId = api.getTerminalId(terminalData);
      const shadowNodeId = api.getShadowNodeId(terminalId);

      // Create window chrome (DOM elements)
      const ui = api.createWindowChrome(cy, terminalData, terminalId);

      // Create terminal with UI populated
      const terminalWithUI = { ...terminalData as object, ui };

      // Add to overlay
      const overlay = api.getOrCreateOverlay(cy);
      overlay.appendChild(ui.windowElement);

      // Call anchorToNode - this is the critical function that does collision detection
      api.anchorToNode(cy, terminalWithUI);

      // Get the shadow node position (created by anchorToNode)
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
    console.log(`  Terminal shadow: (${terminalShadowData.x}, ${terminalShadowData.y}), size: ${terminalShadowData.width}x${terminalShadowData.height}`);

    // Take screenshot for debugging
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (cy) cy.fit(undefined, 50);
    });
    await page.waitForTimeout(100);
    await page.screenshot({
      path: 'e2e-tests/screenshots/terminal-editor-collision.png',
      fullPage: false
    });
    console.log('✓ Screenshot saved');

    console.log('=== Step 10: Assert terminal avoids editor position ===');

    // Calculate bounding boxes
    const editorBox = {
      x1: editorShadowData.x - editorShadowData.width / 2,
      x2: editorShadowData.x + editorShadowData.width / 2,
      y1: editorShadowData.y - editorShadowData.height / 2,
      y2: editorShadowData.y + editorShadowData.height / 2
    };
    const terminalBox = {
      x1: terminalShadowData.x - terminalShadowData.width / 2,
      x2: terminalShadowData.x + terminalShadowData.width / 2,
      y1: terminalShadowData.y - terminalShadowData.height / 2,
      y2: terminalShadowData.y + terminalShadowData.height / 2
    };

    // Check for AABB overlap
    const hasOverlap =
      editorBox.x1 < terminalBox.x2 &&
      editorBox.x2 > terminalBox.x1 &&
      editorBox.y1 < terminalBox.y2 &&
      editorBox.y2 > terminalBox.y1;

    if (hasOverlap) {
      // Calculate overlap area
      const overlapWidth = Math.min(editorBox.x2, terminalBox.x2) - Math.max(editorBox.x1, terminalBox.x1);
      const overlapHeight = Math.min(editorBox.y2, terminalBox.y2) - Math.max(editorBox.y1, terminalBox.y1);
      const overlapArea = overlapWidth * overlapHeight;
      const editorArea = editorShadowData.width * editorShadowData.height;
      const overlapPercentage = (overlapArea / editorArea) * 100;
      console.log(`  WARNING: Overlap detected: ${overlapPercentage.toFixed(1)}%`);

      // Allow small overlap (< 5%) due to gaps, but significant overlap indicates bug
      expect(overlapPercentage).toBeLessThan(5);
    } else {
      console.log('✓ No overlap between terminal and editor');
    }

    // Additional check: terminal should NOT be to the right if editor is there
    const terminalIsToRight = terminalShadowData.x > parentNodeData.x + parentNodeData.width / 2;
    const editorIsToRight = editorShadowData.x > parentNodeData.x + parentNodeData.width / 2;

    if (editorIsToRight && terminalIsToRight) {
      // Both to the right - verify they don't significantly overlap
      console.log('  Both windows to the right - verifying no significant overlap');
      expect(hasOverlap).toBe(false);
    } else if (editorIsToRight && !terminalIsToRight) {
      console.log('✓ Terminal correctly placed to LEFT/UP/DOWN (avoiding editor on right)');
    }

    console.log('✓ Terminal/editor collision test passed!');
  });
});
