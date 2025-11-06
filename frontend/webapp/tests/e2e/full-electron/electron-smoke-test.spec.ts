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
import * as fs from 'fs/promises';
import * as os from 'os';
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
  userDataDir: string;
}>({
  // Set up a custom user data directory with a pre-configured last directory
  userDataDir: async ({}, use) => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-smoke-test-'));

    // Create config file with lastDirectory preset to our test fixture
    const configPath = path.join(tmpDir, 'voicetree-config.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({ lastDirectory: FIXTURE_VAULT_PATH }, null, 2),
      'utf-8'
    );

    console.log(`[Smoke Test] Created config at: ${configPath}`);
    console.log(`[Smoke Test] Last directory set to: ${FIXTURE_VAULT_PATH}`);

    await use(tmpDir);

    // Cleanup
    try {
      await fs.rm(tmpDir, { recursive: true });
    } catch (error) {
      console.log('Note: Could not clean up temp config dir:', error);
    }
  },

  electronApp: async ({ userDataDir }, use) => {
    console.log('[Smoke Test] Launching Electron app with custom user data dir...');

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${userDataDir}`
      ],
      env: {
        ...process.env,
        // IMPORTANT: Use production mode so initialLoad() is NOT skipped
        // (main.ts:78-81 skips initialLoad in test/headless mode)
        NODE_ENV: 'production',
        MINIMIZE_TEST: '1', // Still minimize to avoid window stealing focus
      },
      timeout: 120000 // 2 minutes timeout (needed for slower CI environments)
    });

    console.log('[Smoke Test] Electron app launched');

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
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
    // Give initialLoad() time to complete (it runs on did-finish-load event)
    await window.waitForTimeout(3000);

    await use(window);
  }
});

test.describe('Smoke Test', () => {
  test('should call initialLoad() on startup and load graph into memory', async ({ appWindow }) => {
    console.log('\n=== SMOKE TEST: Verify initialLoad() is called on startup ===');

    console.log('=== Step 1: Verify app loaded and initialized ===');
    const appReady = await appWindow.evaluate(() => {
      return !!(window as ExtendedWindow).cytoscapeInstance &&
             !!(window as ExtendedWindow).electronAPI;
    });
    expect(appReady).toBe(true);
    console.log('✓ App loaded successfully');

    console.log('=== Step 2: Verify graph was automatically loaded by initialLoad() ===');
    // The key difference from the old test: we DON'T manually call startFileWatching
    // Instead, initialLoad() should have automatically loaded the graph from the config

    const graphState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      return {
        nodeCount: cy.nodes().length,
        edgeCount: cy.edges().length,
        nodeLabels: cy.nodes().map((n: NodeSingular) => n.data('label')).slice(0, 5)
      };
    });

    console.log(`Graph automatically loaded: ${graphState.nodeCount} nodes, ${graphState.edgeCount} edges`);
    console.log('Sample node labels:', graphState.nodeLabels);

    // Verify that initialLoad() successfully loaded the graph
    // If initialLoad() wasn't called or failed, nodeCount would be 0
    expect(graphState.nodeCount).toBeGreaterThan(0);
    console.log('✓ initialLoad() successfully loaded graph on startup');

    console.log('=== Step 3: Verify file watching is active ===');
    const watchingStatus = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) return null;

      // @ts-expect-error - getWatchStatus might not be in type definitions
      return await api.getWatchStatus?.();
    });

    if (watchingStatus) {
      expect(watchingStatus.isWatching).toBe(true);
      expect(watchingStatus.directory).toBe(FIXTURE_VAULT_PATH);
      console.log('✓ File watching is active for:', watchingStatus.directory);
    } else {
      console.log('⚠ Could not verify watch status (API may not be exposed)');
    }

    console.log('\n✅ SMOKE TEST PASSED: App compiles, starts, initialLoad() runs, and graph loads into memory');
  });

  test('should load graph with manual file watching (legacy test)', async ({ appWindow }) => {
    console.log('=== Running legacy smoke test (manual file watching) ===');

    // Verify app loaded
    const appReady = await appWindow.evaluate(() => {
      return !!(window as ExtendedWindow).cytoscapeInstance &&
             !!(window as ExtendedWindow).electronAPI;
    });
    expect(appReady).toBe(true);
    console.log('✓ App loaded successfully');

    // Manually load the test vault (legacy approach)
    const watchResult = await appWindow.evaluate(async (vaultPath) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.startFileWatching(vaultPath);
    }, FIXTURE_VAULT_PATH);

    expect(watchResult.success).toBe(true);
    console.log('✓ File watching started manually');

    // Wait for initial scan
    await appWindow.waitForTimeout(3000);

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
