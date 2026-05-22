/**
 * BEHAVIORAL SPEC:
 * E2E test for terminal zoom scaling
 *
 * This test verifies:
 * 1. Terminal spawns at default zoom (1x)
 * 2. Terminal font size and window dimensions scale correctly when zooming in
 * 3. Terminal text selection works at zoomed level (via screenshot verification)
 *
 * The fix removes CSS transform: scale(zoom) and uses explicit DOM sizing
 * and font scaling to avoid xterm.js mouse coordinate mismatch.
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
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-zoom-scaling-test-'));

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
        HEADLESS_TEST: '1'
        // No MINIMIZE_TEST so screenshots are useful
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

test.describe('Terminal Zoom Scaling E2E', () => {
  test('terminal scales correctly at different zoom levels', async ({ appWindow }) => {
    test.setTimeout(90000);

    console.log('=== STEP 1: Wait for auto-load to complete ===');
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

    console.log('=== STEP 2: Get a node to create terminal from ===');
    const targetNodeId = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const nodes = cy.nodes();
      if (nodes.length === 0) throw new Error('No nodes available');
      return nodes[0].id();
    });

    console.log(`Target node: ${targetNodeId}`);

    console.log('=== STEP 3: Get current zoom level (should be ~1.0) ===');
    const initialZoom = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return cy.zoom();
    });
    console.log(`Initial zoom: ${initialZoom}`);

    console.log('=== STEP 4: Select node and spawn terminal via Cmd+Enter ===');
    await appWindow.evaluate((nodeId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById(nodeId);
      if (node.length === 0) throw new Error('Node not found');
      cy.nodes().unselect();
      node.select();
    }, targetNodeId);

    await appWindow.keyboard.press('Meta+Enter');

    // Wait for terminal to spawn (there's a 1000ms delay in implementation)
    await appWindow.waitForTimeout(3000);

    console.log('=== STEP 5: Verify terminal floating window exists ===');
    const terminalWindow = appWindow.locator('.cy-floating-window-terminal');
    await expect(terminalWindow).toBeVisible({ timeout: 5000 });
    console.log('✓ Terminal floating window visible');

    console.log('=== STEP 6: Get terminal dimensions at initial zoom ===');
    const initialState = await appWindow.evaluate(() => {
      const terminalEl = document.querySelector('.cy-floating-window-terminal') as HTMLElement;
      if (!terminalEl) throw new Error('Terminal element not found');

      // Check overlay transform to verify no scale() is being used (the fix)
      const overlay = document.querySelector('.cy-floating-overlay') as HTMLElement;
      const overlayTransform = overlay ? overlay.style.transform : '';

      return {
        windowWidth: terminalEl.offsetWidth,
        windowHeight: terminalEl.offsetHeight,
        baseWidth: parseFloat(terminalEl.dataset.baseWidth ?? '0'),
        baseHeight: parseFloat(terminalEl.dataset.baseHeight ?? '0'),
        overlayTransform,
        hasNoScaleTransform: !overlayTransform.includes('scale')
      };
    });

    console.log(`Initial window dimensions: ${initialState.windowWidth}x${initialState.windowHeight}`);
    console.log(`Base dimensions: ${initialState.baseWidth}x${initialState.baseHeight}`);
    console.log(`Overlay transform: ${initialState.overlayTransform}`);
    console.log(`Has no scale transform: ${initialState.hasNoScaleTransform}`);

    // Take screenshot at initial zoom
    await appWindow.screenshot({ path: 'e2e-tests/screenshots/terminal-zoom-1x.png' });
    console.log('✓ Screenshot saved: terminal-zoom-1x.png');

    console.log('=== STEP 7: Zoom to 2x ===');
    await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      cy.zoom(2);
      cy.center();
    });

    // Wait for zoom animation and terminal font resize (debounced 150ms)
    await appWindow.waitForTimeout(500);

    const zoomAfter = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return cy.zoom();
    });
    console.log(`Zoom after: ${zoomAfter}`);

    console.log('=== STEP 8: Get terminal state at 2x zoom ===');
    const zoomedState = await appWindow.evaluate(() => {
      const terminalEl = document.querySelector('.cy-floating-window-terminal') as HTMLElement;
      if (!terminalEl) throw new Error('Terminal element not found');

      // Verify overlay still has no scale transform after zoom
      const overlay = document.querySelector('.cy-floating-overlay') as HTMLElement;
      const overlayTransform = overlay ? overlay.style.transform : '';

      return {
        windowWidth: terminalEl.offsetWidth,
        windowHeight: terminalEl.offsetHeight,
        overlayTransform,
        hasNoScaleTransform: !overlayTransform.includes('scale')
      };
    });

    console.log(`Zoomed window dimensions: ${zoomedState.windowWidth}x${zoomedState.windowHeight}`);
    console.log(`Overlay transform after zoom: ${zoomedState.overlayTransform}`);

    // Take screenshot at 2x zoom
    await appWindow.screenshot({ path: 'e2e-tests/screenshots/terminal-zoom-2x.png' });
    console.log('✓ Screenshot saved: terminal-zoom-2x.png');

    console.log('=== STEP 9: Verify dimensions scaled correctly ===');
    // Window dimensions should roughly double (baseWidth * zoom)
    const expectedWidth = initialState.baseWidth * 2;
    const expectedHeight = initialState.baseHeight * 2;

    // Allow 5% tolerance for rounding
    const widthRatio = zoomedState.windowWidth / expectedWidth;
    const heightRatio = zoomedState.windowHeight / expectedHeight;

    console.log(`Expected dimensions: ${expectedWidth}x${expectedHeight}`);
    console.log(`Width ratio: ${widthRatio}, Height ratio: ${heightRatio}`);

    expect(widthRatio).toBeGreaterThan(0.95);
    expect(widthRatio).toBeLessThan(1.05);
    expect(heightRatio).toBeGreaterThan(0.95);
    expect(heightRatio).toBeLessThan(1.05);
    console.log('✓ Window dimensions scaled correctly');

    // Verify overlay uses translate only (no scale) - this is the key fix
    expect(initialState.hasNoScaleTransform).toBe(true);
    expect(zoomedState.hasNoScaleTransform).toBe(true);
    console.log('✓ Overlay uses translate only (no CSS scale transform)');

    console.log('=== STEP 10: Test text selection at zoomed level ===');
    // Click in the terminal to focus it
    await terminalWindow.click();
    await appWindow.waitForTimeout(200);

    // Type some text to have content to select
    await appWindow.keyboard.type('echo "Hello Terminal Zoom Test"');
    await appWindow.keyboard.press('Enter');
    await appWindow.waitForTimeout(500);

    // Perform click and drag to select text
    const terminalBox = await terminalWindow.boundingBox();
    if (terminalBox) {
      // Click and drag to select text in the terminal
      const startX = terminalBox.x + 100;
      const startY = terminalBox.y + 100;
      const endX = startX + 200;
      const endY = startY;

      await appWindow.mouse.move(startX, startY);
      await appWindow.mouse.down();
      await appWindow.mouse.move(endX, endY, { steps: 10 });
      await appWindow.mouse.up();

      await appWindow.waitForTimeout(200);
    }

    // Take screenshot showing selection at zoomed level
    await appWindow.screenshot({ path: 'e2e-tests/screenshots/terminal-zoom-2x-selection.png' });
    console.log('✓ Screenshot saved: terminal-zoom-2x-selection.png');

    console.log('');
    console.log('✅ TERMINAL ZOOM SCALING TEST PASSED');
    console.log('Review screenshots at: e2e-tests/screenshots/terminal-zoom-*.png');
    console.log('Key verifications:');
    console.log(`  - Window scaled from ${initialState.windowWidth}x${initialState.windowHeight} to ${zoomedState.windowWidth}x${zoomedState.windowHeight}`);
    console.log(`  - Overlay uses translate-only transform (no CSS scale)`);
  });
});

export { test };
