/**
 * Test: agent-created nodes should NOT be auto-pinned
 *
 * Bug: applyGraphDeltaToUI auto-pinned the last new node on every delta.
 * When create_graph sends one delta per node, ALL nodes got pinned.
 *
 * Fix: Removed blanket auto-pin from applyGraphDeltaToUI. Only nodes
 * explicitly registered via requestAutoPinOnCreation() (manual UI creation)
 * get auto-pinned. Agent/FS-watcher nodes are never auto-pinned.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

const PROJECT_ROOT = path.resolve(process.cwd());

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-mass-pin-test-'));

    // Create watched folder with vault suffix
    const watchedFolder = path.join(tempUserDataPath, 'test-vault');
    await fs.mkdir(watchedFolder, { recursive: true });
    const vaultPath = path.join(watchedFolder, 'voicetree');
    await fs.mkdir(vaultPath, { recursive: true });

    // Write config to auto-load the watched folder
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: watchedFolder }, null, 2), 'utf8');

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1'
      },
      timeout: 30000
    });

    await use(electronApp);

    // Graceful shutdown
    try {
      const window = await electronApp.firstWindow();
      await window.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (api) await api.main.stopFileWatching();
      });
      await window.waitForTimeout(300);
    } catch {
      console.log('[MassAutoPin] Could not stop file watching during cleanup');
    }

    await electronApp.close();
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

    await window.waitForLoadState('domcontentloaded', { timeout: 60000 });
    await window.waitForFunction(
      () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
      { timeout: 20000 }
    );
    await window.waitForTimeout(500);

    await use(window);
  }
});

test.describe('Agent node creation should not auto-pin', () => {

  test('should NOT auto-pin any nodes when 5 nodes arrive as separate rapid deltas (simulating create_graph)', async ({ appWindow }) => {
    test.setTimeout(60000);
    console.log('=== Testing: agent-created nodes must not be auto-pinned ===');

    // Create 5 nodes in rapid succession (one delta per node, simulating create_graph)
    // These go through the main process API, NOT the manual UI creation path,
    // so requestAutoPinOnCreation is NOT called.
    const createdNodeIds: string[] = await appWindow.evaluate(async () => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');

      const ids: string[] = [];
      for (let i = 1; i <= 5; i++) {
        const nodeId = `voicetree/batch-node-${i}.md`;
        ids.push(nodeId);

        await api.main.applyGraphDeltaToDBThroughMemUIAndEditorExposed([{
          type: 'UpsertNode' as const,
          nodeToUpsert: {
            absoluteFilePathIsID: nodeId,
            outgoingEdges: [] as const,
            contentWithoutYamlOrLinks: `# Batch Node ${i}\n\nContent for node ${i}.`,
            nodeUIMetadata: {
              color: { _tag: 'None' } as const,
              position: { _tag: 'Some', value: { x: 100 * i, y: 100 } } as const,
              additionalYAMLProps: new Map()
            }
          },
          previousNode: { _tag: 'None' } as const
        }]);
      }
      return ids;
    });

    console.log('[MassAutoPin] Created node IDs:', createdNodeIds);

    // Wait for IPC deltas to be processed by renderer
    await appWindow.waitForTimeout(3000);

    // Wait for all 5 nodes to appear in Cytoscape
    await expect.poll(async () => {
      return appWindow.evaluate((nodeIds) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) return 0;
        return nodeIds.filter(id => cy.getElementById(id).length > 0).length;
      }, createdNodeIds);
    }, {
      message: 'Waiting for all 5 nodes to appear in Cytoscape',
      timeout: 10000,
      intervals: [500, 1000, 2000]
    }).toBe(5);

    // Check pinned state — NONE should be pinned
    const pinnedCount: number = await appWindow.evaluate(() => {
      return document.querySelectorAll('.mode-pinned').length;
    });

    console.log(`[MassAutoPin] Pinned count: ${pinnedCount}`);

    // ASSERTION: No nodes should be auto-pinned (agent path doesn't call requestAutoPinOnCreation)
    expect(pinnedCount).toBe(0);

    // All 5 Cy nodes should have full opacity (no hidden circles)
    const allVisible = await appWindow.evaluate((nodeIds) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return false;
      return nodeIds.every(id => {
        const node = cy.getElementById(id);
        return node.length > 0 && node.style('opacity') === 1;
      });
    }, createdNodeIds);

    expect(allVisible).toBe(true);

    console.log('=== Agent node auto-pin test passed ===');
  });
});

export { test };
