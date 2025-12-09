/**
 * BEHAVIORAL SPEC:
 * E2E test for terminal cycling viewport fitting
 *
 * This test verifies:
 * 1. Load large example graph
 * 2. Create a terminal on a node
 * 3. Cycle to terminal with Cmd+]
 * 4. Take screenshot to verify viewport fit includes terminal + context node + d=1 neighborhood
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

// Use large example graph
const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_real_large', '2025-09-30');

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
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-fit-viewport-test-'));

    // Write the config file to auto-load the test vault
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({
      lastDirectory: FIXTURE_VAULT_PATH,
      suffixes: {
        [FIXTURE_VAULT_PATH]: '' // Empty suffix means use directory directly
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
        HEADLESS_TEST: '1'
        // Note: No MINIMIZE_TEST so we can see the screenshot
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

    // Wait for cytoscape instance with retry logic
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

test.describe('Terminal Fit Viewport E2E', () => {
  test('should fit viewport to terminal + context + neighborhood on cycle', async ({ appWindow }) => {
    test.setTimeout(90000); // Increase timeout for large graph loading

    console.log('=== STEP 1: Wait for auto-load to complete (large example graph) ===');
    // The app auto-loads from config file on startup, wait for nodes to appear
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

    console.log('=== STEP 2: Get a node with neighbors to create terminal from ===');
    const targetNodeId = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Find a node with at least 2 neighbors for better visualization
      const nodesWithNeighbors = cy.nodes().filter(n => n.neighborhood().nodes().length >= 2);
      if (nodesWithNeighbors.length === 0) {
        // Fallback to any node
        return cy.nodes()[0].id();
      }
      return nodesWithNeighbors[0].id();
    });

    console.log(`Target node: ${targetNodeId}`);

    console.log('=== STEP 3: Select the target node ===');
    const nodeSelected = await appWindow.evaluate((nodeId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById(nodeId);
      if (node.length === 0) throw new Error('Node not found');
      cy.nodes().unselect();
      node.select();
      return node.selected();
    }, targetNodeId);

    expect(nodeSelected).toBe(true);
    console.log(`✓ Node ${targetNodeId} selected`);

    console.log('=== STEP 4: Spawn terminal via Cmd+Enter ===');
    // Cmd+Enter triggers spawnTerminalWithNewContextNode on the selected node
    await appWindow.keyboard.press('Meta+Enter');

    // Wait for context node creation + terminal spawn (there's a 1000ms setTimeout in implementation)
    await appWindow.waitForTimeout(3000);

    console.log('=== STEP 5: Verify terminal floating window exists ===');
    // Check for floating window in DOM
    const floatingWindowCount = await appWindow.evaluate(() => {
      return document.querySelectorAll('.cy-floating-window-title-text').length;
    });
    console.log(`Floating windows found: ${floatingWindowCount}`);
    expect(floatingWindowCount).toBeGreaterThan(0);

    console.log('=== STEP 6: Pan away, then trigger terminal cycling via keyboard ===');
    // First pan the view away from the terminal
    await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      // Pan to a far corner
      cy.pan({ x: -5000, y: -5000 });
    });

    await appWindow.waitForTimeout(300);

    // Now trigger terminal cycling with Cmd+] keyboard shortcut
    await appWindow.keyboard.press('Meta+]');

    console.log('✓ Terminal cycling triggered via Cmd+]');

    // Wait for viewport animation
    await appWindow.waitForTimeout(500);

    console.log('=== STEP 7: Take screenshot of fit result ===');
    await appWindow.screenshot({
      path: 'e2e-tests/test-results/terminal-fit-viewport.png'
    });

    console.log('✓ Screenshot saved to e2e-tests/test-results/terminal-fit-viewport.png');

    console.log('=== STEP 8: Log viewport info for visual verification ===');
    const viewportInfo = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const extent = cy.extent();
      const zoom = cy.zoom();

      return {
        totalNodes: cy.nodes().length,
        viewportWidth: extent.x2 - extent.x1,
        viewportHeight: extent.y2 - extent.y1,
        zoom: zoom
      };
    });

    console.log(`Total nodes: ${viewportInfo.totalNodes}`);
    console.log(`Viewport size: ${viewportInfo.viewportWidth.toFixed(0)}x${viewportInfo.viewportHeight.toFixed(0)}`);
    console.log(`Zoom level: ${viewportInfo.zoom.toFixed(3)}`);

    // Basic verification that the graph loaded
    expect(viewportInfo.totalNodes).toBeGreaterThan(0);

    console.log('');
    console.log('✅ TERMINAL FIT VIEWPORT TEST PASSED');
    console.log('Review screenshot at: e2e-tests/test-results/terminal-fit-viewport.png');
    console.log('Visually verify that the viewport shows the terminal + context node + neighborhood');
  });
});

export { test };
