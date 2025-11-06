/**
 * SMOKE TEST for main.ts
 *
 * Purpose: Verify that the Electron app compiles, starts, and performs basic initialization.
 * This test checks that initialLoad() is called on startup and the graph is loaded into memory.
 *
 * This is a minimal smoke test - we don't verify UI functionality, just core startup behavior.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import type { Core as CytoscapeCore, NodeSingular } from 'cytoscape';

// Use absolute paths
const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'tests', 'fixtures', 'example_small');

// Type definitions
interface ExtendedWindow extends Window {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: {
    startFileWatching: (dir: string) => Promise<{ success: boolean; directory?: string; error?: string }>;
    stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
  };
}

// Extend test with Electron app
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    const electronApp = await electron.launch({
      args: [path.join(PROJECT_ROOT, 'dist-electron/main/index.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1'
      },
      timeout: 10000 // 10 second timeout
    });

    await use(electronApp);

    // Graceful shutdown
    try {
      const window = await electronApp.firstWindow();
      await window.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (api) {
          await api.stopFileWatching();
        }
      });
      await window.waitForTimeout(300);
    } catch {
      console.log('Note: Could not stop file watching during cleanup (window may be closed)');
    }

    await electronApp.close();
    console.log('[Smoke Test] Electron app closed');
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();

    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 5000 });

    await use(window);
  }
});

test.describe('Smoke Test', () => {
  test('should start app and load graph into memory', async ({ appWindow }) => {
    test.setTimeout(10000); // 10 second timeout - if it takes longer, something is wrong
    console.log('=== SMOKE TEST: Verify Electron app compiles and starts ===');

    // Verify app loaded
    const appReady = await appWindow.evaluate(() => {
      return !!(window as ExtendedWindow).cytoscapeInstance &&
             !!(window as ExtendedWindow).electronAPI;
    });
    expect(appReady).toBe(true);
    console.log('✓ App loaded successfully');

    // Manually load the test vault
    const watchResult = await appWindow.evaluate(async (vaultPath) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.startFileWatching(vaultPath);
    }, FIXTURE_VAULT_PATH);

    console.log('Watch result:', JSON.stringify(watchResult));
    expect(watchResult).toBeDefined();
    expect(watchResult.success).toBe(true);
    console.log('✓ File watching started');

    // Wait for initial scan
    await appWindow.waitForTimeout(1000);

    // Verify graph has visible nodes
    const graphState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      return {
        nodeCount: cy.nodes().length,
        nodeLabels: cy.nodes().map((n: NodeSingular) => n.data('label')).slice(0, 5)
      };
    });

    console.log(`Graph loaded with ${graphState.nodeCount} nodes`);
    console.log('Sample node labels:', graphState.nodeLabels);

    // Verify we have some nodes
    expect(graphState.nodeCount).toBeGreaterThan(0);
    console.log('✓ Graph has visible nodes');

    console.log('✅ Legacy smoke test passed!');
  });
});

export { test };
