/**
 * BEHAVIORAL SPEC:
 * E2E test for terminal traffic light controls and AgentTabsBar unpin
 *
 * This test verifies:
 * 1. Load example graph
 * 2. Spawn a terminal from a selected node
 * 3. Verify terminal traffic lights exist and take screenshot
 * 4. Click traffic light pin button to unpin terminal
 * 5. Verify AgentTabsBar moves terminal from pinned to unpinned and take screenshot
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
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-terminal-traffic-lights-'));

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

test.describe('Terminal Traffic Lights E2E', () => {
  test('should unpin terminal via traffic light pin button and update AgentTabsBar', async ({ appWindow }) => {
    test.setTimeout(90000);

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

    console.log('=== STEP 2: Select a node to spawn terminal ===');
    const targetNodeId = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.nodes()[0];
      if (!node) throw new Error('No nodes found');
      return node.id();
    });

    const nodeSelected = await appWindow.evaluate((nodeId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById(nodeId);
      if (node.length === 0) throw new Error('Node not found');
      cy.nodes().unselect();
      node.select();
      return node.selected();
    }, targetNodeId);

    expect(nodeSelected).toBe(true);

    console.log('=== STEP 3: Spawn terminal via Cmd+Enter ===');
    await appWindow.keyboard.press('Meta+Enter');
    await appWindow.waitForTimeout(3000);

    console.log('=== STEP 4: Verify terminal traffic lights are present ===');
    await appWindow.waitForSelector('.cy-floating-window-terminal .terminal-traffic-lights');

    const terminalCount = await appWindow.evaluate(() => {
      return document.querySelectorAll('.cy-floating-window-terminal').length;
    });
    expect(terminalCount).toBeGreaterThan(0);

    await appWindow.screenshot({
      path: 'e2e-tests/test-results/terminal-traffic-lights-1-initial.png'
    });
    console.log('Screenshot saved: terminal-traffic-lights-1-initial.png');

    console.log('=== STEP 5: Confirm terminal is in pinned AgentTabsBar section ===');
    await appWindow.waitForSelector('[data-testid="agent-tabs-bar"]');

    const initialTabCounts: { pinned: number; unpinned: number } = await appWindow.evaluate(() => {
      const pinned = document.querySelectorAll('.agent-tabs-pinned .agent-tab').length;
      const unpinned = document.querySelectorAll('.agent-tabs-unpinned .agent-tab-unpinned').length;
      return { pinned, unpinned };
    });
    expect(initialTabCounts.pinned).toBeGreaterThan(0);

    console.log('=== STEP 6: Click terminal traffic light pin button (unpin) ===');
    await appWindow.click('.cy-floating-window-terminal .terminal-traffic-lights .traffic-light-pin');
    await appWindow.waitForTimeout(500);

    console.log('=== STEP 7: Verify AgentTabsBar moved terminal to unpinned section ===');
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const pinned = document.querySelectorAll('.agent-tabs-pinned .agent-tab').length;
        const unpinned = document.querySelectorAll('.agent-tabs-unpinned .agent-tab-unpinned').length;
        return { pinned, unpinned };
      });
    }, {
      message: 'Waiting for terminal tab to move to unpinned section',
      timeout: 5000,
      intervals: [200, 500, 1000]
    }).toEqual({ pinned: initialTabCounts.pinned - 1, unpinned: initialTabCounts.unpinned + 1 });

    await appWindow.screenshot({
      path: 'e2e-tests/test-results/terminal-traffic-lights-2-unpinned.png'
    });
    console.log('Screenshot saved: terminal-traffic-lights-2-unpinned.png');
  });
});
