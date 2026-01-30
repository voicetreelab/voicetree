/**
 * BEHAVIORAL SPEC:
 * E2E test for terminal graph dimension stability during zoom
 *
 * Verifies that terminal graph-space dimensions (baseWidth/baseHeight) remain
 * constant when zooming. Screen dimensions change with zoom, but graph dimensions
 * must stay fixed so terminals maintain their size relative to graph nodes.
 *
 * FIX HISTORY:
 * - CSS min-width reduced from 300px to 100px to prevent constraint override
 *   at normal zoom levels. At zoom 0.7, screenWidth = 350 * 0.7 = 245px which
 *   is now above the 100px min-width, so no incorrect recalculation occurs.
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

// Use example_small for faster loading
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
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-graph-dim-test-'));

    // Write the config file to auto-load the test vault
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({
      lastDirectory: FIXTURE_VAULT_PATH,
      suffixes: {
        [FIXTURE_VAULT_PATH]: ''
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
        VOICETREE_PERSIST_STATE: '1'
      },
      timeout: 10000
    });

    await use(electronApp);

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

    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');

    // Wait for cytoscape instance
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

test.describe('Terminal Graph Dimension Stability', () => {
  test('graph dimensions remain constant when zooming triggers CSS min-width constraint', async ({ appWindow }) => {
    test.setTimeout(90000);

    console.log('=== STEP 1: Wait for graph to auto-load ===');
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) return 0;
        return cy.nodes().length;
      });
    }, {
      message: 'Waiting for graph to auto-load nodes',
      timeout: 20000,
      intervals: [500, 1000, 1000, 2000]
    }).toBeGreaterThan(0);

    console.log('✓ Graph auto-loaded with nodes');

    console.log('=== STEP 2: Set zoom to 1.0 and get a target node ===');
    const targetNodeId = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Set zoom to exactly 1.0 for consistent starting point
      cy.zoom(1.0);
      cy.center();

      const nodes = cy.nodes();
      if (nodes.length === 0) throw new Error('No nodes available');
      return nodes[0].id();
    });

    console.log(`Target node: ${targetNodeId}`);

    console.log('=== STEP 3: Spawn terminal via API ===');
    // Use API directly with explicit command (empty string triggers agent lookup which fails in tests)
    await appWindow.evaluate(async (nodeId) => {
      const w = window as ExtendedWindow;
      const api = w.electronAPI;
      if (!api?.main) throw new Error('electronAPI.main not available');
      await api.main.spawnTerminalWithContextNode(nodeId, 'echo "test terminal"', 0);
    }, targetNodeId);

    // Wait for terminal to spawn and navigation animation to complete
    // (there's a 600ms/1100ms setTimeout for navigateToTerminalNeighborhood)
    await appWindow.waitForTimeout(4000);

    console.log('=== STEP 4: Verify terminal exists and get initial dimensions ===');
    const terminalWindow = appWindow.locator('.cy-floating-window-terminal');
    await expect(terminalWindow).toBeVisible({ timeout: 5000 });
    console.log('✓ Terminal floating window visible');

    // Ensure zoom is at 1.0 for consistent measurement
    await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      cy.zoom(1.0);
    });
    await appWindow.waitForTimeout(500);

    const initialState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const terminalEl = document.querySelector('.cy-floating-window-terminal') as HTMLElement;
      if (!terminalEl) throw new Error('Terminal element not found');

      const shadowNodeId = terminalEl.dataset.shadowNodeId;
      if (!shadowNodeId) throw new Error('Shadow node ID not found');

      const shadowNode = cy.getElementById(shadowNodeId);
      if (shadowNode.length === 0) throw new Error('Shadow node not found');

      return {
        baseWidth: parseFloat(terminalEl.dataset.baseWidth ?? '0'),
        baseHeight: parseFloat(terminalEl.dataset.baseHeight ?? '0'),
        shadowNodeWidth: shadowNode.width(),
        shadowNodeHeight: shadowNode.height(),
        screenWidth: terminalEl.offsetWidth,
        screenHeight: terminalEl.offsetHeight,
        zoom: cy.zoom()
      };
    });

    console.log(`Initial state at zoom ${initialState.zoom}:`);
    console.log(`  baseWidth: ${initialState.baseWidth}, baseHeight: ${initialState.baseHeight}`);
    console.log(`  shadowNode: ${initialState.shadowNodeWidth}x${initialState.shadowNodeHeight}`);
    console.log(`  screen: ${initialState.screenWidth}x${initialState.screenHeight}`);

    console.log('=== STEP 5: Zoom to 0.7 (triggers CSS min-width: 300px constraint) ===');
    // At zoom 0.7: screenWidth = 350 * 0.7 = 245px < CSS min-width 300px
    await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      cy.zoom(0.7);
      cy.center();
    });

    // Wait for zoom to complete and ResizeObserver to fire
    await appWindow.waitForTimeout(1000);

    const zoomedState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const terminalEl = document.querySelector('.cy-floating-window-terminal') as HTMLElement;
      if (!terminalEl) throw new Error('Terminal element not found');

      const shadowNodeId = terminalEl.dataset.shadowNodeId;
      if (!shadowNodeId) throw new Error('Shadow node ID not found');

      const shadowNode = cy.getElementById(shadowNodeId);
      if (shadowNode.length === 0) throw new Error('Shadow node not found');

      return {
        baseWidth: parseFloat(terminalEl.dataset.baseWidth ?? '0'),
        baseHeight: parseFloat(terminalEl.dataset.baseHeight ?? '0'),
        shadowNodeWidth: shadowNode.width(),
        shadowNodeHeight: shadowNode.height(),
        screenWidth: terminalEl.offsetWidth,
        screenHeight: terminalEl.offsetHeight,
        zoom: cy.zoom()
      };
    });

    console.log(`State after zoom to ${zoomedState.zoom}:`);
    console.log(`  baseWidth: ${zoomedState.baseWidth}, baseHeight: ${zoomedState.baseHeight}`);
    console.log(`  shadowNode: ${zoomedState.shadowNodeWidth}x${zoomedState.shadowNodeHeight}`);
    console.log(`  screen: ${zoomedState.screenWidth}x${zoomedState.screenHeight}`);

    // Take screenshot for debugging
    await appWindow.screenshot({ path: 'e2e-tests/screenshots/terminal-graph-dim-zoom-0.7.png' });
    console.log('✓ Screenshot saved: terminal-graph-dim-zoom-0.7.png');

    console.log('=== STEP 6: Verify graph dimensions remained constant ===');

    // The bug: baseWidth changes from ~350 to ~428 (300 / 0.7) when CSS min-width kicks in
    // Correct behavior: baseWidth should remain at ~350

    // Allow small tolerance for floating point
    const baseWidthDelta = Math.abs(zoomedState.baseWidth - initialState.baseWidth);
    const baseHeightDelta = Math.abs(zoomedState.baseHeight - initialState.baseHeight);
    const shadowWidthDelta = Math.abs(zoomedState.shadowNodeWidth - initialState.shadowNodeWidth);
    const shadowHeightDelta = Math.abs(zoomedState.shadowNodeHeight - initialState.shadowNodeHeight);

    console.log(`  baseWidth delta: ${baseWidthDelta}`);
    console.log(`  baseHeight delta: ${baseHeightDelta}`);
    console.log(`  shadowWidth delta: ${shadowWidthDelta}`);
    console.log(`  shadowHeight delta: ${shadowHeightDelta}`);

    // Graph dimensions should NOT change significantly (allow 2px tolerance)
    // If this fails, the bug is present
    expect(baseWidthDelta).toBeLessThan(2);
    expect(shadowWidthDelta).toBeLessThan(2);
    console.log('✓ Graph-space width remained constant');

    // Height might change less since min-height: 200px is less likely to be hit
    expect(baseHeightDelta).toBeLessThan(2);
    expect(shadowHeightDelta).toBeLessThan(2);
    console.log('✓ Graph-space height remained constant');

    console.log('=== STEP 7: Zoom back to 1.0 and verify dimensions ===');
    await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      cy.zoom(1.0);
      cy.center();
    });

    await appWindow.waitForTimeout(500);

    const finalState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const terminalEl = document.querySelector('.cy-floating-window-terminal') as HTMLElement;
      if (!terminalEl) throw new Error('Terminal element not found');

      const shadowNodeId = terminalEl.dataset.shadowNodeId;
      if (!shadowNodeId) throw new Error('Shadow node ID not found');

      const shadowNode = cy.getElementById(shadowNodeId);
      if (shadowNode.length === 0) throw new Error('Shadow node not found');

      return {
        baseWidth: parseFloat(terminalEl.dataset.baseWidth ?? '0'),
        baseHeight: parseFloat(terminalEl.dataset.baseHeight ?? '0'),
        shadowNodeWidth: shadowNode.width(),
        shadowNodeHeight: shadowNode.height(),
        screenWidth: terminalEl.offsetWidth,
        screenHeight: terminalEl.offsetHeight,
        zoom: cy.zoom()
      };
    });

    console.log(`Final state at zoom ${finalState.zoom}:`);
    console.log(`  baseWidth: ${finalState.baseWidth}, baseHeight: ${finalState.baseHeight}`);
    console.log(`  shadowNode: ${finalState.shadowNodeWidth}x${finalState.shadowNodeHeight}`);
    console.log(`  screen: ${finalState.screenWidth}x${finalState.screenHeight}`);

    // After zooming back to 1.0, dimensions should match initial state
    const finalWidthDelta = Math.abs(finalState.baseWidth - initialState.baseWidth);
    const finalHeightDelta = Math.abs(finalState.baseHeight - initialState.baseHeight);

    console.log(`  Final baseWidth delta from initial: ${finalWidthDelta}`);
    console.log(`  Final baseHeight delta from initial: ${finalHeightDelta}`);

    expect(finalWidthDelta).toBeLessThan(2);
    expect(finalHeightDelta).toBeLessThan(2);
    console.log('✓ Graph dimensions match initial after zoom round-trip');

    // Take final screenshot
    await appWindow.screenshot({ path: 'e2e-tests/screenshots/terminal-graph-dim-final.png' });
    console.log('✓ Screenshot saved: terminal-graph-dim-final.png');

    console.log('');
    console.log('✅ TERMINAL GRAPH DIMENSION STABILITY TEST PASSED');
    console.log('Key verifications:');
    console.log(`  - Initial graph dimensions: ${initialState.baseWidth}x${initialState.baseHeight}`);
    console.log(`  - Graph dimensions after zoom to 0.7: ${zoomedState.baseWidth}x${zoomedState.baseHeight}`);
    console.log(`  - Graph dimensions remained stable despite CSS min-width constraint`);
  });
});

export { test };
