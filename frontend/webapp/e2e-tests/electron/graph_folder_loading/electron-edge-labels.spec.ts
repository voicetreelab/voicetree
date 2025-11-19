 /**
 * E2E TEST: Edge Labels in Auto-Loaded Folder
 *
 * Purpose: Verify that edge labels are correctly displayed in Cytoscape
 * after automatically loading a folder with markdown files containing
 * relationship labels (e.g., "is_a_bug_identified_during [[file]]")
 *
 * This is a simple smoke test - we just verify edge labels show up in the graph.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore, EdgeSingular } from 'cytoscape';
import type { ElectronAPI } from '@/utils/types/electron';

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
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-edge-labels-test-'));

    // Write the config file to auto-load the test vault
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: FIXTURE_VAULT_PATH }, null, 2), 'utf8');
    console.log('[Edge Labels Test] Created config file to auto-load:', FIXTURE_VAULT_PATH);

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}` // Use temp userData to isolate test config
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1'
      },
      timeout: 5000
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
    console.log('[Edge Labels Test] Electron app closed');

    // Cleanup temp directory
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
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

test.describe('Edge Labels E2E Test', () => {
  test('should display edge labels in Cytoscape after auto-loading folder', async ({ appWindow }) => {
    test.setTimeout(10000);
    console.log('=== E2E TEST: Verify edge labels show up in Cytoscape ===');

    // Verify app loaded
    const appReady = await appWindow.evaluate(() => {
      return !!(window as ExtendedWindow).cytoscapeInstance &&
             !!(window as ExtendedWindow).electronAPI;
    });
    expect(appReady).toBe(true);
    console.log('✓ App loaded successfully');

    // Wait for auto-load to complete
    await appWindow.waitForTimeout(2000);

    // Get edges from Cytoscape and verify labels exist
    const edgeData = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const edges = cy.edges();
      const edgeLabels = edges.map((e: EdgeSingular) => e.data('label')).filter(Boolean);

      return {
        totalEdges: edges.length,
        edgeLabels: edgeLabels,
        edgesWithLabels: edgeLabels.length
      };
    });

    console.log(`Total edges: ${edgeData.totalEdges}`);
    console.log(`Edges with labels: ${edgeData.edgesWithLabels}`);
    console.log('Edge labels found:', edgeData.edgeLabels);

    // Verify edges exist
    expect(edgeData.totalEdges).toBeGreaterThan(0);

    // Verify edge labels show up in Cytoscape
    // Based on example_small folder, we know files 2, 4, and 5 have labeled edges
    expect(edgeData.edgesWithLabels).toBeGreaterThan(0);

    console.log('✅ Edge labels test passed!');
  });
});

export { test };
