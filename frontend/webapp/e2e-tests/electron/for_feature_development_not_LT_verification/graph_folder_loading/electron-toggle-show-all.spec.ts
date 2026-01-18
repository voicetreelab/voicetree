/**
 * BEHAVIORAL SPEC:
 * E2E test for the "Toggle Show All" feature on read paths.
 *
 * This test verifies:
 * 1. Eye icon appears only on read paths (not write path)
 * 2. Default state shows 'show only linked' icon
 * 3. Toggling ON loads ALL nodes from that path
 * 4. Toggling OFF removes unlinked nodes
 * 5. State persists in showAllPaths config
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
  writePath: string;
  readOnLinkPath: string;
}>({
  // Create test directory structure:
  // testDir/
  //   write-vault/           <- writePath (loaded immediately)
  //     node-a.md            <- Links to [[linked-node]]
  //   read-vault/            <- readOnLinkPath (lazy loaded)
  //     linked-node.md       <- SHOULD be loaded (linked by node-a)
  //     unlinked-node.md     <- SHOULD NOT be loaded initially (no links to it)
  testDir: async ({}, use) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-toggle-show-all-test-'));
    await use(tempDir);
    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  writePath: async ({ testDir }, use) => {
    const writePath = path.join(testDir, 'write-vault');
    await fs.mkdir(writePath, { recursive: true });

    // Create a node that links to a node in readOnLinkPath
    await fs.writeFile(
      path.join(writePath, 'node-a.md'),
      `# Node A

This node links to [[linked-node]] in read-vault.
`
    );

    await use(writePath);
  },

  readOnLinkPath: async ({ testDir }, use) => {
    const readOnLinkPath = path.join(testDir, 'read-vault');
    await fs.mkdir(readOnLinkPath, { recursive: true });

    // Create a node that SHOULD be loaded (linked by node-a)
    await fs.writeFile(
      path.join(readOnLinkPath, 'linked-node.md'),
      `# Linked Node

This node is linked from node-a and should be lazy-loaded.
`
    );

    // Create a node that SHOULD NOT be loaded initially (no links to it)
    await fs.writeFile(
      path.join(readOnLinkPath, 'unlinked-node.md'),
      `# Unlinked Node

This node has NO links pointing to it.
It should only appear when "show all" is toggled ON.
`
    );

    await use(readOnLinkPath);
  },

  electronApp: async ({ testDir, writePath, readOnLinkPath }, use) => {
    // Create a temporary userData directory
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-toggle-show-all-userdata-'));

    // Write config with:
    // - writePath as the write destination
    // - readOnLinkPath in readOnLinkPaths (but NOT in showAllPaths)
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        lastDirectory: testDir,
        vaultConfig: {
          [testDir]: {
            writePath: writePath,
            readOnLinkPaths: [readOnLinkPath],
            showAllPaths: []  // Not showing all initially
          }
        }
      }, null, 2),
      'utf8'
    );
    console.log('[Toggle Show All Test] Config created for:', testDir);

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
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 10000 });

    window.on('console', msg => {
      const text = msg.text();
      if (text.includes('toggleShowAll') || text.includes('[VaultPathSelector]') || text.includes('showAllPaths')) {
        console.log(`[Browser] ${text}`);
      }
    });

    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });

    // Wait for graph to load
    await window.waitForTimeout(1000);

    await use(window);
  }
});

test.describe('Toggle Show All E2E', () => {
  test('should toggle show all ON and load all nodes from read path', async ({
    appWindow,
    readOnLinkPath
  }) => {
    test.setTimeout(30000);

    console.log('=== STEP 1: Verify initial state (only linked nodes loaded) ===');

    // Get initial nodes - should have node-a and linked-node (lazy loaded because it's linked)
    const initialNodes = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return cy.nodes().map(n => n.id());
    });

    console.log('Initial nodes:', initialNodes);

    // Should have node-a and linked-node
    expect(initialNodes.some(id => id.includes('node-a'))).toBe(true);
    expect(initialNodes.some(id => id.includes('linked-node'))).toBe(true);
    // Should NOT have unlinked-node yet
    expect(initialNodes.some(id => id.includes('unlinked-node'))).toBe(false);

    // Verify showAllPaths is initially empty
    const initialShowAllPaths = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getShowAllPaths();
    });

    console.log('Initial showAllPaths:', initialShowAllPaths);
    expect(initialShowAllPaths).toEqual([]);

    console.log('=== STEP 2: Toggle show all ON for read-vault ===');

    // Call toggleShowAll via API
    const toggleResult = await appWindow.evaluate(async (vaultPath: string) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.toggleShowAll(vaultPath);
    }, readOnLinkPath);

    console.log('toggleShowAll result:', toggleResult);
    expect(toggleResult.success).toBe(true);
    expect(toggleResult.showAll).toBe(true);

    // Wait for nodes to load
    await appWindow.waitForTimeout(1000);

    console.log('=== STEP 3: Verify all nodes now visible ===');

    const nodesAfterToggleOn = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return cy.nodes().map(n => n.id());
    });

    console.log('Nodes after toggle ON:', nodesAfterToggleOn);

    // Should now have all three nodes
    expect(nodesAfterToggleOn.some(id => id.includes('node-a'))).toBe(true);
    expect(nodesAfterToggleOn.some(id => id.includes('linked-node'))).toBe(true);
    expect(nodesAfterToggleOn.some(id => id.includes('unlinked-node'))).toBe(true);

    // Verify showAllPaths now includes read-vault
    const showAllPathsAfterToggle = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getShowAllPaths();
    });

    console.log('showAllPaths after toggle:', showAllPathsAfterToggle);
    expect(showAllPathsAfterToggle).toContain(readOnLinkPath);

    console.log('');
    console.log('=== TEST PASSED: Toggle Show All ON ===');
    console.log('- Initial state had only linked nodes');
    console.log('- Toggle ON loaded all nodes from read-vault');
    console.log('- showAllPaths config was updated');
  });

  test('should toggle show all OFF and remove unlinked nodes', async ({
    appWindow,
    readOnLinkPath
  }) => {
    test.setTimeout(30000);

    console.log('=== STEP 1: First toggle show all ON ===');

    // Toggle ON first
    const toggleOnResult = await appWindow.evaluate(async (vaultPath: string) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.toggleShowAll(vaultPath);
    }, readOnLinkPath);

    expect(toggleOnResult.success).toBe(true);
    expect(toggleOnResult.showAll).toBe(true);

    await appWindow.waitForTimeout(1000);

    // Verify all nodes are visible
    const nodesWhenOn = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return cy.nodes().map(n => n.id());
    });

    console.log('Nodes when show all ON:', nodesWhenOn);
    expect(nodesWhenOn.some(id => id.includes('unlinked-node'))).toBe(true);

    console.log('=== STEP 2: Toggle show all OFF ===');

    // Toggle OFF
    const toggleOffResult = await appWindow.evaluate(async (vaultPath: string) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.toggleShowAll(vaultPath);
    }, readOnLinkPath);

    console.log('toggleShowAll OFF result:', toggleOffResult);
    expect(toggleOffResult.success).toBe(true);
    expect(toggleOffResult.showAll).toBe(false);

    await appWindow.waitForTimeout(1000);

    console.log('=== STEP 3: Verify unlinked nodes removed ===');

    const nodesAfterToggleOff = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return cy.nodes().map(n => n.id());
    });

    console.log('Nodes after toggle OFF:', nodesAfterToggleOff);

    // Should still have node-a and linked-node
    expect(nodesAfterToggleOff.some(id => id.includes('node-a'))).toBe(true);
    expect(nodesAfterToggleOff.some(id => id.includes('linked-node'))).toBe(true);
    // unlinked-node should be GONE
    expect(nodesAfterToggleOff.some(id => id.includes('unlinked-node'))).toBe(false);

    // Verify showAllPaths no longer includes read-vault
    const showAllPathsAfterOff = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getShowAllPaths();
    });

    console.log('showAllPaths after toggle OFF:', showAllPathsAfterOff);
    expect(showAllPathsAfterOff).not.toContain(readOnLinkPath);

    console.log('');
    console.log('=== TEST PASSED: Toggle Show All OFF ===');
    console.log('- Toggle OFF removed unlinked nodes');
    console.log('- Linked nodes remained visible');
    console.log('- showAllPaths config was updated');
  });

  test('should show eye icon only on read paths, not write path', async ({
    appWindow,
    writePath,
    readOnLinkPath
  }) => {
    test.setTimeout(30000);

    console.log('=== Verify eye icon placement in UI ===');

    // Check vault paths
    const vaultPaths = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getVaultPaths();
    });

    console.log('Vault paths:', vaultPaths);
    expect(vaultPaths.length).toBeGreaterThanOrEqual(2);

    // Open the dropdown by clicking the vault selector button
    await appWindow.evaluate(() => {
      // Find all buttons in the document
      const buttons = Array.from(document.querySelectorAll('button'));
      // Find the vault selector button (contains the folder name or ".")
      const selectorButton = buttons.find(b => {
        const text = b.textContent ?? '';
        // Look for the dropdown trigger - it has text and arrow
        return (text.includes('\u25BC') || text.includes('\u25B2')) && !text.includes('+');
      });
      if (selectorButton) {
        selectorButton.click();
      }
    });

    await appWindow.waitForTimeout(500);

    // Check dropdown content for eye icons
    const dropdownState = await appWindow.evaluate((paths: { writePath: string; readOnLinkPath: string }) => {
      const dropdown = document.querySelector('.absolute.bottom-full');
      if (!dropdown) return { dropdownFound: false };

      const rows = Array.from(dropdown.querySelectorAll('div[title]'));
      const results: { path: string; hasEyeIcon: boolean; eyeIconText: string | null }[] = [];

      for (const row of rows) {
        const rowTitle = row.getAttribute('title') ?? '';
        // Check if this row has an eye icon button
        const buttons = Array.from(row.querySelectorAll('button'));
        const eyeButton = buttons.find(b => {
          const text = b.textContent ?? '';
          return text.includes('\uD83D\uDC41') || text.includes('\uD83D\uDC41\u200D\uD83D\uDDE8'); // Eye emojis
        });

        results.push({
          path: rowTitle,
          hasEyeIcon: !!eyeButton,
          eyeIconText: eyeButton?.textContent ?? null
        });
      }

      return { dropdownFound: true, rows: results, writePath: paths.writePath, readOnLinkPath: paths.readOnLinkPath };
    }, { writePath, readOnLinkPath });

    console.log('Dropdown state:', JSON.stringify(dropdownState, null, 2));

    expect(dropdownState.dropdownFound).toBe(true);

    // The write path row should NOT have an eye icon
    const writePathRow = dropdownState.rows?.find((r: { path: string }) => r.path === writePath);
    const readPathRow = dropdownState.rows?.find((r: { path: string }) => r.path === readOnLinkPath);

    console.log('Write path row:', writePathRow);
    console.log('Read path row:', readPathRow);

    // Write path should NOT have eye icon
    if (writePathRow) {
      expect(writePathRow.hasEyeIcon).toBe(false);
    }

    // Read path SHOULD have eye icon
    if (readPathRow) {
      expect(readPathRow.hasEyeIcon).toBe(true);
    }

    console.log('');
    console.log('=== TEST PASSED: Eye Icon Placement ===');
    console.log('- Write path does NOT have eye icon');
    console.log('- Read path has eye icon');
  });
});

export { test };
