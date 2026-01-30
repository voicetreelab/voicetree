/**
 * BEHAVIORAL SPEC:
 * E2E test for AgentTabsBar pin/unpin functionality via traffic light button
 *
 * This test verifies:
 * 1. Load example graph
 * 2. Spawn a terminal from a selected node
 * 3. Verify terminal tab appears in pinned section
 * 4. Click traffic light pin button on terminal to unpin (should move to unpinned section)
 * 5. Screenshot the unpinned state
 * 6. Click traffic light pin button again to re-pin (should move back to pinned section)
 * 7. Screenshot the re-pinned state
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
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-agent-tabs-pin-unpin-'));

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

test.describe('AgentTabsBar Pin/Unpin via Traffic Light Button', () => {
  test('should unpin and re-pin via traffic light pin button on terminal window', async ({ appWindow }) => {
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

    console.log('=== STEP 3: Spawn terminal via spawnPlainTerminal API ===');
    // Use spawnPlainTerminal to avoid the agent command dialog
    await appWindow.evaluate(async (nodeId) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      await api.main.spawnPlainTerminal(nodeId, 0);
    }, targetNodeId);
    await appWindow.waitForTimeout(2000);

    // Wait for terminal to actually appear
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        return document.querySelectorAll('.cy-floating-window-terminal').length;
      });
    }, {
      message: 'Waiting for terminal window to appear',
      timeout: 10000,
      intervals: [500, 1000, 2000]
    }).toBeGreaterThan(0);

    console.log('=== STEP 4: Verify terminal tab is in pinned section ===');
    await appWindow.waitForSelector('[data-testid="agent-tabs-bar"]');

    const initialState = await appWindow.evaluate(() => {
      const pinnedTabs = document.querySelectorAll('.agent-tabs-pinned .agent-tab');
      const unpinnedTabs = document.querySelectorAll('.agent-tabs-unpinned .agent-tab-unpinned');
      const pinnedCount = pinnedTabs.length;
      const unpinnedCount = unpinnedTabs.length;

      // Get the terminal ID of the first pinned tab for later verification
      const firstPinnedTab = pinnedTabs[0];
      const terminalId = firstPinnedTab?.getAttribute('data-terminal-id') ?? null;

      return { pinnedCount, unpinnedCount, terminalId };
    });

    console.log(`Initial state - Pinned: ${initialState.pinnedCount}, Unpinned: ${initialState.unpinnedCount}`);
    console.log(`Target terminal ID: ${initialState.terminalId}`);

    expect(initialState.pinnedCount).toBeGreaterThan(0);
    expect(initialState.terminalId).not.toBeNull();

    await appWindow.screenshot({
      path: 'e2e-tests/screenshots/agent-tabs-pin-unpin-1-initial-pinned.png'
    });
    console.log('Screenshot saved: agent-tabs-pin-unpin-1-initial-pinned.png');

    console.log('=== STEP 5: Click traffic light pin button on terminal to unpin ===');
    // Find and click the traffic light pin button on the terminal window
    const terminalWindowSelector = '.cy-floating-window-terminal';
    const trafficLightPinSelector = `${terminalWindowSelector} .traffic-light-pin`;
    await appWindow.waitForSelector(trafficLightPinSelector);
    await appWindow.click(trafficLightPinSelector);
    await appWindow.waitForTimeout(500);

    console.log('=== STEP 6: Verify tab moved to unpinned section ===');
    // Poll until the tab moves to unpinned section
    await expect.poll(async () => {
      return appWindow.evaluate((terminalId) => {
        const isInUnpinned = !!document.querySelector(
          `.agent-tabs-unpinned .agent-tab-unpinned[data-terminal-id="${terminalId}"]`
        );
        const isInPinned = !!document.querySelector(
          `.agent-tabs-pinned .agent-tab[data-terminal-id="${terminalId}"]`
        );
        return { isInUnpinned, isInPinned };
      }, initialState.terminalId);
    }, {
      message: 'Waiting for tab to move to unpinned section after pin button click',
      timeout: 5000,
      intervals: [200, 500, 1000]
    }).toMatchObject({
      isInUnpinned: true,
      isInPinned: false
    });

    // Get the final state for logging
    const afterUnpinState = await appWindow.evaluate((terminalId) => {
      const pinnedTabs = document.querySelectorAll('.agent-tabs-pinned .agent-tab');
      const unpinnedTabs = document.querySelectorAll('.agent-tabs-unpinned .agent-tab-unpinned');
      const isInUnpinned = !!document.querySelector(
        `.agent-tabs-unpinned .agent-tab-unpinned[data-terminal-id="${terminalId}"]`
      );
      const isInPinned = !!document.querySelector(
        `.agent-tabs-pinned .agent-tab[data-terminal-id="${terminalId}"]`
      );
      return {
        pinnedCount: pinnedTabs.length,
        unpinnedCount: unpinnedTabs.length,
        isInUnpinned,
        isInPinned
      };
    }, initialState.terminalId);

    console.log(`After unpin - Pinned: ${afterUnpinState.pinnedCount}, Unpinned: ${afterUnpinState.unpinnedCount}`);
    console.log(`Tab in unpinned: ${afterUnpinState.isInUnpinned}, Tab in pinned: ${afterUnpinState.isInPinned}`);

    await appWindow.screenshot({
      path: 'e2e-tests/screenshots/agent-tabs-pin-unpin-2-after-unpin.png'
    });
    console.log('Screenshot saved: agent-tabs-pin-unpin-2-after-unpin.png');

    // Verify counts changed correctly
    expect(afterUnpinState.pinnedCount).toBe(initialState.pinnedCount - 1);
    expect(afterUnpinState.unpinnedCount).toBe(initialState.unpinnedCount + 1);

    console.log('=== STEP 7: Click traffic light pin button again to re-pin ===');
    // Click the traffic light pin button again to re-pin the terminal
    await appWindow.waitForSelector(trafficLightPinSelector);
    await appWindow.click(trafficLightPinSelector);
    await appWindow.waitForTimeout(500);

    console.log('=== STEP 8: Verify tab moved back to pinned section ===');
    // Poll until the tab moves back to pinned section
    await expect.poll(async () => {
      return appWindow.evaluate((terminalId) => {
        const isInPinned = !!document.querySelector(
          `.agent-tabs-pinned .agent-tab[data-terminal-id="${terminalId}"]`
        );
        const isInUnpinned = !!document.querySelector(
          `.agent-tabs-unpinned .agent-tab-unpinned[data-terminal-id="${terminalId}"]`
        );
        return { isInPinned, isInUnpinned };
      }, initialState.terminalId);
    }, {
      message: 'Waiting for tab to move back to pinned section after pin button click',
      timeout: 5000,
      intervals: [200, 500, 1000]
    }).toMatchObject({
      isInPinned: true,
      isInUnpinned: false
    });

    // Get the final state for logging
    const afterRepinState = await appWindow.evaluate((terminalId) => {
      const pinnedTabs = document.querySelectorAll('.agent-tabs-pinned .agent-tab');
      const unpinnedTabs = document.querySelectorAll('.agent-tabs-unpinned .agent-tab-unpinned');
      const isInPinned = !!document.querySelector(
        `.agent-tabs-pinned .agent-tab[data-terminal-id="${terminalId}"]`
      );
      const isInUnpinned = !!document.querySelector(
        `.agent-tabs-unpinned .agent-tab-unpinned[data-terminal-id="${terminalId}"]`
      );
      return {
        pinnedCount: pinnedTabs.length,
        unpinnedCount: unpinnedTabs.length,
        isInPinned,
        isInUnpinned
      };
    }, initialState.terminalId);

    console.log(`After re-pin - Pinned: ${afterRepinState.pinnedCount}, Unpinned: ${afterRepinState.unpinnedCount}`);
    console.log(`Tab in pinned: ${afterRepinState.isInPinned}, Tab in unpinned: ${afterRepinState.isInUnpinned}`);

    await appWindow.screenshot({
      path: 'e2e-tests/screenshots/agent-tabs-pin-unpin-3-after-repin.png'
    });
    console.log('Screenshot saved: agent-tabs-pin-unpin-3-after-repin.png');

    // Verify counts returned to original
    expect(afterRepinState.pinnedCount).toBe(initialState.pinnedCount);
    expect(afterRepinState.unpinnedCount).toBe(initialState.unpinnedCount);

    console.log('=== TEST COMPLETE: Pin/Unpin via traffic light button verified ===');
  });
});
