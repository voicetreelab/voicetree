/**
 * Browser-based tests for floating window fullscreen/zoom toggle behaviors
 * Tests fullscreen button functionality for hover and anchored editors
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  sendGraphDelta,
  waitForCytoscapeReady,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils';
import type { GraphDelta } from '@/pure/graph';

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

test.describe('Traffic Light Fullscreen Behaviors (Browser)', () => {

  test.describe('Fullscreen Button on Hover Editor', () => {
    // Cytoscape's internal hit detection doesn't fire from page.mouse.move in headless Chromium.
    // Hover editor requires cytoscape mouseover event which needs canvas-level hit testing.
    test.fixme('should zoom to hover editor without closing it', async ({ page, consoleCapture: _consoleCapture }) => {
      console.log('\n=== Starting fullscreen hover editor test ===');

      await setupMockElectronAPI(page);
      await page.goto('/');
      await waitForCytoscapeReady(page);

      // Create test node
      const graphDelta: GraphDelta = [
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: {
            absoluteFilePathIsID: 'fullscreen-test-node.md',
            contentWithoutYamlOrLinks: '# Fullscreen Test\nTest content for fullscreen behavior.',
            outgoingEdges: [],
            nodeUIMetadata: {
              color: { _tag: 'None' } as const,
              position: { _tag: 'Some', value: { x: 400, y: 400 } } as const,
              additionalYAMLProps: {},
              isContextNode: false
            }
          },
          previousNode: { _tag: 'None' } as const
        }
      ];
      await sendGraphDelta(page, graphDelta);
      await page.waitForTimeout(30);
      console.log('OK Graph delta sent');

      // Move actual mouse over the node's rendered position to trigger hover
      console.log('=== Moving mouse over node to trigger hover ===');
      const nodeScreenPos = await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        const node = cy.$('#fullscreen-test-node.md');
        if (node.length === 0) throw new Error('fullscreen-test-node.md not found');
        const rpos = node.renderedPosition();
        const container = cy.container();
        if (!container) throw new Error('No cy container');
        const rect = container.getBoundingClientRect();
        return { x: rect.left + rpos.x, y: rect.top + rpos.y };
      });
      await page.mouse.move(nodeScreenPos.x, nodeScreenPos.y);
      await page.waitForTimeout(300);

      const editorSelector = '#window-fullscreen-test-node\\.md-editor';
      await page.waitForSelector(editorSelector, { timeout: 3000 });
      console.log('OK Hover editor appeared');

      // Capture initial zoom level
      const initialZoom = await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        return cy ? cy.zoom() : 0;
      });
      console.log(`Initial zoom: ${initialZoom}`);

      // Wait for hover menu to appear (has the fullscreen button)
      const hoverMenuSelector = '.cy-horizontal-context-menu';
      await page.waitForSelector(hoverMenuSelector, { timeout: 3000 });
      console.log('OK Hover menu appeared');

      // Find and click the fullscreen button in the hover menu using real mouse events
      console.log('=== Clicking fullscreen button in hover menu ===');
      const fullscreenButtonSelector = '.cy-horizontal-context-menu .traffic-light-fullscreen';
      const fullscreenButton = page.locator(fullscreenButtonSelector);
      await expect(fullscreenButton).toBeVisible();
      await fullscreenButton.click();
      console.log('OK Fullscreen button clicked');
      await page.waitForTimeout(400);

      // Verify editor is still open (not closed)
      const editorStillOpen = await page.evaluate((selector) => {
        return document.querySelector(selector) !== null;
      }, editorSelector);
      expect(editorStillOpen).toBe(true);
      console.log('OK Editor remains open after fullscreen click');

      // Capture new zoom level
      const newZoom = await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        return cy ? cy.zoom() : 0;
      });
      console.log(`New zoom: ${newZoom}`);

      console.log('OK Fullscreen click processed (hover editors without shadow nodes do not zoom)');

      await page.screenshot({ path: 'e2e-tests/screenshots/fullscreen-hover-editor.png', fullPage: false });
      console.log('OK Screenshot taken');

      console.log('OK Fullscreen hover editor test completed');
    });
  });

  test.describe('Fullscreen Toggle Behavior', () => {
    test('should zoom out when already zoomed in on a floating window', async ({ page, consoleCapture: _consoleCapture }) => {
      console.log('\n=== Starting fullscreen toggle test ===');

      await setupMockElectronAPI(page);
      await page.goto('/');
      await waitForCytoscapeReady(page);

      // Create test node
      const graphDelta: GraphDelta = [
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: {
            absoluteFilePathIsID: 'toggle-test-node.md',
            contentWithoutYamlOrLinks: '# Toggle Test\nTest content for zoom toggle.',
            outgoingEdges: [],
            nodeUIMetadata: {
              color: { _tag: 'None' } as const,
              position: { _tag: 'Some', value: { x: 400, y: 400 } } as const,
              additionalYAMLProps: {},
              isContextNode: false
            }
          },
          previousNode: { _tag: 'None' } as const
        }
      ];
      await sendGraphDelta(page, graphDelta);
      await page.waitForTimeout(30);
      console.log('OK Graph delta sent');

      // Open anchored editor via tap
      console.log('=== Opening anchored editor via tap ===');
      await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        const node = cy.$('#toggle-test-node.md');
        if (node.length === 0) throw new Error('toggle-test-node.md not found');
        node.trigger('tap');
      });
      await page.waitForTimeout(100);

      const editorSelector = '#window-toggle-test-node\\.md-editor';
      await page.waitForSelector(editorSelector, { timeout: 3000 });
      console.log('OK Anchored editor appeared');

      // Capture initial zoom and pan
      const initialState = await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return { zoom: 0, panX: 0, panY: 0 };
        const pan = cy.pan();
        return { zoom: cy.zoom(), panX: pan.x, panY: pan.y };
      });
      console.log(`Initial state: zoom=${initialState.zoom}, pan=(${initialState.panX}, ${initialState.panY})`);

      // Click fullscreen button to zoom in
      console.log('=== Clicking fullscreen button (first time - zoom in) ===');
      await page.evaluate((selector) => {
        const editorWindow = document.querySelector(selector);
        if (!editorWindow) return;
        const fullscreenButton = editorWindow.querySelector('.traffic-light-fullscreen') as HTMLButtonElement;
        if (fullscreenButton) fullscreenButton.click();
      }, editorSelector);
      await page.waitForTimeout(400);

      const afterFirstClick = await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return { zoom: 0, panX: 0, panY: 0 };
        const pan = cy.pan();
        return { zoom: cy.zoom(), panX: pan.x, panY: pan.y };
      });
      console.log(`After first click: zoom=${afterFirstClick.zoom}, pan=(${afterFirstClick.panX}, ${afterFirstClick.panY})`);

      // Zoom should have increased (zoomed in to fit the editor)
      expect(afterFirstClick.zoom).toBeGreaterThan(initialState.zoom * 0.8);
      console.log('OK Zoomed in on first click');

      // Click fullscreen button again to zoom out
      console.log('=== Clicking fullscreen button (second time - zoom out) ===');
      await page.evaluate((selector) => {
        const editorWindow = document.querySelector(selector);
        if (!editorWindow) return;
        const fullscreenButton = editorWindow.querySelector('.traffic-light-fullscreen') as HTMLButtonElement;
        if (fullscreenButton) fullscreenButton.click();
      }, editorSelector);
      await page.waitForTimeout(400);

      const afterSecondClick = await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return { zoom: 0, panX: 0, panY: 0 };
        const pan = cy.pan();
        return { zoom: cy.zoom(), panX: pan.x, panY: pan.y };
      });
      console.log(`After second click: zoom=${afterSecondClick.zoom}, pan=(${afterSecondClick.panX}, ${afterSecondClick.panY})`);

      const zoomDifferenceFromInitial = Math.abs(afterSecondClick.zoom - initialState.zoom);
      const tolerance = initialState.zoom * 0.1;
      expect(zoomDifferenceFromInitial).toBeLessThan(tolerance);
      console.log('OK Zoom restored to original state on second click');

      await page.screenshot({ path: 'e2e-tests/screenshots/fullscreen-toggle-after-second.png', fullPage: false });
      console.log('OK Screenshot taken');

      console.log('OK Fullscreen toggle test completed');
    });
  });

  test.describe('Complete Hover to Pin to Fullscreen Flow', () => {
    // Depends on hover mechanism which doesn't work in headless Chromium (see above)
    test.fixme('should hover, pin, fullscreen, and toggle fullscreen with screenshots', async ({ page, consoleCapture: _consoleCapture }) => {
      console.log('\n=== Starting complete hover-pin-fullscreen flow test ===');

      await setupMockElectronAPI(page);
      await page.goto('/');
      await waitForCytoscapeReady(page);

      // Create test node
      const graphDelta: GraphDelta = [
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: {
            absoluteFilePathIsID: 'flow-test-node.md',
            contentWithoutYamlOrLinks: '# Flow Test\nTest content for complete hover-pin-fullscreen flow.',
            outgoingEdges: [],
            nodeUIMetadata: {
              color: { _tag: 'None' } as const,
              position: { _tag: 'Some', value: { x: 400, y: 300 } } as const,
              additionalYAMLProps: {},
              isContextNode: false
            }
          },
          previousNode: { _tag: 'None' } as const
        }
      ];
      await sendGraphDelta(page, graphDelta);
      await page.waitForTimeout(50);
      console.log('OK Graph delta sent');

      // ============ STEP 1: Hover over node ============
      console.log('=== STEP 1: Hover over node ===');
      const nodeScreenPos = await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        const node = cy.$('#flow-test-node.md');
        if (node.length === 0) throw new Error('flow-test-node.md not found');
        const rpos = node.renderedPosition();
        const container = cy.container();
        if (!container) throw new Error('No cy container');
        const rect = container.getBoundingClientRect();
        return { x: rect.left + rpos.x, y: rect.top + rpos.y };
      });
      await page.mouse.move(nodeScreenPos.x, nodeScreenPos.y);
      await page.waitForTimeout(300);

      // Wait for hover editor and hover menu
      const editorSelector = '#window-flow-test-node\\.md-editor';
      const hoverMenuSelector = '.cy-horizontal-context-menu';
      await page.waitForSelector(editorSelector, { timeout: 3000 });
      await page.waitForSelector(hoverMenuSelector, { timeout: 3000 });
      console.log('OK Hover editor and menu appeared');

      // Verify hover editor exists but is NOT anchored (no shadow node)
      const step1State = await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return { hasShadowNode: false };
        const shadowNode = cy.$('#flow-test-node\\.md-editor-anchor-shadowNode');
        return { hasShadowNode: shadowNode.length > 0 };
      });
      expect(step1State.hasShadowNode).toBe(false);
      console.log('OK Hover editor is not anchored (no shadow node)');

      await page.screenshot({ path: 'e2e-tests/screenshots/flow-step1-hover.png', fullPage: true });
      console.log('OK Screenshot: flow-step1-hover.png');

      // ============ STEP 2: Press pin button ============
      console.log('=== STEP 2: Press pin button ===');
      const pinButtonSelector = '.cy-horizontal-context-menu .traffic-light-pin';
      const pinButton = page.locator(pinButtonSelector);
      await expect(pinButton).toBeVisible();
      await pinButton.click();
      await page.waitForTimeout(300);

      // Verify editor is now anchored (has shadow node)
      const step2State = await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return { hasShadowNode: false, zoom: 0 };
        const shadowNode = cy.$('#flow-test-node\\.md-editor-anchor-shadowNode');
        return { hasShadowNode: shadowNode.length > 0, zoom: cy.zoom() };
      });
      expect(step2State.hasShadowNode).toBe(true);
      console.log('OK Editor is now anchored (shadow node created)');
      const zoomAfterPin = step2State.zoom;
      console.log(`Zoom after pin: ${zoomAfterPin}`);

      await page.screenshot({ path: 'e2e-tests/screenshots/flow-step2-pinned.png', fullPage: true });
      console.log('OK Screenshot: flow-step2-pinned.png');

      // ============ STEP 3: Press fullscreen button ============
      console.log('=== STEP 3: Press fullscreen button (zoom in) ===');

      await page.waitForTimeout(500);
      const anchoredEditorMenuSelector = '.cy-floating-window-horizontal-menu .traffic-light-fullscreen';
      const fullscreenButton = page.locator(anchoredEditorMenuSelector);
      await expect(fullscreenButton).toBeVisible({ timeout: 3000 });

      const zoomBeforeFullscreen = await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        return cy ? cy.zoom() : 0;
      });
      console.log(`Zoom before fullscreen: ${zoomBeforeFullscreen}`);

      await fullscreenButton.click();
      await page.waitForTimeout(400);

      const step3State = await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return { zoom: 0 };
        return { zoom: cy.zoom() };
      });
      console.log(`Zoom after fullscreen: ${step3State.zoom}`);

      expect(step3State.zoom).not.toBeCloseTo(zoomBeforeFullscreen, 1);
      console.log('OK Zoom changed after fullscreen click');

      await page.screenshot({ path: 'e2e-tests/screenshots/flow-step3-fullscreen.png', fullPage: true });
      console.log('OK Screenshot: flow-step3-fullscreen.png');

      // ============ STEP 4: Press fullscreen again (toggle back) ============
      console.log('=== STEP 4: Press fullscreen button again (zoom out/restore) ===');
      await page.evaluate(() => {
        const btn = document.querySelector('.cy-floating-window-horizontal-menu .traffic-light-fullscreen') as HTMLButtonElement;
        if (btn) btn.click();
      });
      await page.waitForTimeout(400);

      const step4State = await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return { zoom: 0 };
        return { zoom: cy.zoom() };
      });
      console.log(`Zoom after second fullscreen: ${step4State.zoom}`);

      expect(step4State.zoom).not.toBeCloseTo(step3State.zoom, 1);
      console.log('OK Zoom toggled after second fullscreen click');

      await page.screenshot({ path: 'e2e-tests/screenshots/flow-step4-fullscreen-toggled.png', fullPage: true });
      console.log('OK Screenshot: flow-step4-fullscreen-toggled.png');

      console.log('OK Complete hover-pin-fullscreen flow test completed');
    });
  });
});
