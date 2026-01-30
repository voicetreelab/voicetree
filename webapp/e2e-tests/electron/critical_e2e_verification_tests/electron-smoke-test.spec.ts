/**
 * SMOKE TEST for main.ts
 *
 * Purpose: Verify that the Electron app compiles, starts, and can navigate to graph view.
 * This test:
 * 1. Launches with a pre-saved project in projects.json
 * 2. Verifies project selection screen shows with the saved project
 * 3. Selects the project to navigate to graph view
 * 4. Verifies graph loads correctly with nodes
 *
 * This is a minimal smoke test - we verify core startup and navigation behavior.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore, NodeSingular } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

// Use absolute paths
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
    // Create a temporary userData directory for this test
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-smoke-test-'));

    // Create projects.json with a pre-saved project
    // This simulates a user who has previously used the app
    const projectsPath = path.join(tempUserDataPath, 'projects.json');
    const savedProject = {
      id: 'smoke-test-project-id',
      path: FIXTURE_VAULT_PATH,
      name: 'example_small',
      type: 'folder',
      lastOpened: Date.now(),
      voicetreeInitialized: true
    };
    await fs.writeFile(projectsPath, JSON.stringify([savedProject], null, 2), 'utf8');
    console.log('[Smoke Test] Created projects.json with saved project:', FIXTURE_VAULT_PATH);

    // Also keep the legacy config file for backwards compatibility
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: FIXTURE_VAULT_PATH }, null, 2), 'utf8');

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}` // Use temp userData to isolate test config
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
        VOICETREE_PERSIST_STATE: '1'
      },
      timeout: 15000
    });

    await use(electronApp);

    // Graceful shutdown
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
      console.log('Note: Could not stop file watching during cleanup (window may be closed)');
    }

    await electronApp.close();
    console.log('[Smoke Test] Electron app closed');

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

    // Wait for project selection screen to load
    await window.waitForSelector('text=Voicetree', { timeout: 10000 });
    console.log('[Smoke Test] Project selection screen loaded');

    // Wait for saved projects to load and display
    await window.waitForSelector('text=Recent Projects', { timeout: 10000 });
    console.log('[Smoke Test] Recent Projects section visible');

    // Click the saved project to navigate to graph view
    const projectButton = window.locator('button:has-text("example_small")').first();
    await projectButton.click();
    console.log('[Smoke Test] Clicked project to navigate to graph view');

    // Wait for graph view to load (cytoscape instance should become available)
    await window.waitForFunction(
      () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
      { timeout: 15000 }
    );
    console.log('[Smoke Test] Graph view loaded');

    // Wait a bit longer to ensure graph is ready
    await window.waitForTimeout(1000);

    await use(window);
  }
});

test.describe('Smoke Test', () => {
  test('should start app and load graph after project selection', async ({ appWindow }) => {
    test.setTimeout(30000);
    console.log('=== SMOKE TEST: Verify Electron app compiles, starts, and loads graph ===');

    // Verify app is in graph view with cytoscape and electronAPI ready
    const appReady = await appWindow.evaluate(() => {
      return !!(window as ExtendedWindow).cytoscapeInstance &&
             !!(window as ExtendedWindow).electronAPI;
    });
    expect(appReady).toBe(true);
    console.log('✓ App loaded successfully with graph view');

    // Wait for graph nodes to load
    await appWindow.waitForFunction(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return false;
      return cy.nodes().length > 1;
    }, { timeout: 8000 });
    console.log('✓ Cytoscape nodes loaded');

    // Verify graph was automatically loaded into main process state
    const graph = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getGraph();
    });

    expect(graph).toBeDefined();
    const nodeCount = Object.keys(graph.nodes).length;
    console.log(`✓ Graph loaded into state with ${nodeCount} nodes`);
    expect(nodeCount).toBeGreaterThan(1);

    // Verify graph was rendered in Cytoscape UI-edge
    const cytoscapeState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return {
        nodeCount: cy.nodes().length,
        nodeLabels: cy.nodes().map((n: NodeSingular) => n.data('label')).slice(0, 3)
      };
    });

    console.log(`✓ Graph rendered in UI with ${cytoscapeState.nodeCount} nodes`);
    console.log('  Sample labels:', cytoscapeState.nodeLabels.join(', '));

    // Smoke test: Just verify nodes are rendered (may include virtual nodes)
    expect(cytoscapeState.nodeCount).toBeGreaterThan(2);

    // Verify back button is visible (confirms we're in graph view with navigation)
    const backButton = appWindow.locator('button[title="Back to project selection"]');
    await expect(backButton).toBeVisible({ timeout: 5000 });
    console.log('✓ Back button visible (confirms graph view with project selection integration)');

    console.log('✅ Smoke test passed!');
  });
});

export { test };
