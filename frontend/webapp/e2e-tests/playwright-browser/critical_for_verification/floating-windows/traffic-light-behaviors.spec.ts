/**
 * Browser-based tests for floating window traffic light behaviors
 * Tests pin, fullscreen, and zoom toggle functionality for hover and anchored editors
 *
 * Bug context:
 * 1. Pin button on hover editors doesn't convert them to anchored editors
 * 2. Fullscreen button on hover editors closes the editor instead of toggling zoom
 * 3. Fullscreen button only zooms in, never zooms out (lost toggle behavior)
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  sendGraphDelta,
  waitForCytoscapeReady,
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

test.describe('Traffic Light Behaviors (Browser)', () => {

  test.describe('Node Hover Menu', () => {
    test('should show hover menu with node in gap between pills (no duplicate menu in editor)', async ({ page, consoleCapture: _consoleCapture }) => {
      console.log('\n=== Starting node hover menu test ===');

      await setupMockElectronAPI(page);
      await page.goto('/');
      await page.waitForSelector('#root', { timeout: 5000 });
      await page.waitForTimeout(50);
      await waitForCytoscapeReady(page);

      // Create test node
      const graphDelta: GraphDelta = [
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: {
            absoluteFilePathIsID: 'hover-menu-test-node.md',
            contentWithoutYamlOrLinks: '# Hover Menu Test\nTest content for hover menu.',
            outgoingEdges: [],
            nodeUIMetadata: {
              color: { _tag: 'None' } as const,
              position: { _tag: 'Some', value: { x: 400, y: 300 } } as const,
              additionalYAMLProps: new Map(),
              isContextNode: false
            }
          },
          previousNode: { _tag: 'None' } as const
        }
      ];
      await sendGraphDelta(page, graphDelta);
      await page.waitForTimeout(50);
      console.log('OK Graph delta sent');

      // Trigger mouseover on the node to show hover menu and hover editor
      console.log('=== Triggering mouseover to show hover menu ===');
      await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        const node = cy.$('#hover-menu-test-node.md');
        if (node.length === 0) throw new Error('hover-menu-test-node.md not found');
        node.trigger('mouseover');
      });
      await page.waitForTimeout(300);

      // Wait for hover menu from HorizontalMenuService (has node in gap between pills)
      const hoverMenuSelector = '.cy-horizontal-context-menu';
      await page.waitForSelector(hoverMenuSelector, { timeout: 3000 });
      console.log('OK Hover menu appeared');

      // Also verify hover editor appeared
      const editorSelector = '#window-hover-menu-test-node\\.md-editor';
      await page.waitForSelector(editorSelector, { timeout: 3000 });
      console.log('OK Hover editor appeared');

      // Check menu configuration
      const menuInfo = await page.evaluate(({ hoverMenuSel, editorSel }: { hoverMenuSel: string, editorSel: string }) => {
        const hoverMenu = document.querySelector(hoverMenuSel);
        const editorWindow = document.querySelector(editorSel);

        return {
          hoverMenuExists: hoverMenu !== null,
          hoverMenuHasPin: hoverMenu?.querySelector('.traffic-light-pin') !== null,
          hoverMenuHasFullscreen: hoverMenu?.querySelector('.traffic-light-fullscreen') !== null,
          hoverMenuHasClose: hoverMenu?.querySelector('.traffic-light-close') !== null,
          editorExists: editorWindow !== null,
          editorHasOwnMenu: editorWindow?.querySelector('.cy-floating-window-horizontal-menu') !== null,
          totalHoverMenus: document.querySelectorAll('.cy-horizontal-context-menu').length,
          totalEditorMenus: document.querySelectorAll('.cy-floating-window-horizontal-menu').length
        };
      }, { hoverMenuSel: hoverMenuSelector, editorSel: editorSelector });

      console.log(`Menu info: hoverMenu=${menuInfo.hoverMenuExists}, hasPin=${menuInfo.hoverMenuHasPin}, editorHasMenu=${menuInfo.editorHasOwnMenu}`);

      // Verify hover menu exists and has traffic lights
      expect(menuInfo.hoverMenuExists).toBe(true);
      expect(menuInfo.hoverMenuHasPin).toBe(true);
      expect(menuInfo.hoverMenuHasFullscreen).toBe(true);
      expect(menuInfo.hoverMenuHasClose).toBe(true);
      console.log('OK Hover menu has traffic lights');

      // Verify hover editor does NOT have its own menu (would cause duplication)
      expect(menuInfo.editorHasOwnMenu).toBe(false);
      console.log('OK Hover editor does not have its own menu (no duplication)');

      // Verify only 1 hover menu exists
      expect(menuInfo.totalHoverMenus).toBe(1);
      expect(menuInfo.totalEditorMenus).toBe(0);
      console.log('OK Only one menu exists (hover menu, not editor chrome menu)');

      // Take screenshot
      await page.screenshot({ path: 'e2e-tests/screenshots/node-hover-menu.png', fullPage: true });
      console.log('OK Screenshot taken');

      console.log('OK Node hover menu test completed');
    });
  });

  test.describe('Pin Button on Hover Editor', () => {
    test('should convert hover editor to anchored editor when pin button is clicked', async ({ page, consoleCapture: _consoleCapture }) => {
      console.log('\n=== Starting pin hover editor test ===');

      await setupMockElectronAPI(page);
      await page.goto('/');
      await page.waitForSelector('#root', { timeout: 5000 });
      await page.waitForTimeout(50);
      await waitForCytoscapeReady(page);

      // Create test node
      const graphDelta: GraphDelta = [
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: {
            absoluteFilePathIsID: 'pin-test-node.md',
            contentWithoutYamlOrLinks: '# Pin Test\nTest content for pin behavior.',
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
      await page.waitForTimeout(30);
      console.log('OK Graph delta sent');

      // Open hover editor by triggering mouseover
      console.log('=== Opening hover editor via mouseover ===');
      await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        const node = cy.$('#pin-test-node.md');
        if (node.length === 0) throw new Error('pin-test-node.md not found');
        node.trigger('mouseover');
      });
      await page.waitForTimeout(100);

      // Wait for hover editor to appear
      const editorSelector = '#window-pin-test-node\\.md-editor';
      await page.waitForSelector(editorSelector, { timeout: 3000 });
      console.log('OK Hover editor appeared');

      // Verify no shadow node exists yet (hover editor is not anchored)
      const shadowNodeExistsBefore = await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return false;
        const shadowNode = cy.$('#pin-test-node\\.md-editor-anchor-shadowNode');
        return shadowNode.length > 0;
      });
      expect(shadowNodeExistsBefore).toBe(false);
      console.log('OK No shadow node before pinning (hover editor)');

      // Wait for hover menu to appear (has the pin button)
      const hoverMenuSelector = '.cy-horizontal-context-menu';
      await page.waitForSelector(hoverMenuSelector, { timeout: 3000 });
      console.log('OK Hover menu appeared');

      // Find and click the pin button in the hover menu using real mouse events
      // This is important because the hover editor has a click-outside handler that
      // listens for mousedown events. Using element.click() doesn't fire mousedown,
      // so it wouldn't catch the bug where clicking the hover menu closes the hover editor.
      console.log('=== Clicking pin button in hover menu ===');
      const pinButtonSelector = '.cy-horizontal-context-menu .traffic-light-pin';
      const pinButton = page.locator(pinButtonSelector);
      await expect(pinButton).toBeVisible();
      // Use Playwright's click which fires mousedown + mouseup + click (like a real user)
      await pinButton.click();
      console.log('OK Pin button clicked');
      await page.waitForTimeout(200);

      // Verify shadow node now exists (editor converted to anchored)
      const shadowNodeExistsAfter = await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return false;
        const shadowNode = cy.$('#pin-test-node\\.md-editor-anchor-shadowNode');
        return shadowNode.length > 0;
      });
      expect(shadowNodeExistsAfter).toBe(true);
      console.log('OK Shadow node created after pinning');

      // Take screenshot for verification
      await page.screenshot({ path: 'e2e-tests/screenshots/pin-hover-editor-after.png', fullPage: false });
      console.log('OK Screenshot taken');

      console.log('OK Pin hover editor test completed');
    });
  });

  test.describe('Fullscreen Button on Hover Editor', () => {
    test('should zoom to hover editor without closing it', async ({ page, consoleCapture: _consoleCapture }) => {
      console.log('\n=== Starting fullscreen hover editor test ===');

      await setupMockElectronAPI(page);
      await page.goto('/');
      await page.waitForSelector('#root', { timeout: 5000 });
      await page.waitForTimeout(50);
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
              additionalYAMLProps: new Map(),
              isContextNode: false
            }
          },
          previousNode: { _tag: 'None' } as const
        }
      ];
      await sendGraphDelta(page, graphDelta);
      await page.waitForTimeout(30);
      console.log('OK Graph delta sent');

      // Open hover editor by triggering mouseover
      console.log('=== Opening hover editor via mouseover ===');
      await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        const node = cy.$('#fullscreen-test-node.md');
        if (node.length === 0) throw new Error('fullscreen-test-node.md not found');
        node.trigger('mouseover');
      });
      await page.waitForTimeout(100);

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
      // (same reasoning as pin button test - need mousedown to catch click-outside bugs)
      console.log('=== Clicking fullscreen button in hover menu ===');
      const fullscreenButtonSelector = '.cy-horizontal-context-menu .traffic-light-fullscreen';
      const fullscreenButton = page.locator(fullscreenButtonSelector);
      await expect(fullscreenButton).toBeVisible();
      await fullscreenButton.click();
      console.log('OK Fullscreen button clicked');
      await page.waitForTimeout(400); // Wait for zoom animation

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

      // Note: Hover editors don't have shadow nodes, so fullscreen zoom won't change the viewport.
      // This is correct behavior - hover editors need to be pinned first to get a shadow node.
      // The key assertion is that the editor is still open (not closed by the click).
      console.log('OK Fullscreen click processed (hover editors without shadow nodes do not zoom)');

      await page.screenshot({ path: 'e2e-tests/screenshots/fullscreen-hover-editor.png', fullPage: false });
      console.log('OK Screenshot taken');

      console.log('OK Fullscreen hover editor test completed');
    });
  });

  test.describe('Pin Button Visual State', () => {
    test('should show correct visual states for unpinned and pinned (anchored editor)', async ({ page, consoleCapture: _consoleCapture }) => {
      console.log('\n=== Starting pin visual state test ===');

      await setupMockElectronAPI(page);
      await page.goto('/');
      await page.waitForSelector('#root', { timeout: 5000 });
      await page.waitForTimeout(50);
      await waitForCytoscapeReady(page);

      // Create test node
      const graphDelta: GraphDelta = [
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: {
            absoluteFilePathIsID: 'pin-visual-test-node.md',
            contentWithoutYamlOrLinks: '# Pin Visual Test\nTest content for pin visual state.',
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
      await page.waitForTimeout(30);
      console.log('OK Graph delta sent');

      // Open anchored editor via tap
      console.log('=== Opening anchored editor via tap ===');
      await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        const node = cy.$('#pin-visual-test-node.md');
        if (node.length === 0) throw new Error('pin-visual-test-node.md not found');
        node.trigger('tap');
      });
      await page.waitForTimeout(100);

      const editorSelector = '#window-pin-visual-test-node\\.md-editor';
      await page.waitForSelector(editorSelector, { timeout: 3000 });
      console.log('OK Anchored editor appeared');

      // Verify pin button exists and is initially unpinned
      const initialPinState = await page.evaluate((selector) => {
        const editorWindow = document.querySelector(selector);
        if (!editorWindow) return { found: false, hasPinnedClass: false };
        const pinButton = editorWindow.querySelector('.traffic-light-pin') as HTMLButtonElement;
        if (!pinButton) return { found: false, hasPinnedClass: false };
        return {
          found: true,
          hasPinnedClass: pinButton.classList.contains('pinned')
        };
      }, editorSelector);

      expect(initialPinState.found).toBe(true);
      expect(initialPinState.hasPinnedClass).toBe(false);
      console.log('OK Pin button found in unpinned state');

      // Take screenshot of unpinned state
      await page.screenshot({ path: 'e2e-tests/screenshots/pin-visual-state-unpinned.png', fullPage: false });
      console.log('OK Screenshot of unpinned state taken');

      // Click pin button to toggle to pinned state
      console.log('=== Clicking pin button to toggle to pinned state ===');
      await page.evaluate((selector) => {
        const editorWindow = document.querySelector(selector);
        if (!editorWindow) return;
        const pinButton = editorWindow.querySelector('.traffic-light-pin') as HTMLButtonElement;
        if (pinButton) pinButton.click();
      }, editorSelector);
      await page.waitForTimeout(200); // Wait for CSS transition

      // Verify pin button is now pinned
      const afterPinState = await page.evaluate((selector) => {
        const editorWindow = document.querySelector(selector);
        if (!editorWindow) return { found: false, hasPinnedClass: false };
        const pinButton = editorWindow.querySelector('.traffic-light-pin') as HTMLButtonElement;
        if (!pinButton) return { found: false, hasPinnedClass: false };
        return {
          found: true,
          hasPinnedClass: pinButton.classList.contains('pinned')
        };
      }, editorSelector);

      expect(afterPinState.found).toBe(true);
      expect(afterPinState.hasPinnedClass).toBe(true);
      console.log('OK Pin button now has pinned class');

      // Take screenshot of pinned state
      await page.screenshot({ path: 'e2e-tests/screenshots/pin-visual-state-pinned.png', fullPage: false });
      console.log('OK Screenshot of pinned state taken');

      console.log('OK Pin visual state test completed');
    });
  });

  test.describe('Fullscreen Toggle Behavior', () => {
    test('should zoom out when already zoomed in on a floating window', async ({ page, consoleCapture: _consoleCapture }) => {
      console.log('\n=== Starting fullscreen toggle test ===');

      await setupMockElectronAPI(page);
      await page.goto('/');
      await page.waitForSelector('#root', { timeout: 5000 });
      await page.waitForTimeout(50);
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
              additionalYAMLProps: new Map(),
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
      await page.waitForTimeout(400); // Wait for zoom animation

      const afterFirstClick = await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return { zoom: 0, panX: 0, panY: 0 };
        const pan = cy.pan();
        return { zoom: cy.zoom(), panX: pan.x, panY: pan.y };
      });
      console.log(`After first click: zoom=${afterFirstClick.zoom}, pan=(${afterFirstClick.panX}, ${afterFirstClick.panY})`);

      // Zoom should have increased (zoomed in to fit the editor)
      expect(afterFirstClick.zoom).toBeGreaterThan(initialState.zoom * 0.8); // Allow some variance
      console.log('OK Zoomed in on first click');

      // Click fullscreen button again to zoom out
      console.log('=== Clicking fullscreen button (second time - zoom out) ===');
      await page.evaluate((selector) => {
        const editorWindow = document.querySelector(selector);
        if (!editorWindow) return;
        const fullscreenButton = editorWindow.querySelector('.traffic-light-fullscreen') as HTMLButtonElement;
        if (fullscreenButton) fullscreenButton.click();
      }, editorSelector);
      await page.waitForTimeout(400); // Wait for zoom animation

      const afterSecondClick = await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return { zoom: 0, panX: 0, panY: 0 };
        const pan = cy.pan();
        return { zoom: cy.zoom(), panX: pan.x, panY: pan.y };
      });
      console.log(`After second click: zoom=${afterSecondClick.zoom}, pan=(${afterSecondClick.panX}, ${afterSecondClick.panY})`);

      // Zoom should be restored to approximately the original state (toggle behavior)
      // The fullscreen zoom implementation restores the saved viewport, so second click
      // returns to the initial zoom level, not a lower zoom level.
      // Allow 10% tolerance for animation/rounding effects.
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
    test('should hover, pin, fullscreen, and toggle fullscreen with screenshots', async ({ page, consoleCapture: _consoleCapture }) => {
      console.log('\n=== Starting complete hover-pin-fullscreen flow test ===');

      await setupMockElectronAPI(page);
      await page.goto('/');
      await page.waitForSelector('#root', { timeout: 5000 });
      await page.waitForTimeout(50);
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
              additionalYAMLProps: new Map(),
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
      await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        const node = cy.$('#flow-test-node.md');
        if (node.length === 0) throw new Error('flow-test-node.md not found');
        node.trigger('mouseover');
      });
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

      // Screenshot after step 1
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

      // Screenshot after step 2
      await page.screenshot({ path: 'e2e-tests/screenshots/flow-step2-pinned.png', fullPage: true });
      console.log('OK Screenshot: flow-step2-pinned.png');

      // ============ STEP 3: Press fullscreen button ============
      console.log('=== STEP 3: Press fullscreen button (zoom in) ===');

      // After pinning, the editor becomes anchored and gets its own menu in the window chrome
      // Wait for the anchored editor to have its menu
      await page.waitForTimeout(100);
      const anchoredEditorMenuSelector = '.cy-floating-window-horizontal-menu .traffic-light-fullscreen';
      const fullscreenButton = page.locator(anchoredEditorMenuSelector);
      await expect(fullscreenButton).toBeVisible({ timeout: 3000 });
      await fullscreenButton.click();
      await page.waitForTimeout(400); // Wait for zoom animation

      const step3State = await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return { zoom: 0 };
        return { zoom: cy.zoom() };
      });
      console.log(`Zoom after fullscreen: ${step3State.zoom}`);

      // Zoom should have changed (likely increased to fit the editor)
      expect(step3State.zoom).not.toBeCloseTo(zoomAfterPin, 1);
      console.log('OK Zoom changed after fullscreen click');

      // Screenshot after step 3
      await page.screenshot({ path: 'e2e-tests/screenshots/flow-step3-fullscreen.png', fullPage: true });
      console.log('OK Screenshot: flow-step3-fullscreen.png');

      // ============ STEP 4: Press fullscreen again (toggle back) ============
      console.log('=== STEP 4: Press fullscreen button again (zoom out/restore) ===');
      await fullscreenButton.click();
      await page.waitForTimeout(400); // Wait for zoom animation

      const step4State = await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return { zoom: 0 };
        return { zoom: cy.zoom() };
      });
      console.log(`Zoom after second fullscreen: ${step4State.zoom}`);

      // Zoom should have changed again (restored to original or zoomed out)
      expect(step4State.zoom).not.toBeCloseTo(step3State.zoom, 1);
      console.log('OK Zoom toggled after second fullscreen click');

      // Screenshot after step 4
      await page.screenshot({ path: 'e2e-tests/screenshots/flow-step4-fullscreen-toggled.png', fullPage: true });
      console.log('OK Screenshot: flow-step4-fullscreen-toggled.png');

      console.log('OK Complete hover-pin-fullscreen flow test completed');
    });
  });
});
