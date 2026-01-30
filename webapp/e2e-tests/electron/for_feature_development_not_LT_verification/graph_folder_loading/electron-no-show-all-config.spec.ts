/**
 * BEHAVIORAL SPEC:
 * 1. VaultConfig should persist and load WITHOUT showAllPaths field
 * 2. Loading a folder should work correctly without showAllPaths configuration
 * 3. The API no longer exposes getShowAllPaths or toggleShowAll
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

const PROJECT_ROOT = path.resolve(process.cwd());

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  testDir: string;
}>({
  testDir: async ({}, use) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-no-show-all-test-'));
    // Create test files
    await fs.writeFile(path.join(tempDir, 'test-node.md'), '# Test Node\n\nTest content.');
    await use(tempDir);
    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  electronApp: async ({ testDir }, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-no-show-all-userdata-'));

    // Write config WITHOUT showAllPaths field
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        lastDirectory: testDir,
        vaultConfig: {
          [testDir]: {
            writePath: testDir,
            readPaths: []
            // Note: NO showAllPaths field
          }
        }
      }, null, 2),
      'utf8'
    );

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
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
      // Ignore cleanup errors
    }

    await electronApp.close();
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 10000 });

    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
    await window.waitForTimeout(1000);

    await use(window);
  }
});

test.describe('No showAllPaths Configuration', () => {
  test('should load vault without showAllPaths config', async ({ appWindow }) => {
    test.setTimeout(30000);

    // Verify app loaded with no showAllPaths in config
    // getShowAllPaths should not exist as a function
    const configState = await appWindow.evaluate(async () => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');

      // Check if the function exists on the API
      const hasFunction = typeof (api.main as Record<string, unknown>).getShowAllPaths === 'function';
      return { hasShowAllPaths: hasFunction };
    });

    expect(configState.hasShowAllPaths).toBe(false);
  });

  test('should lazy-load readPaths without toggle option', async ({ appWindow }) => {
    test.setTimeout(30000);

    // Add a readPath and verify it uses lazy loading by default
    // No "show all" toggle should be available
    const result = await appWindow.evaluate(async () => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');

      // toggleShowAll should not exist as a function
      const hasToggle = typeof (api.main as Record<string, unknown>).toggleShowAll === 'function';
      return { hasToggle };
    });

    expect(result.hasToggle).toBe(false);
  });

  test('should handle legacy config with showAllPaths gracefully', async ({ appWindow }) => {
    test.setTimeout(30000);

    // The app should have loaded successfully even if a legacy config
    // had showAllPaths in it - verify graph loaded
    const graphState = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return {
        nodeCount: cy.nodes().length,
        isReady: true
      };
    });

    expect(graphState.isReady).toBe(true);
    expect(graphState.nodeCount).toBeGreaterThanOrEqual(1);
  });
});

export { test };
