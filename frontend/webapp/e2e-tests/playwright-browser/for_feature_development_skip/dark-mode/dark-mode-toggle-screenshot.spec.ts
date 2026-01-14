/**
 * Screenshot test for dark mode toggle
 * Verifies that dark mode styling is applied correctly and looks good
 */

import { test, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  waitForCytoscapeReady,
  sendGraphDelta,
  createTestGraphDelta,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils';

test.describe('Dark Mode Toggle Screenshot', () => {
  test('should switch from light to dark mode with correct styling', async ({ page }) => {
    await setupMockElectronAPI(page);
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);

    // Send test graph data to have nodes visible
    const testDelta = createTestGraphDelta();
    await sendGraphDelta(page, testDelta);
    await page.waitForTimeout(300); // Wait for graph to render

    // Verify we're in light mode initially (no dark class)
    const isInitiallyLight = await page.evaluate(() => {
      return !document.documentElement.classList.contains('dark');
    });
    expect(isInitiallyLight).toBe(true);

    // Take screenshot of light mode
    await page.screenshot({
      path: 'e2e-tests/screenshots/dark-mode/01-light-mode-initial.png'
    });

    // Find and click the dark mode toggle button
    const darkModeButton = page.locator('.speed-dial-container button[data-item-relativeFilePathIsID="dark-mode"]');
    await expect(darkModeButton).toBeVisible();
    await darkModeButton.click();

    // Wait for transition to complete
    await page.waitForTimeout(200);

    // Verify dark mode is now active
    const isDarkModeActive = await page.evaluate(() => {
      return document.documentElement.classList.contains('dark');
    });
    expect(isDarkModeActive).toBe(true);

    // Take screenshot of dark mode
    await page.screenshot({
      path: 'e2e-tests/screenshots/dark-mode/02-dark-mode-after-toggle.png'
    });

    // Take a screenshot showing nodes are visible with proper contrast
    // Zoom in a bit to see details
    await page.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (cy) {
        cy.zoom(1.5);
        cy.center();
      }
    });
    await page.waitForTimeout(100);

    await page.screenshot({
      path: 'e2e-tests/screenshots/dark-mode/03-dark-mode-zoomed-nodes.png'
    });

    // Verify edge visibility - edges should have opacity > 0.3
    const edgeOpacity = await page.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return 0;
      const edges = cy.edges();
      if (edges.length === 0) return 0;
      // Get first edge's computed style
      const firstEdge = edges[0];
      return firstEdge.style('line-opacity') as number;
    });
    expect(edgeOpacity).toBeGreaterThanOrEqual(0.35); // Should be at least 0.35 (increased from 0.3)

    console.log(`[Test] Dark mode edge opacity: ${edgeOpacity}`);
  });

  test('should display vault selector correctly in dark mode', async ({ page }) => {
    // Add vault paths to mock for selector to appear
    await page.addInitScript(() => {
      const mockElectronAPI = {
        main: {
          applyGraphDeltaToDBAndMem: async () => ({ success: true }),
          applyGraphDeltaToDBThroughMem: async () => ({ success: true }),
          getGraph: async () => ({ nodes: {}, edges: [] }),
          getNode: async () => undefined,
          loadSettings: async () => ({
            terminalSpawnPathRelativeToWatchedDirectory: '../',
            agents: [],
            shiftEnterSendsOptionEnter: true
          }),
          saveSettings: async () => ({ success: true }),
          saveNodePositions: async () => ({ success: true }),
          startFileWatching: async () => ({ success: true, directory: '/mock/watched/directory' }),
          stopFileWatching: async () => ({ success: true }),
          getWatchStatus: async () => ({ isWatching: true, directory: '/mock/watched/directory' }),
          loadPreviousFolder: async () => ({ success: false }),
          getBackendPort: async () => 5001,
          getMetrics: async () => ({ sessions: [] }),
          applyGraphDeltaToDBThroughMemUIAndEditorExposed: async () => ({ success: true }),
          applyGraphDeltaToDBThroughMemAndUIExposed: async () => ({ success: true }),
          // Vault path related APIs
          getVaultPaths: async () => ['/mock/watched/directory', '/mock/watched/directory/notes'],
          getDefaultWritePath: async () => ({ _tag: 'Some', value: '/mock/watched/directory' }),
          setDefaultWritePath: async () => ({ success: true }),
          addVaultPathToAllowlist: async () => ({ success: true }),
          removeVaultPathFromAllowlist: async () => ({ success: true }),
        },
        onWatchingStarted: () => {},
        onFileWatchingStopped: () => {},
        removeAllListeners: () => {},
        terminal: {
          spawn: async () => ({ success: false }),
          write: async () => {},
          resize: async () => {},
          kill: async () => {},
          onData: () => {},
          onExit: () => {}
        },
        positions: {
          save: async () => ({ success: true }),
          load: async () => ({ success: false, positions: {} })
        },
        onBackendLog: () => {},
        graph: {
          _graphState: { nodes: {}, edges: [] },
          applyGraphDelta: async () => ({ success: true }),
          getState: async () => ({ nodes: {}, edges: [] }),
          onGraphUpdate: () => () => {},
          onGraphClear: () => () => {},
          _updateCallback: undefined
        },
        invoke: async () => {},
        _ipcListeners: {},
        on: () => () => {},
        off: () => {},
        _triggerIpc: () => {}
      };
      // @ts-expect-error - mock electron API
      window.electronAPI = mockElectronAPI;
    });

    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);

    // Click dark mode toggle
    const darkModeButton = page.locator('.speed-dial-container button[data-item-relativeFilePathIsID="dark-mode"]');
    await darkModeButton.click();
    await page.waitForTimeout(200);

    // Take screenshot showing the bottom bar with vault selector in dark mode
    await page.screenshot({
      path: 'e2e-tests/screenshots/dark-mode/04-dark-mode-vault-selector.png'
    });
  });
});
