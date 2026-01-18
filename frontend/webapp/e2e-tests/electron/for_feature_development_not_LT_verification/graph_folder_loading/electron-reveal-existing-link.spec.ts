/**
 * BEHAVIORAL SPEC:
 * When a node in writePath has an existing wikilink to a node in readOnLinkPaths,
 * the linked node should be revealed (lazy-loaded) at initial graph load time.
 *
 * BUG: Currently, nodes linked via existing wikilinks are NOT revealed at load time.
 * The reveal only works when a NEW link is created (after the graph is already loaded).
 *
 * Expected behavior:
 * 1. writePath/main.md has [[linked-node]] wikilink
 * 2. readOnLinkPath/linked-node.md exists
 * 3. On graph load → linked-node.md should be visible in the graph
 *
 * This test demonstrates the failure case.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

const PROJECT_ROOT: string = path.resolve(process.cwd());

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  tempDir: string;
  writePath: string;
  readOnLinkPath: string;
}>({
  tempDir: async ({}, use) => {
    const tempDir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-reveal-existing-link-'));
    await use(tempDir);
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  writePath: async ({ tempDir }, use) => {
    const writePath: string = path.join(tempDir, 'write-vault');
    await fs.mkdir(writePath, { recursive: true });
    await use(writePath);
  },

  readOnLinkPath: async ({ tempDir }, use) => {
    const readOnLinkPath: string = path.join(tempDir, 'read-vault');
    await fs.mkdir(readOnLinkPath, { recursive: true });
    await use(readOnLinkPath);
  },

  electronApp: async ({ tempDir, writePath, readOnLinkPath }, use) => {
    const tempUserDataPath: string = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-reveal-existing-link-userdata-'));

    // Create the node files BEFORE launching the app
    // Main node in writePath with an EXISTING link to read-vault
    await fs.writeFile(
      path.join(writePath, 'main-node.md'),
      `# Main Node

This node is in the write path.

It has an existing wikilink to [[linked-node]] which should be revealed at load time.`
    );

    // Target node in readOnLinkPath (should be lazy-loaded via the existing link)
    await fs.writeFile(
      path.join(readOnLinkPath, 'linked-node.md'),
      `# Linked Node

This node is in readOnLinkPath.
It should be revealed because main-node links to it.`
    );

    // Unlinked node in readOnLinkPath (should NOT be loaded)
    await fs.writeFile(
      path.join(readOnLinkPath, 'unlinked-node.md'),
      `# Unlinked Node

This node has no incoming links.
It should NOT be loaded.`
    );

    // Write config with writePath and readOnLinkPaths configured
    const configPath: string = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        lastDirectory: tempDir,
        vaultConfig: {
          [tempDir]: {
            writePath: writePath,
            readOnLinkPaths: [readOnLinkPath]
          }
        }
      }, null, 2),
      'utf8'
    );

    const electronApp: ElectronApplication = await electron.launch({
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
      const window: Page = await electronApp.firstWindow();
      await window.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (api) {
          await api.main.stopFileWatching();
        }
      });
      await window.waitForTimeout(300);
    } catch {
      // ignore cleanup errors
    }

    await electronApp.close();
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp }, use) => {
    const window: Page = await electronApp.firstWindow({ timeout: 10000 });

    window.on('console', msg => {
      const text: string = msg.text();
      if (
        text.includes('[loadFolder]') ||
        text.includes('resolveLinkedNodes') ||
        text.includes('findFileByName') ||
        text.includes('Lazy loaded')
      ) {
        console.log(`[Browser] ${text}`);
      }
    });

    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
    // Wait for graph to stabilize after initial load
    await window.waitForTimeout(2000);

    await use(window);
  }
});

test.describe('Reveal node on existing link', () => {
  /**
   * CRITICAL TEST: Verifies that nodes linked via EXISTING wikilinks are revealed.
   *
   * Setup:
   * - writePath/main-node.md contains [[linked-node]]
   * - readOnLinkPath/linked-node.md exists
   *
   * Expected: linked-node should be visible in the graph at load time
   *
   * Current bug: linked-node is NOT revealed unless the link is created AFTER load
   */
  test('should reveal linked node from readOnLinkPath when link ALREADY exists at load time', async ({ appWindow }) => {
    test.setTimeout(30000);

    // Wait additional time for lazy loading to complete
    await appWindow.waitForTimeout(1000);

    // Get the current state of the graph
    const nodeState = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return {
        nodeCount: cy.nodes().length,
        labels: cy.nodes().map(n => n.data('label') as string),
        ids: cy.nodes().map(n => n.id())
      };
    });

    console.log('Node state after initial load:', JSON.stringify(nodeState, null, 2));

    // Main node from writePath should be loaded
    expect(nodeState.labels).toContain('Main Node');

    // CRITICAL ASSERTION: Linked node from readOnLinkPath should be revealed
    // This is the expected behavior that should pass
    expect(
      nodeState.labels,
      'Linked node should be revealed because main-node has an existing wikilink to it'
    ).toContain('Linked Node');

    // Unlinked node should NOT be loaded (lazy loading working correctly)
    expect(
      nodeState.labels,
      'Unlinked node should NOT be loaded (no incoming links)'
    ).not.toContain('Unlinked Node');
  });

  /**
   * Comparison test: Creating a NEW link should trigger reveal.
   *
   * This tests the working scenario (for comparison):
   * 1. Add a new wikilink to main-node
   * 2. The newly linked node should be revealed
   */
  test('should reveal linked node when NEW link is created after load (working scenario)', async ({
    appWindow,
    writePath,
    readOnLinkPath
  }) => {
    test.setTimeout(30000);

    // Create a new target node that we'll link to
    await fs.writeFile(
      path.join(readOnLinkPath, 'new-target.md'),
      `# New Target Node

This node will be linked AFTER the graph is loaded.`
    );

    // Add a link to the new target in the existing main-node
    await fs.writeFile(
      path.join(writePath, 'main-node.md'),
      `# Main Node

This node is in the write path.

It has an existing wikilink to [[linked-node]] which should be revealed at load time.

NEW: Now also linking to [[new-target]].`
    );

    // Wait for file watcher to pick up the change and trigger lazy loading
    await appWindow.waitForTimeout(3000);

    const nodeState = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return {
        nodeCount: cy.nodes().length,
        labels: cy.nodes().map(n => n.data('label') as string)
      };
    });

    console.log('Node state after adding new link:', JSON.stringify(nodeState, null, 2));

    // New target should be revealed (this should work - it's the working scenario)
    expect(
      nodeState.labels,
      'Newly linked target should be revealed after creating the link'
    ).toContain('New Target Node');
  });

  /**
   * Test transitive links with existing wikilinks.
   *
   * Setup:
   * - writePath/a.md links to [[b]] (existing link)
   * - readOnLinkPath/b.md links to [[c]] (existing link)
   * - readOnLinkPath/c.md exists
   *
   * Expected: All nodes A, B, C should be visible
   */
  test('should reveal transitively linked nodes from existing links', async ({ appWindow, writePath, readOnLinkPath }) => {
    test.setTimeout(30000);

    // Create a chain of files with existing links
    await fs.writeFile(path.join(writePath, 'chain-start.md'), '# Chain Start\nLinks to [[chain-middle]]');
    await fs.writeFile(path.join(readOnLinkPath, 'chain-middle.md'), '# Chain Middle\nLinks to [[chain-end]]');
    await fs.writeFile(path.join(readOnLinkPath, 'chain-end.md'), '# Chain End\nEnd of the chain');

    // Reload the folder to pick up new files
    await appWindow.evaluate(async (dir: string) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      await api.main.startFileWatching(dir);
    }, path.dirname(writePath));

    // Wait for lazy loading to complete
    await appWindow.waitForTimeout(2500);

    const nodeState = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return {
        labels: cy.nodes().map(n => n.data('label') as string)
      };
    });

    console.log('Node state after transitive load:', JSON.stringify(nodeState, null, 2));

    // All nodes in the chain should be revealed
    expect(nodeState.labels).toContain('Chain Start');
    expect(nodeState.labels, 'Chain middle should be revealed (direct link from chain-start)').toContain('Chain Middle');
    expect(nodeState.labels, 'Chain end should be revealed (transitive link via chain-middle)').toContain('Chain End');
  });
});

export { test };
