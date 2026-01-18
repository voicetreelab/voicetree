/**
 * BEHAVIORAL SPEC:
 * E2E test for verifying that changing the default write path actually changes
 * where new nodes are written to disk.
 *
 * BUG BEING TESTED:
 * When user changes the write path via VaultPathSelector dropdown, new nodes
 * should be created in the NEW write path. Currently, nodes are still written
 * to the original vault path.
 *
 * PRECONDITION:
 * Test vault has two directories: primary vault and 'second-vault'.
 * Both paths are added to the allowlist.
 *
 * EXPECTED OUTCOME (currently failing due to bug):
 * - After changing default write path to 'second-vault'
 * - Creating a new node should create the file in 'second-vault/'
 * - NOT in the original primary vault path
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

const PROJECT_ROOT = path.resolve(process.cwd());

// Type definitions
interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

// Extend test with Electron app
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  testProjectPath: string;
  primaryVaultPath: string;
  secondVaultPath: string;
}>({
  // Create a test project with two vault directories
  testProjectPath: async ({}, use) => {
    // Create temp directory structure
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-write-path-test-'));
    const primaryVault = path.join(tempDir, 'primary');
    const secondVault = path.join(tempDir, 'second-vault');

    await fs.mkdir(primaryVault, { recursive: true });
    await fs.mkdir(secondVault, { recursive: true });

    // Create an initial node in primary vault so graph isn't empty
    await fs.writeFile(
      path.join(primaryVault, 'initial-node.md'),
      '# Initial Node\n\nThis is the starting node in primary vault.'
    );

    await use(tempDir);

    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  primaryVaultPath: async ({ testProjectPath }, use) => {
    await use(path.join(testProjectPath, 'primary'));
  },

  secondVaultPath: async ({ testProjectPath }, use) => {
    await use(path.join(testProjectPath, 'second-vault'));
  },

  electronApp: async ({ testProjectPath }, use) => {
    // Create a temporary userData directory for this test
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-write-path-userdata-'));

    // Write config to auto-load the test project with 'primary' as vault suffix
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    const primaryVaultPath = path.join(testProjectPath, 'primary');
    await fs.writeFile(configPath, JSON.stringify({
      lastDirectory: testProjectPath,
      vaultConfig: {
        [testProjectPath]: {
          writePath: primaryVaultPath,
          readPaths: []
        }
      }
    }, null, 2), 'utf8');
    console.log('[Write Path Test] Created config to auto-load:', testProjectPath, 'with writePath:', primaryVaultPath);

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
      console.log('Note: Could not stop file watching during cleanup');
    }

    await electronApp.close();

    // Cleanup temp userData directory
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15000 });

    // Log console messages for debugging (only shown on test failure)
    const consoleLogs: string[] = [];
    window.on('console', msg => {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    });

    // Capture page errors
    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 15000 });

    // Wait for graph to load
    await window.waitForTimeout(1000);

    await use(window);
  }
});

test.describe('Write Path Change Bug', () => {
  // This test documents a known bug: changing write path doesn't affect where new nodes are created.
  // The test should pass once the bug is fixed. Until then, it's marked as failing with test.fail().
  test('changing write path should create new nodes in the new path', async ({
    appWindow,
    primaryVaultPath,
    secondVaultPath
  }) => {
    test.setTimeout(45000);

    // Bug fixed: currentVaultSuffix now stays in sync with defaultWritePath

    console.log('=== STEP 1: Verify initial state ===');
    await appWindow.waitForTimeout(500);

    // Get initial vault paths
    const initialVaultPaths = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getVaultPaths();
    });

    console.log('Initial vault paths:', initialVaultPaths);
    expect(initialVaultPaths.length).toBeGreaterThanOrEqual(1);

    // Get initial default write path
    const initialDefaultPath = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      const result = await api.main.getWritePath();
      if (result && typeof result === 'object' && '_tag' in result) {
        return (result as { _tag: string; value?: string })._tag === 'Some' ? (result as { value: string }).value : null;
      }
      return null;
    });

    console.log('Initial default write path:', initialDefaultPath);
    expect(initialDefaultPath).toBe(primaryVaultPath);

    console.log('=== STEP 2: Add second vault path to readPaths ===');
    const addResult = await appWindow.evaluate(async (secondPath: string) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.addReadOnLinkPath(secondPath);
    }, secondVaultPath);

    console.log('Add vault path result:', addResult);
    expect(addResult.success).toBe(true);

    // Verify we now have 2 vault paths
    const updatedVaultPaths = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getVaultPaths();
    });

    console.log('Updated vault paths:', updatedVaultPaths);
    expect(updatedVaultPaths.length).toBe(2);
    expect(updatedVaultPaths).toContain(secondVaultPath);

    console.log('=== STEP 3: Change default write path to second-vault ===');
    const setResult = await appWindow.evaluate(async (secondPath: string) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.setWritePath(secondPath);
    }, secondVaultPath);

    console.log('Set default write path result:', setResult);
    expect(setResult.success).toBe(true);

    // Verify default write path changed
    const newDefaultPath = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      const result = await api.main.getWritePath();
      if (result && typeof result === 'object' && '_tag' in result) {
        return (result as { _tag: string; value?: string })._tag === 'Some' ? (result as { value: string }).value : null;
      }
      return null;
    });

    console.log('New default write path:', newDefaultPath);
    expect(newDefaultPath).toBe(secondVaultPath);

    console.log('=== STEP 4: Create a new node using Cmd+N hotkey ===');
    // First, ensure no node is selected so Cmd+N creates an orphan node
    await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (cy) {
        cy.nodes().unselect();
      }
    });

    // Get node count before
    const nodeCountBefore = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return 0;
      return cy.nodes().filter(n => !n.data('isShadowNode')).length;
    });
    console.log('Node count before Cmd+N:', nodeCountBefore);

    // Press Cmd+N to create a new orphan node
    await appWindow.keyboard.press('Meta+n');

    // Wait for node creation and file write
    await appWindow.waitForTimeout(2000);

    // Get node count after
    const nodeCountAfter = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return 0;
      return cy.nodes().filter(n => !n.data('isShadowNode')).length;
    });
    console.log('Node count after Cmd+N:', nodeCountAfter);

    // Get all node IDs
    const allNodeIds = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return [];
      return cy.nodes().filter(n => !n.data('isShadowNode')).map(n => n.id());
    });
    console.log('All node IDs:', allNodeIds);

    console.log('=== STEP 5: Verify file was created in the correct location ===');

    // List files in both directories (recursive)
    const listFilesRecursive = async (dir: string): Promise<string[]> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const subFiles = await listFilesRecursive(fullPath);
          files.push(...subFiles.map(f => path.join(entry.name, f)));
        } else {
          files.push(entry.name);
        }
      }
      return files;
    };

    const primaryFiles = await listFilesRecursive(primaryVaultPath);
    const secondFiles = await listFilesRecursive(secondVaultPath);

    console.log('Files in primary vault (recursive):', primaryFiles);
    console.log('Files in second-vault (recursive):', secondFiles);

    // BUG ASSERTION: The file should be in second-vault
    // Currently this will FAIL because of the bug
    const newFilesInSecondVault = secondFiles.filter(f => f.endsWith('.md'));
    const newFilesInPrimary = primaryFiles.filter(f => f.endsWith('.md') && f !== 'initial-node.md');

    console.log('New files in second-vault (should have new node):', newFilesInSecondVault);
    console.log('New files in primary (should be empty):', newFilesInPrimary);

    // THE BUG: File is created in primary instead of second-vault
    // This assertion documents the expected behavior
    expect(newFilesInSecondVault.length).toBeGreaterThan(0);  // Should pass when bug is fixed
    expect(newFilesInPrimary.length).toBe(0);  // Should pass when bug is fixed

    console.log('');
    console.log('=== TEST SUMMARY ===');
    console.log('Write path change test completed.');
    console.log(`- Default write path was changed from 'primary' to 'second-vault'`);
    console.log(`- New node was created via Cmd+N`);
    console.log(`- File location: ${newFilesInSecondVault.length > 0 ? 'second-vault (CORRECT)' : 'primary (BUG)'}`);
  });
});

export { test };
