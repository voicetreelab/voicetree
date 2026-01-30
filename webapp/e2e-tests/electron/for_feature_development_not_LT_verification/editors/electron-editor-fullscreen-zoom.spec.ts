/**
 * BEHAVIORAL SPEC:
 * E2E test for fullscreen zoom functionality on EDITORS (not terminals)
 *
 * This test verifies:
 * 1. Create a node and open an anchored editor
 * 2. Take screenshot BEFORE fullscreen (normal view)
 * 3. Click fullscreen button - viewport fits to editor with padding
 * 4. Take screenshot IN fullscreen mode
 * 5. Click fullscreen button again to restore viewport
 * 6. Take screenshot AFTER restoration
 *
 * NOTE: ESC key is intentionally disabled for editors due to vim mode conflicts
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

// Use large example graph for realistic testing
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
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-editor-fullscreen-test-'));

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

test.describe('Editor Fullscreen Zoom E2E', () => {
  test('should zoom to editor on fullscreen click and restore on second click', async ({ appWindow }) => {
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

    console.log('Graph auto-loaded with nodes');

    console.log('=== STEP 2: Select a markdown node ===');
    const targetNodeId = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Find a .md node (not a shadow node or terminal)
      const mdNodes = cy.nodes().filter(n => n.id().endsWith('.md') && !n.id().includes('shadow'));
      if (mdNodes.length === 0) throw new Error('No markdown nodes found');
      return mdNodes[0].id();
    });

    console.log(`Target node: ${targetNodeId}`);

    console.log('=== STEP 3: Open anchored editor by tapping node ===');
    await appWindow.evaluate((nodeId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById(nodeId);
      if (node.length === 0) throw new Error('Node not found');
      node.trigger('tap');
    }, targetNodeId);

    // Wait for editor to appear
    await appWindow.waitForTimeout(500);

    console.log('=== STEP 4: Verify editor floating window exists ===');
    const editorExists = await appWindow.evaluate(() => {
      return document.querySelectorAll('.cy-floating-window-editor').length;
    });
    console.log(`Editor windows found: ${editorExists}`);
    expect(editorExists).toBeGreaterThan(0);

    // Verify fullscreen button is visible (not hidden)
    const fullscreenButtonVisible = await appWindow.evaluate(() => {
      const btn = document.querySelector('.cy-floating-window-editor .cy-floating-window-fullscreen') as HTMLButtonElement;
      if (!btn) return false;
      return btn.style.display !== 'none';
    });
    expect(fullscreenButtonVisible).toBe(true);
    console.log('Fullscreen button is visible on editor');

    console.log('=== STEP 5: Capture viewport state BEFORE fullscreen ===');
    const beforeState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return {
        zoom: cy.zoom(),
        pan: cy.pan()
      };
    });
    console.log(`Before - Zoom: ${beforeState.zoom.toFixed(3)}, Pan: (${beforeState.pan.x.toFixed(0)}, ${beforeState.pan.y.toFixed(0)})`);

    // Screenshot BEFORE fullscreen
    await appWindow.screenshot({
      path: 'e2e-tests/test-results/editor-fullscreen-zoom-1-before.png'
    });
    console.log('Screenshot 1 saved: editor-fullscreen-zoom-1-before.png');

    console.log('=== STEP 6: Click fullscreen button on editor ===');
    await appWindow.evaluate(() => {
      const fullscreenBtn = document.querySelector('.cy-floating-window-editor .cy-floating-window-fullscreen') as HTMLButtonElement;
      if (!fullscreenBtn) throw new Error('Fullscreen button not found on editor');
      fullscreenBtn.click();
    });

    // Wait for viewport to fit
    await appWindow.waitForTimeout(500);

    console.log('=== STEP 7: Capture viewport state IN fullscreen ===');
    const fullscreenState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return {
        zoom: cy.zoom(),
        pan: cy.pan()
      };
    });
    console.log(`Fullscreen - Zoom: ${fullscreenState.zoom.toFixed(3)}, Pan: (${fullscreenState.pan.x.toFixed(0)}, ${fullscreenState.pan.y.toFixed(0)})`);

    // Screenshot IN fullscreen
    await appWindow.screenshot({
      path: 'e2e-tests/test-results/editor-fullscreen-zoom-2-fullscreen.png'
    });
    console.log('Screenshot 2 saved: editor-fullscreen-zoom-2-fullscreen.png');

    // Verify zoom changed (fullscreen should have different zoom)
    expect(fullscreenState.zoom).not.toBeCloseTo(beforeState.zoom, 2);
    console.log('Viewport zoomed to editor');

    console.log('=== STEP 8: Click fullscreen button again to restore ===');
    await appWindow.evaluate(() => {
      const fullscreenBtn = document.querySelector('.cy-floating-window-editor .cy-floating-window-fullscreen') as HTMLButtonElement;
      if (!fullscreenBtn) throw new Error('Fullscreen button not found on editor');
      fullscreenBtn.click();
    });

    // Wait for animation to complete (300ms animate duration + buffer)
    await appWindow.waitForTimeout(500);

    console.log('=== STEP 9: Capture viewport state AFTER restoration ===');
    const afterState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return {
        zoom: cy.zoom(),
        pan: cy.pan()
      };
    });
    console.log(`After - Zoom: ${afterState.zoom.toFixed(3)}, Pan: (${afterState.pan.x.toFixed(0)}, ${afterState.pan.y.toFixed(0)})`);

    // Screenshot AFTER restoration
    await appWindow.screenshot({
      path: 'e2e-tests/test-results/editor-fullscreen-zoom-3-restored.png'
    });
    console.log('Screenshot 3 saved: editor-fullscreen-zoom-3-restored.png');

    // Verify viewport restored to original state
    expect(afterState.zoom).toBeCloseTo(beforeState.zoom, 2);
    expect(afterState.pan.x).toBeCloseTo(beforeState.pan.x, 0);
    expect(afterState.pan.y).toBeCloseTo(beforeState.pan.y, 0);
    console.log('Viewport restored to original state');

    console.log('');
    console.log('EDITOR FULLSCREEN ZOOM TEST PASSED');
    console.log('Review screenshots at:');
    console.log('  - e2e-tests/test-results/editor-fullscreen-zoom-1-before.png');
    console.log('  - e2e-tests/test-results/editor-fullscreen-zoom-2-fullscreen.png');
    console.log('  - e2e-tests/test-results/editor-fullscreen-zoom-3-restored.png');
  });

  test('ESC key should NOT exit fullscreen for editors (vim mode protection)', async ({ appWindow }) => {
    test.setTimeout(90000);

    console.log('=== STEP 1: Wait for auto-load ===');
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

    console.log('=== STEP 2: Open editor by tapping a node ===');
    await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const mdNodes = cy.nodes().filter(n => n.id().endsWith('.md') && !n.id().includes('shadow'));
      if (mdNodes.length === 0) throw new Error('No markdown nodes found');
      mdNodes[0].trigger('tap');
    });
    await appWindow.waitForTimeout(500);

    console.log('=== STEP 3: Enter fullscreen mode ===');
    const beforeState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return { zoom: cy.zoom(), pan: cy.pan() };
    });

    await appWindow.evaluate(() => {
      const fullscreenBtn = document.querySelector('.cy-floating-window-editor .cy-floating-window-fullscreen') as HTMLButtonElement;
      if (!fullscreenBtn) throw new Error('Fullscreen button not found');
      fullscreenBtn.click();
    });
    await appWindow.waitForTimeout(500);

    // Verify we're in fullscreen (zoom changed)
    const fullscreenState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return { zoom: cy.zoom() };
    });
    expect(fullscreenState.zoom).not.toBeCloseTo(beforeState.zoom, 2);
    console.log('In fullscreen mode');

    console.log('=== STEP 4: Press ESC key ===');
    await appWindow.keyboard.press('Escape');
    await appWindow.waitForTimeout(500);

    console.log('=== STEP 5: Verify STILL in fullscreen (ESC should not exit for editors) ===');
    const afterEscState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return { zoom: cy.zoom() };
    });

    // ESC should NOT have changed the zoom - we should still be in fullscreen
    expect(afterEscState.zoom).toBeCloseTo(fullscreenState.zoom, 2);
    console.log('ESC key correctly did NOT exit fullscreen (vim mode protection working)');

    console.log('=== STEP 6: Click button to exit fullscreen ===');
    await appWindow.evaluate(() => {
      const fullscreenBtn = document.querySelector('.cy-floating-window-editor .cy-floating-window-fullscreen') as HTMLButtonElement;
      if (!fullscreenBtn) throw new Error('Fullscreen button not found');
      fullscreenBtn.click();
    });
    await appWindow.waitForTimeout(500);

    const finalState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return { zoom: cy.zoom() };
    });

    // Now we should be back to original
    expect(finalState.zoom).toBeCloseTo(beforeState.zoom, 2);
    console.log('Button click correctly exited fullscreen');

    console.log('');
    console.log('ESC KEY PROTECTION TEST PASSED');
  });
});

export { test };
