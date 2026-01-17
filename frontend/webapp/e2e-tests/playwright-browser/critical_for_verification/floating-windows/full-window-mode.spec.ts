/**
 * Browser-based test for full-window mode (CSS-based fullscreen)
 * Tests that floating windows expand to fill the viewport when fullscreen button is clicked,
 * escaping CSS transform containment by reparenting to document.body
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

test.describe('Full Window Mode (Browser)', () => {
  // Editor fullscreen is currently disabled due to Vim mode Escape key conflicts
  // See: FloatingEditorCRUD.ts lines 163-177
  // Terminal fullscreen is still enabled and should be tested separately
  test.skip('should expand editor to fill window on fullscreen button click', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting full-window mode test ===');

    console.log('=== Step 1: Setup mock Electron API ===');
    await setupMockElectronAPI(page);
    console.log('OK Electron API mock prepared');

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    console.log('OK React rendered');

    await page.waitForTimeout(50);

    console.log('=== Step 3: Wait for Cytoscape ===');
    await waitForCytoscapeReady(page);
    console.log('OK Cytoscape initialized');

    console.log('=== Step 4: Send graph delta with test node ===');
    const testContent = '# Full Window Test\nTesting full window mode expansion.';
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'fullwindow-test-node.md',
          contentWithoutYamlOrLinks: testContent,
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

    console.log('=== Step 5: Open editor via tap event ===');
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#fullwindow-test-node.md');
      if (node.length === 0) throw new Error('fullwindow-test-node.md not found');
      node.trigger('tap');
    });
    await page.waitForTimeout(50);
    console.log('OK Tap event triggered');

    console.log('=== Step 6: Verify editor window appeared ===');
    const editorSelector = '#window-fullwindow-test-node\\.md-editor';
    await page.waitForSelector(editorSelector, { timeout: 3000 });
    console.log('OK Editor window appeared');

    console.log('=== Step 7: Capture initial editor dimensions ===');
    const initialDims = await page.evaluate((selector) => {
      const windowEl = document.querySelector(selector) as HTMLElement;
      if (!windowEl) throw new Error('Editor window not found');
      const rect = windowEl.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        top: rect.top,
        left: rect.left,
        parent: windowEl.parentElement?.className ?? 'unknown'
      };
    }, editorSelector);
    console.log(`  Initial dims: ${initialDims.width}x${initialDims.height} at (${initialDims.left}, ${initialDims.top})`);
    console.log(`  Initial parent: ${initialDims.parent}`);

    // Verify editor is initially inside the overlay (has transform)
    expect(initialDims.parent).toContain('cy-floating-overlay');

    console.log('=== Step 8: Click fullscreen button ===');
    await page.evaluate((selector) => {
      const fullscreenBtn = document.querySelector(`${selector} .cy-floating-window-fullscreen`) as HTMLButtonElement;
      if (!fullscreenBtn) throw new Error('Fullscreen button not found');
      fullscreenBtn.click();
    }, editorSelector);
    await page.waitForTimeout(50);
    console.log('OK Fullscreen button clicked');

    console.log('=== Step 9: Take screenshot of fullscreen state ===');
    await page.screenshot({ path: 'e2e-tests/screenshots/full-window-mode-expanded.png' });
    console.log('OK Screenshot saved to e2e-tests/screenshots/full-window-mode-expanded.png');

    console.log('=== Step 10: Verify editor expanded to fill viewport ===');
    const viewportSize = await page.viewportSize();
    if (!viewportSize) throw new Error('Could not get viewport size');
    console.log(`  Viewport size: ${viewportSize.width}x${viewportSize.height}`);

    const expandedDims = await page.evaluate((selector) => {
      const windowEl = document.querySelector(selector) as HTMLElement;
      if (!windowEl) throw new Error('Editor window not found after fullscreen');
      const rect = windowEl.getBoundingClientRect();
      const computedStyle = window.getComputedStyle(windowEl);
      return {
        width: rect.width,
        height: rect.height,
        top: rect.top,
        left: rect.left,
        position: computedStyle.position,
        parent: windowEl.parentElement?.tagName ?? 'unknown'
      };
    }, editorSelector);
    console.log(`  Expanded dims: ${expandedDims.width}x${expandedDims.height} at (${expandedDims.left}, ${expandedDims.top})`);
    console.log(`  Position: ${expandedDims.position}`);
    console.log(`  Parent: ${expandedDims.parent}`);

    // Verify editor is now a child of document.body (escaped transform containment)
    expect(expandedDims.parent).toBe('BODY');

    // Verify position: fixed is applied
    expect(expandedDims.position).toBe('fixed');

    // Verify editor fills the viewport (with some tolerance for borders/padding)
    expect(expandedDims.width).toBeGreaterThanOrEqual(viewportSize.width - 10);
    expect(expandedDims.height).toBeGreaterThanOrEqual(viewportSize.height - 10);

    // Verify editor is positioned at top-left of viewport
    expect(expandedDims.top).toBeLessThanOrEqual(5);
    expect(expandedDims.left).toBeLessThanOrEqual(5);
    console.log('OK Editor fills viewport correctly');

    console.log('=== Step 10: Click fullscreen button again to exit ===');
    await page.evaluate((selector) => {
      const fullscreenBtn = document.querySelector(`${selector} .cy-floating-window-fullscreen`) as HTMLButtonElement;
      if (!fullscreenBtn) throw new Error('Fullscreen button not found');
      fullscreenBtn.click();
    }, editorSelector);
    await page.waitForTimeout(50);
    console.log('OK Fullscreen button clicked to exit');

    console.log('=== Step 11: Verify editor returned to original state ===');
    const restoredDims = await page.evaluate((selector) => {
      const windowEl = document.querySelector(selector) as HTMLElement;
      if (!windowEl) throw new Error('Editor window not found after exit');
      const rect = windowEl.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        parent: windowEl.parentElement?.className ?? 'unknown'
      };
    }, editorSelector);
    console.log(`  Restored dims: ${restoredDims.width}x${restoredDims.height}`);
    console.log(`  Restored parent: ${restoredDims.parent}`);

    // Verify editor is back in the overlay
    expect(restoredDims.parent).toContain('cy-floating-overlay');

    // Verify editor is no longer viewport-sized
    expect(restoredDims.width).toBeLessThan(viewportSize.width);
    expect(restoredDims.height).toBeLessThan(viewportSize.height);
    console.log('OK Editor restored to original state');

    console.log('=== Step 12: Take screenshot of restored state ===');
    await page.screenshot({ path: 'e2e-tests/screenshots/full-window-mode-restored.png' });
    console.log('OK Screenshot saved to e2e-tests/screenshots/full-window-mode-restored.png');

    console.log('OK Full-window mode test completed successfully');
  });

  // Editor fullscreen is currently disabled due to Vim mode Escape key conflicts
  test.skip('should exit fullscreen on Escape key press', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting Escape key exit test ===');

    console.log('=== Step 1: Setup mock Electron API ===');
    await setupMockElectronAPI(page);

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });

    await page.waitForTimeout(50);

    console.log('=== Step 3: Wait for Cytoscape ===');
    await waitForCytoscapeReady(page);

    console.log('=== Step 4: Send graph delta with test node ===');
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'escape-test-node.md',
          contentWithoutYamlOrLinks: '# Escape Test\nTesting Escape key exits fullscreen.',
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

    console.log('=== Step 5: Open editor via tap event ===');
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#escape-test-node.md');
      if (node.length === 0) throw new Error('escape-test-node.md not found');
      node.trigger('tap');
    });
    await page.waitForTimeout(50);

    const editorSelector = '#window-escape-test-node\\.md-editor';
    await page.waitForSelector(editorSelector, { timeout: 3000 });
    console.log('OK Editor window appeared');

    console.log('=== Step 6: Click fullscreen button ===');
    await page.evaluate((selector) => {
      const fullscreenBtn = document.querySelector(`${selector} .cy-floating-window-fullscreen`) as HTMLButtonElement;
      if (!fullscreenBtn) throw new Error('Fullscreen button not found');
      fullscreenBtn.click();
    }, editorSelector);
    await page.waitForTimeout(50);

    // Verify we're in fullscreen
    const isFullscreen = await page.evaluate((selector) => {
      const windowEl = document.querySelector(selector) as HTMLElement;
      return windowEl?.parentElement?.tagName === 'BODY';
    }, editorSelector);
    expect(isFullscreen).toBe(true);
    console.log('OK In fullscreen mode');

    console.log('=== Step 7: Press Escape key ===');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);

    console.log('=== Step 8: Verify exited fullscreen ===');
    const exitedFullscreen = await page.evaluate((selector) => {
      const windowEl = document.querySelector(selector) as HTMLElement;
      return {
        parent: windowEl?.parentElement?.className ?? 'unknown',
        position: window.getComputedStyle(windowEl).position
      };
    }, editorSelector);
    console.log(`  Parent: ${exitedFullscreen.parent}`);
    console.log(`  Position: ${exitedFullscreen.position}`);

    // Verify editor is back in the overlay
    expect(exitedFullscreen.parent).toContain('cy-floating-overlay');
    console.log('OK Escape key exited fullscreen successfully');
  });

  // Editor fullscreen is currently disabled due to Vim mode Escape key conflicts
  test.skip('should close window when close button clicked in fullscreen mode', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting close button in fullscreen test ===');

    await setupMockElectronAPI(page);
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);

    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'close-test-node.md',
          contentWithoutYamlOrLinks: '# Close Test\nTesting close button in fullscreen.',
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

    // Open editor
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#close-test-node.md');
      if (node.length === 0) throw new Error('close-test-node.md not found');
      node.trigger('tap');
    });
    await page.waitForTimeout(50);

    const editorSelector = '#window-close-test-node\\.md-editor';
    await page.waitForSelector(editorSelector, { timeout: 3000 });
    console.log('OK Editor window appeared');

    // Enter fullscreen
    await page.evaluate((selector) => {
      const fullscreenBtn = document.querySelector(`${selector} .cy-floating-window-fullscreen`) as HTMLButtonElement;
      if (!fullscreenBtn) throw new Error('Fullscreen button not found');
      fullscreenBtn.click();
    }, editorSelector);
    await page.waitForTimeout(50);

    // Verify in fullscreen
    const isFullscreen = await page.evaluate((selector) => {
      const windowEl = document.querySelector(selector) as HTMLElement;
      return windowEl?.parentElement?.tagName === 'BODY';
    }, editorSelector);
    expect(isFullscreen).toBe(true);
    console.log('OK In fullscreen mode');

    // Click close button
    console.log('=== Clicking close button ===');
    await page.evaluate((selector) => {
      const closeBtn = document.querySelector(`${selector} .cy-floating-window-close`) as HTMLButtonElement;
      if (!closeBtn) throw new Error('Close button not found');
      closeBtn.click();
    }, editorSelector);
    await page.waitForTimeout(100);

    // Verify window is gone
    const windowExists = await page.evaluate((selector) => {
      return document.querySelector(selector) !== null;
    }, editorSelector);
    expect(windowExists).toBe(false);
    console.log('OK Window closed successfully from fullscreen mode');
  });
});
