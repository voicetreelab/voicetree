/**
 * BEHAVIORAL SPEC:
 * Tests that ninja-keys search includes node CONTENT (not just titles), and that
 * external filesystem edits to node content are reflected in search results.
 *
 * Test Flow:
 * 1. App loads with existing nodes
 * 2. External filesystem edit adds unique searchable content to a node
 * 3. Search ninja-keys for that unique content
 * 4. Verify the node appears in search results
 *
 * This test verifies the bug fix from applyGraphDeltaToUI.ts where node content
 * was not being updated on existing nodes, causing SearchService to have stale keywords.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

// Use absolute paths
const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');

// Type definitions
interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

interface NinjaAction {
  id: string;
  title: string;
  keywords?: string;
}

interface NinjaKeysElement extends HTMLElement {
  data: NinjaAction[];
}

// Extend test with Electron app
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  tempVaultPath: string;
}>({
  tempVaultPath: async ({}, use) => {
    // Create a temporary copy of the fixture vault to avoid polluting the original
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-ninja-keys-test-vault-'));
    const tempVaultPath = path.join(tempDir, 'voicetree');

    // Copy fixture vault to temp directory
    await fs.mkdir(tempVaultPath, { recursive: true });
    const sourceVaultPath = path.join(FIXTURE_VAULT_PATH, 'voicetree');
    const files = await fs.readdir(sourceVaultPath);
    for (const file of files) {
      const srcPath = path.join(sourceVaultPath, file);
      const destPath = path.join(tempVaultPath, file);
      const stat = await fs.stat(srcPath);
      if (stat.isFile()) {
        await fs.copyFile(srcPath, destPath);
      }
    }

    await use(tempVaultPath);

    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  electronApp: async ({ tempVaultPath }, use) => {
    // Create a temporary userData directory for this test
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-ninja-keys-test-'));

    // Write the config file to auto-load the test vault
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    // Get parent directory of tempVaultPath (we use voicetree subfolder)
    const vaultParent = path.dirname(tempVaultPath);
    await fs.writeFile(configPath, JSON.stringify({
      lastDirectory: vaultParent,
      suffixes: {
        [vaultParent]: 'voicetree' // Use voicetree subfolder
      }
    }, null, 2), 'utf8');
    console.log('[Ninja Keys Test] Created config file to auto-load:', tempVaultPath);

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
    console.log('[Ninja Keys Test] Electron app closed');

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
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });

    await use(window);
  }
});

test.describe('Ninja Keys Content Sync', () => {
  test('should find node by content added via external filesystem edit', async ({ appWindow, tempVaultPath }) => {
    console.log('\n=== Testing ninja-keys search finds externally-edited content ===');

    console.log('=== Step 1: Wait for graph to load ===');
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return 0;
        return cy.nodes().length;
      });
    }, {
      message: 'Waiting for graph to load nodes',
      timeout: 15000,
      intervals: [500, 1000, 1000]
    }).toBeGreaterThan(0);

    const nodeCount = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      return cy?.nodes().length ?? 0;
    });
    console.log(`✓ Graph loaded with ${nodeCount} nodes`);

    console.log('=== Step 2: Get an existing node to modify ===');
    // Target file: 1_VoiceTree_Website_Development_and_Node_Display_Bug.md
    const targetFileName = '1_VoiceTree_Website_Development_and_Node_Display_Bug.md';
    const targetFilePath = path.join(tempVaultPath, targetFileName);

    // Read current content
    const originalContent = await fs.readFile(targetFilePath, 'utf8');
    console.log(`  Original content length: ${originalContent.length}`);

    console.log('=== Step 3: Make EXTERNAL filesystem edit with unique searchable content ===');
    // Add a unique string that ONLY exists in the content, not the title
    // This verifies the bug fix: content must be synced to ninja-keys keywords
    const uniqueSearchTerm = `UNIQUE_NINJA_KEYS_TEST_${Date.now()}`;
    const modifiedContent = originalContent.replace(
      '-----------------',
      `\nThis is externally added content: ${uniqueSearchTerm}\n\n-----------------`
    );

    await fs.writeFile(targetFilePath, modifiedContent, 'utf8');
    console.log(`  Added unique search term: ${uniqueSearchTerm}`);

    console.log('=== Step 4: Wait for file watcher to detect change and update UI ===');
    // The file watcher should detect the change and call applyGraphDeltaToUI
    // which should update the node's content data in Cytoscape
    await expect.poll(async () => {
      return appWindow.evaluate((searchTerm) => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return false;

        // Find nodes and check if any have the unique content
        const nodes = cy.nodes();
        for (let i = 0; i < nodes.length; i++) {
          const content = nodes[i].data('content') as string ?? '';
          if (content.includes(searchTerm)) {
            return true;
          }
        }
        return false;
      }, uniqueSearchTerm);
    }, {
      message: 'Waiting for Cytoscape node content to be updated',
      timeout: 10000,
      intervals: [200, 500, 1000]
    }).toBe(true);

    console.log('✓ Cytoscape node content updated with unique term');

    console.log('=== Step 5: Verify ninja-keys search data includes the new content ===');
    // SearchService.updateSearchData() or updateSearchDataIncremental() should
    // have synced the new content to ninja-keys keywords
    const searchDataCheck = await appWindow.evaluate((searchTerm) => {
      const ninjaKeys = document.querySelector('ninja-keys') as NinjaKeysElement | null;
      if (!ninjaKeys) return { found: false, reason: 'ninja-keys element not found' };

      const data = ninjaKeys.data;
      if (!data || data.length === 0) return { found: false, reason: 'ninja-keys has no data' };

      // Find if any action has keywords containing our unique term
      const matchingAction = data.find(action =>
        action.keywords?.includes(searchTerm)
      );

      return {
        found: !!matchingAction,
        matchingTitle: matchingAction?.title,
        totalActions: data.length
      };
    }, uniqueSearchTerm);

    console.log('  Search data check:', searchDataCheck);
    expect(searchDataCheck.found).toBe(true);
    console.log(`✓ ninja-keys keywords include unique term (found in "${searchDataCheck.matchingTitle}")`);

    console.log('=== Step 6: Open ninja-keys and search for the unique content ===');
    // Open search with keyboard shortcut
    await appWindow.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
    await appWindow.waitForTimeout(300);

    // Verify modal opened
    const modalOpen = await appWindow.evaluate(() => {
      const ninjaKeys = document.querySelector('ninja-keys');
      return ninjaKeys?.shadowRoot?.querySelector('.modal') !== null;
    });
    expect(modalOpen).toBe(true);
    console.log('✓ ninja-keys search modal opened');

    console.log('=== Step 7: Type unique search term and verify match ===');
    // Type part of our unique search term (enough to be unique)
    const partialSearch = uniqueSearchTerm.substring(0, 30);
    await appWindow.keyboard.type(partialSearch);
    await appWindow.waitForTimeout(300);

    // Check if we have filtered results that include our target
    const searchResults = await appWindow.evaluate(() => {
      const ninjaKeys = document.querySelector('ninja-keys');
      if (!ninjaKeys?.shadowRoot) return [];

      // Get visible action items from the modal
      const actions = ninjaKeys.shadowRoot.querySelectorAll('ninja-action');
      return Array.from(actions).map(action => {
        // ninja-action has a slot with the title
        const titleSlot = action.querySelector('[slot="title"]');
        return titleSlot?.textContent ?? action.textContent?.trim() ?? '';
      });
    });

    console.log(`  Search results count: ${searchResults.length}`);
    console.log(`  Results: ${searchResults.slice(0, 3).join(', ')}`);

    // Verify results exist (searching by content should return the matching node)
    expect(searchResults.length).toBeGreaterThan(0);
    console.log('✓ Search returned results when searching by content');

    console.log('=== Step 8: Select result and verify navigation ===');
    await appWindow.keyboard.press('Enter');
    await appWindow.waitForTimeout(500);

    // Verify modal closed (selection happened)
    const modalClosed = await appWindow.evaluate(() => {
      const ninjaKeys = document.querySelector('ninja-keys');
      if (!ninjaKeys?.shadowRoot) return true;
      const overlay = ninjaKeys.shadowRoot.querySelector('.modal-overlay');
      return !overlay || getComputedStyle(overlay).display === 'none';
    });

    expect(modalClosed).toBe(true);
    console.log('✓ ninja-keys modal closed after selection');

    console.log('=== Cleanup: Restore original content ===');
    await fs.writeFile(targetFilePath, originalContent, 'utf8');
    console.log('✓ Original content restored');

    console.log('\n✅ ninja-keys content sync test passed!');
    console.log('   This confirms the bug fix: external file edits update ninja-keys search keywords');
  });
});

export { test };
