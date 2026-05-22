/**
 * BEHAVIORAL SPEC:
 * 1. Spawn a terminal with a custom echo command.
 * 2. Verify the agent tab shows running status shortly after output.
 * 3. After 20s of inactivity, verify the done (green) dot is shown.
 * 4. Capture screenshots before and after the done indicator flips.
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
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_real_large', '2025-09-30');

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-terminal-done-indicator-test-'));
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
        HEADLESS_TEST: '1'
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

test.describe('Terminal Done Indicator E2E', () => {
  test('should show done after inactivity', async ({ appWindow }) => {
    test.setTimeout(120000);

    console.log('=== STEP 1: Wait for auto-load to complete ===');
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) return 0;
        return cy.nodes().length;
      });
    }, {
      message: 'Waiting for graph to auto-load nodes',
      timeout: 20000,
      intervals: [500, 1000, 1000, 2000]
    }).toBeGreaterThan(0);

    console.log('✓ Graph auto-loaded with nodes');

    console.log('=== STEP 2: Pick a node to spawn a terminal ===');
    const targetNodeId = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const nodes = cy.nodes();
      if (nodes.length === 0) throw new Error('No nodes available');
      return nodes[0].id();
    });

    console.log(`Target node: ${targetNodeId}`);

    console.log('=== STEP 3: Spawn terminal with echo command and wait for output ===');
    const command = 'echo VT_DONE_INDICATOR_TEST';
    const terminalOutputPromise = appWindow.evaluate(async ({ nodeId, command }) => {
      const w = (window as unknown as ExtendedWindow);
      const api = w.electronAPI;

      if (!api?.terminal || !api?.main) {
        throw new Error('electronAPI terminal/main not available');
      }

      return new Promise<{ terminalId: string; output: string }>((resolve) => {
        let output = '';
        let capturedTerminalId: string | null = null;

        const timeout = setTimeout(() => {
          resolve({ terminalId: capturedTerminalId ?? '', output });
        }, 15000);

        api.terminal.onData((id, data) => {
          if (!capturedTerminalId) {
            capturedTerminalId = id;
          }

          if (id === capturedTerminalId) {
            output += data;
            if (output.includes('VT_DONE_INDICATOR_TEST')) {
              clearTimeout(timeout);
              resolve({ terminalId: id, output });
            }
          }
        });

        void api.main.spawnTerminalWithContextNode(nodeId, command, 0);
      });
    }, { nodeId: targetNodeId, command });

    const { terminalId, output } = await terminalOutputPromise;
    console.log(`Terminal ID: ${terminalId}`);
    console.log(`Terminal output preview: ${output.substring(0, 200)}`);

    console.log('=== STEP 4: Verify running status dot is present ===');
    await appWindow.waitForSelector('.agent-tabs-bar');
    await expect.poll(async () => {
      return appWindow.evaluate(() => document.querySelectorAll('.agent-tab-status-running').length);
    }, {
      message: 'Waiting for running status dot',
      timeout: 10000
    }).toBeGreaterThan(0);

    await appWindow.screenshot({
      path: 'e2e-tests/test-results/terminal-done-indicator-running.png'
    });
    console.log('✓ Screenshot saved: terminal-done-indicator-running.png');

    console.log('=== STEP 5: Wait 20s for inactivity to mark done ===');
    await appWindow.waitForTimeout(20000);

    await expect.poll(async () => {
      return appWindow.evaluate(() => document.querySelectorAll('.agent-tab-status-done').length);
    }, {
      message: 'Waiting for done status dot',
      timeout: 15000
    }).toBeGreaterThan(0);

    await appWindow.screenshot({
      path: 'e2e-tests/test-results/terminal-done-indicator-done.png'
    });
    console.log('✓ Screenshot saved: terminal-done-indicator-done.png');

    console.log('✅ Terminal done indicator test passed');
  });
});

export { test };
