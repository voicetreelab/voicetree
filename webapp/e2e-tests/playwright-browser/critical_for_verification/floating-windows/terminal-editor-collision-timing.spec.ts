/**
 * E2E test for terminal/editor collision detection TIMING hypothesis
 *
 * HYPOTHESIS TESTED:
 * The collision detection fails because when the terminal's anchorToNode() runs,
 * the editor's shadow node dimensions are 0 or incorrect due to:
 * 1. DOM not being fully rendered (offsetWidth/offsetHeight return 0)
 * 2. requestAnimationFrame dimension update not having fired yet
 *
 * This test:
 * 1. Opens an editor (creates shadow node)
 * 2. Immediately (with NO wait) spawns a terminal
 * 3. Logs what dimensions the collision detection ACTUALLY sees
 * 4. Verifies whether dimensions are correct (480x400) or wrong (0 or small)
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

// Custom fixture to capture console logs
type ConsoleCapture = {
  consoleLogs: string[];
  pageErrors: string[];
};

const test = base.extend<{ consoleCapture: ConsoleCapture }>({
  consoleCapture: async ({ page }, use, testInfo) => {
    const consoleLogs: string[] = [];
    const pageErrors: string[] = [];

    page.on('console', msg => {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    });

    page.on('pageerror', error => {
      pageErrors.push(`[Error] ${error.message}`);
    });

    await use({ consoleLogs, pageErrors });

    // Always log on failure, optionally on success for debugging
    if (testInfo.status !== 'passed') {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const floatingWindowsModule = await import('/src/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows.ts' as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chromeModule = await import('/src/shell/edge/UI-edge/floating-windows/create-window-chrome.ts' as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anchorModule = await import('/src/shell/edge/UI-edge/floating-windows/anchor-to-node.ts' as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const types = await import('/src/shell/edge/UI-edge/floating-windows/types.ts' as any);

    (window as unknown as {
      floatingWindowAPI: {
        createWindowChrome: typeof chromeModule.createWindowChrome;
        getOrCreateOverlay: typeof floatingWindowsModule.getOrCreateOverlay;
        anchorToNode: typeof anchorModule.anchorToNode;
        createTerminalData: typeof types.createTerminalData;
        getTerminalId: typeof types.getTerminalId;
        getShadowNodeId: typeof types.getShadowNodeId;
      };
    }).floatingWindowAPI = {
      createWindowChrome: chromeModule.createWindowChrome,
      getOrCreateOverlay: floatingWindowsModule.getOrCreateOverlay,
      anchorToNode: anchorModule.anchorToNode,
      createTerminalData: types.createTerminalData,
      getTerminalId: types.getTerminalId,
      getShadowNodeId: types.getShadowNodeId
    };
  });
}

test.describe('Terminal/Editor Collision TIMING Hypothesis', () => {

  test('HYPOTHESIS: editor shadow node dimensions should be correct when terminal checks collision', async ({ page, consoleCapture }) => {
    // Setup
    await setupMockElectronAPI(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);
    await exposeTerminalStoreAPI(page);
    await exposeFloatingWindowAPI(page);

    // Create test node
    const testNodeId = 'timing-test-node.md';
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: testNodeId,
          contentWithoutYamlOrLinks: '# Timing Test Node',
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

    // Open editor via tap
    await page.evaluate((nodeId: string) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$(`#${CSS.escape(nodeId)}`);
      node.trigger('tap');
    }, testNodeId);

    // Wait for editor window to appear in DOM
    const escapedNodeId = testNodeId.replace(/\./g, '\\.');
    const editorSelector = `#window-${escapedNodeId}-editor`;
    await page.waitForSelector(editorSelector, { timeout: 3000 });

    // CRITICAL: Check editor shadow node dimensions IMMEDIATELY (no extra wait)
    // This tests what the terminal would see if it spawned right now
    const immediateEditorDims = await page.evaluate((nodeId: string) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const editorId = `${nodeId}-editor`;
      const shadowNodeId = `${editorId}-anchor-shadowNode`;
      const shadowNode = cy.$(`#${CSS.escape(shadowNodeId)}`);

      if (shadowNode.length === 0) {
        return { found: false, width: 0, height: 0, id: shadowNodeId };
      }

      return {
        found: true,
        id: shadowNodeId,
        width: shadowNode.width(),
        height: shadowNode.height(),
        // Also check the style values directly
        styleWidth: shadowNode.style('width'),
        styleHeight: shadowNode.style('height')
      };
    }, testNodeId);

    console.log('=== IMMEDIATE editor shadow node dimensions (NO extra wait) ===');
    console.log(`  Found: ${immediateEditorDims.found}`);
    console.log(`  Width: ${immediateEditorDims.width}, Height: ${immediateEditorDims.height}`);
    console.log(`  Style width: ${immediateEditorDims.styleWidth}, Style height: ${immediateEditorDims.styleHeight}`);

    // Now spawn terminal IMMEDIATELY (simulating the race condition)
    const collisionDebugData = await page.evaluate((nodeId: string) => {
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

      // Capture all nodes and their dimensions BEFORE terminal placement
      const existingNodesBefore: Array<{id: string; isShadow: boolean; width: number; height: number; x: number; y: number}> = [];
      cy.nodes().forEach((node: { id: () => string; data: (key: string) => unknown; width: () => number; height: () => number; position: () => {x: number; y: number} }) => {
        existingNodesBefore.push({
          id: node.id(),
          isShadow: node.data('isShadowNode') === true,
          width: node.width(),
          height: node.height(),
          x: node.position().x,
          y: node.position().y
        });
      });

      // Create terminal
      const terminalData = api.createTerminalData({
        attachedToNodeId: nodeId,
        anchoredToNodeId: nodeId,
        terminalCount: 0,
        title: 'Test Terminal'
      });

      const terminalId = api.getTerminalId(terminalData);
      const terminalShadowId = api.getShadowNodeId(terminalId);

      // Create window chrome
      const ui = api.createWindowChrome(cy, terminalData, terminalId);
      const terminalWithUI = { ...terminalData as object, ui };

      // Add to overlay
      const overlay = api.getOrCreateOverlay(cy);
      overlay.appendChild(ui.windowElement);

      // Call anchorToNode - this runs collision detection
      api.anchorToNode(cy, terminalWithUI);

      // Get terminal position
      const terminalShadow = cy.$(`#${CSS.escape(terminalShadowId)}`);
      const terminalPos = terminalShadow.length > 0 ? terminalShadow.position() : { x: 0, y: 0 };

      // Get parent node position
      const parentNode = cy.$(`#${CSS.escape(nodeId)}`);
      const parentPos = parentNode.position();

      return {
        existingNodesBefore,
        terminalPosition: terminalPos,
        parentPosition: parentPos,
        terminalIsToRight: terminalPos.x > parentPos.x
      };
    }, testNodeId);

    console.log('\n=== COLLISION DETECTION DEBUG DATA ===');
    console.log('Existing nodes when terminal ran anchorToNode:');
    collisionDebugData.existingNodesBefore.forEach(n => {
      const shadowLabel = n.isShadow ? ' [SHADOW]' : '';
      console.log(`  ${n.id}${shadowLabel}: ${n.width}x${n.height} at (${n.x.toFixed(1)}, ${n.y.toFixed(1)})`);
    });
    console.log(`\nTerminal placed at: (${collisionDebugData.terminalPosition.x.toFixed(1)}, ${collisionDebugData.terminalPosition.y.toFixed(1)})`);
    console.log(`Parent node at: (${collisionDebugData.parentPosition.x.toFixed(1)}, ${collisionDebugData.parentPosition.y.toFixed(1)})`);
    console.log(`Terminal is to the right: ${collisionDebugData.terminalIsToRight}`);

    // Find the editor shadow node in the debug data
    const editorShadowInDebug = collisionDebugData.existingNodesBefore.find(
      n => n.isShadow && n.id.includes('editor')
    );

    // ASSERTIONS

    // 1. Editor shadow node should exist
    expect(editorShadowInDebug).toBeDefined();
    console.log(`\n=== HYPOTHESIS TEST RESULTS ===`);

    if (editorShadowInDebug) {
      // 2. Editor shadow node dimensions should be reasonable (not 0, not tiny default)
      // Note: Editors use auto-height with MIN_HEIGHT = 200, default width is 380
      const EXPECTED_MIN_WIDTH = 380; // Default editor width from types.ts
      const EXPECTED_MIN_HEIGHT = 150; // Auto-height starts at 200, allow some margin

      const hasCorrectDimensions =
        editorShadowInDebug.width >= EXPECTED_MIN_WIDTH &&
        editorShadowInDebug.height >= EXPECTED_MIN_HEIGHT;

      console.log(`Editor shadow dimensions: ${editorShadowInDebug.width}x${editorShadowInDebug.height}`);
      console.log(`Expected minimum: ${EXPECTED_MIN_WIDTH}x${EXPECTED_MIN_HEIGHT}`);
      console.log(`Dimensions correct: ${hasCorrectDimensions}`);

      if (!hasCorrectDimensions) {
        console.log('\n*** HYPOTHESIS CONFIRMED: Editor shadow has wrong dimensions! ***');
        console.log('This explains why collision detection fails.');

        // Check if terminal was incorrectly placed to the right
        if (collisionDebugData.terminalIsToRight) {
          console.log('*** BUG REPRODUCED: Terminal placed to right despite editor being there ***');
        }
      }

      // Assert that dimensions are correct (this should FAIL if the hypothesis is correct)
      expect(editorShadowInDebug.width).toBeGreaterThanOrEqual(EXPECTED_MIN_WIDTH);
      expect(editorShadowInDebug.height).toBeGreaterThanOrEqual(EXPECTED_MIN_HEIGHT);
    }

    // Take screenshot
    await page.screenshot({
      path: 'e2e-tests/screenshots/terminal-editor-collision-timing.png',
      fullPage: false
    });

    // Log all captured console messages that contain anchorToNode
    console.log('\n=== anchorToNode debug logs from browser ===');
    consoleCapture.consoleLogs
      .filter(log => log.includes('anchorToNode'))
      .forEach(log => console.log(log));
  });

  test('editor shadow dimensions should be correct AFTER requestAnimationFrame', async ({ page }) => {
    // Setup
    await setupMockElectronAPI(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);
    await exposeTerminalStoreAPI(page);
    await exposeFloatingWindowAPI(page);

    // Create test node
    const testNodeId = 'raf-test-node.md';
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: testNodeId,
          contentWithoutYamlOrLinks: '# RAF Test Node',
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

    // Open editor
    await page.evaluate((nodeId: string) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$(`#${CSS.escape(nodeId)}`);
      node.trigger('tap');
    }, testNodeId);

    const escapedNodeId = testNodeId.replace(/\./g, '\\.');
    await page.waitForSelector(`#window-${escapedNodeId}-editor`, { timeout: 3000 });

    // Check dimensions IMMEDIATELY
    const immediateDims = await page.evaluate((nodeId: string) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance!;
      const shadowNode = cy.$(`#${CSS.escape(`${nodeId}-editor-anchor-shadowNode`)}`);
      return { width: shadowNode.width(), height: shadowNode.height() };
    }, testNodeId);

    // Wait for requestAnimationFrame to fire
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    await page.waitForTimeout(50); // Extra buffer

    // Check dimensions AFTER RAF
    const afterRafDims = await page.evaluate((nodeId: string) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance!;
      const shadowNode = cy.$(`#${CSS.escape(`${nodeId}-editor-anchor-shadowNode`)}`);
      return { width: shadowNode.width(), height: shadowNode.height() };
    }, testNodeId);

    console.log('=== Dimension Comparison ===');
    console.log(`IMMEDIATE: ${immediateDims.width}x${immediateDims.height}`);
    console.log(`AFTER RAF: ${afterRafDims.width}x${afterRafDims.height}`);

    const dimensionsChanged =
      immediateDims.width !== afterRafDims.width ||
      immediateDims.height !== afterRafDims.height;

    if (dimensionsChanged) {
      console.log('*** TIMING ISSUE CONFIRMED: Dimensions change after RAF ***');
      console.log('This means collision detection could see wrong values if it runs before RAF');
    } else {
      console.log('Dimensions are stable - no timing issue detected');
    }

    // Both should be correct
    // Note: Editors use auto-height with MIN_HEIGHT = 200, default width is 380
    expect(afterRafDims.width).toBeGreaterThanOrEqual(380); // Default editor width from types.ts
    expect(afterRafDims.height).toBeGreaterThanOrEqual(200); // Auto-height min
  });
});
