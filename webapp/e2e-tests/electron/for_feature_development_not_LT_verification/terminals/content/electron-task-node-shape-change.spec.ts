/**
 * BEHAVIORAL SPEC:
 * 1. Spawn a terminal on a node with a simple echo command.
 * 2. Verify the parent node's shape changes to rectangle (square) to indicate it's a task node.
 * 3. Take a screenshot to confirm the visual change.
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-task-node-shape-test-'));
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({
      lastDirectory: FIXTURE_VAULT_PATH,
      suffixes: {
        [FIXTURE_VAULT_PATH]: ''
      }
    }, null, 2), 'utf8');
    console.log('[Test] Created config file to auto-load:', FIXTURE_VAULT_PATH);

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
    const window = await electronApp.firstWindow({ timeout: 15000 });

    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');

    try {
      await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
    } catch (error) {
      console.error('Failed to initialize cytoscape instance:', error);
      throw error;
    }

    await window.waitForTimeout(1000);

    await use(window);
  }
});

test.describe('Task Node Shape Change E2E', () => {
  test('should change parent node shape to rectangle when terminal is spawned', async ({ appWindow }) => {
    test.setTimeout(60000);

    console.log('=== STEP 1: Wait for auto-load to complete ===');
    // Give extra time for auto-load process like the context-node-agent test
    await appWindow.waitForTimeout(2000);

    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) return 0;
        return cy.nodes().length;
      });
    }, {
      message: 'Waiting for graph to auto-load nodes',
      timeout: 20000,
      intervals: [500, 1000, 2000, 2000]
    }).toBeGreaterThan(0);

    console.log('✓ Graph auto-loaded with nodes');

    console.log('=== STEP 2: Pick a non-context node to spawn a terminal ===');
    const targetNodeId = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      // Find a node that is NOT a context node (they're already rectangles)
      const nodes = cy.nodes().filter(n => !n.data('isContextNode'));
      if (nodes.length === 0) throw new Error('No non-context nodes available');
      return nodes[0].id();
    });

    console.log(`Target node: ${targetNodeId}`);

    console.log('=== STEP 3: Verify initial node shape is ellipse ===');
    const initialShape = await appWindow.evaluate((nodeId) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById(nodeId);
      // Check both the data attribute and the computed style
      return {
        hasRunningTerminal: node.data('hasRunningTerminal'),
        computedShape: node.style('shape') as string
      };
    }, targetNodeId);

    console.log(`Initial node state:`, initialShape);
    expect(initialShape.hasRunningTerminal).toBeFalsy();
    expect(initialShape.computedShape).toBe('ellipse');
    console.log('✓ Node initially has ellipse shape');

    // Take screenshot before spawning terminal
    await appWindow.screenshot({ path: 'e2e-tests/screenshots/task-node-shape-before.png' });
    console.log('✓ Screenshot saved: task-node-shape-before.png');

    console.log('=== STEP 4: Spawn terminal with echo command via orchestrated flow ===');
    const command = 'echo TASK_NODE_SHAPE_TEST';
    const terminalSpawnPromise = appWindow.evaluate(async ({ nodeId, cmd }) => {
      const w = (window as unknown as ExtendedWindow);
      const api = w.electronAPI;

      if (!api?.terminal || !api?.main) {
        throw new Error('electronAPI terminal/main not available');
      }

      // Use the orchestrated flow that goes through launchTerminalOntoUI
      // This creates context node + floating window + sets hasRunningTerminal
      return new Promise<{ terminalId: string; success: boolean }>((resolve) => {
        let capturedTerminalId: string | null = null;

        const timeout = setTimeout(() => {
          resolve({ terminalId: capturedTerminalId ?? '', success: capturedTerminalId !== null });
        }, 15000);

        api.terminal.onData((id, data) => {
          if (!capturedTerminalId) {
            capturedTerminalId = id;
            console.log(`[Test] Terminal ID captured: ${id}`);
          }
          // Wait until we see our test output to ensure UI has updated
          if (data.includes('TASK_NODE_SHAPE_TEST')) {
            clearTimeout(timeout);
            // Give UI time to process the hasRunningTerminal update
            setTimeout(() => {
              resolve({ terminalId: capturedTerminalId ?? '', success: true });
            }, 500);
          }
        });

        // Use spawnTerminalWithContextNode - this orchestrates the full flow:
        // main: createContextNode → prepareTerminalData → uiAPI.launchTerminalOntoUI()
        // ui: launchTerminalOntoUI → createFloatingTerminal → sets hasRunningTerminal
        void api.main.spawnTerminalWithContextNode(nodeId, cmd, 0);
      });
    }, { nodeId: targetNodeId, cmd: command });

    const { terminalId, success } = await terminalSpawnPromise;
    expect(success).toBe(true);
    console.log(`✓ Terminal spawned: ${terminalId}`);

    // Wait a moment for the shape change to propagate
    await appWindow.waitForTimeout(500);

    console.log('=== STEP 5: Verify node shape changed to rectangle ===');
    const afterShape = await appWindow.evaluate((nodeId) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById(nodeId);
      return {
        hasRunningTerminal: node.data('hasRunningTerminal'),
        computedShape: node.style('shape') as string
      };
    }, targetNodeId);

    console.log(`After terminal spawn:`, afterShape);
    expect(afterShape.hasRunningTerminal).toBe(true);
    expect(afterShape.computedShape).toBe('rectangle');
    console.log('✓ Node shape changed to rectangle (task node indicator)');

    // Take screenshot after spawning terminal
    await appWindow.screenshot({ path: 'e2e-tests/screenshots/task-node-shape-after.png' });
    console.log('✓ Screenshot saved: task-node-shape-after.png');

    console.log('');
    console.log('=== TEST SUMMARY ===');
    console.log('✓ Graph auto-loaded');
    console.log('✓ Non-context node selected');
    console.log('✓ Initial shape verified as ellipse');
    console.log('✓ Terminal spawned on node');
    console.log('✓ Node shape changed to rectangle (task node)');
    console.log('✓ Screenshots captured');
    console.log('');
    console.log('✅ TASK NODE SHAPE CHANGE TEST PASSED');
  });
});

export { test };
