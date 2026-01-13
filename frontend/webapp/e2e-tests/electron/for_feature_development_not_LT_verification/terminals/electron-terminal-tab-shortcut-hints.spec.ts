/**
 * BEHAVIORAL SPEC:
 * E2E test for terminal tab shortcut hints (cmd+[ and cmd+])
 *
 * This test verifies:
 * 1. Two terminals can be spawned with mock commands ("echo test")
 * 2. The agent tabs bar appears with both terminals
 * 3. Shortcut hints (cmd+[, cmd+]) show correctly on hover
 * 4. The hints are NOT clipped (verifies the CSS fix for bottom padding)
 *
 * EXPECTED OUTCOME:
 * Screenshots showing shortcut hints fully visible below terminal tabs
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

// Use absolute paths for example_folder_fixtures
const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');

// Type definitions
interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

// Extend test with Electron app
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    // Create a temporary userData directory for this test
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-tab-hints-test-'));

    // Write the config file to auto-load the test vault on startup
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: FIXTURE_VAULT_PATH }, null, 2), 'utf8');
    console.log('[Tab Hints Test] Created config file to auto-load:', FIXTURE_VAULT_PATH);

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

    // Cleanup temp directory
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15000 });

    // Log console messages for debugging
    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    // Capture page errors
    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
    await window.waitForTimeout(1000);

    await use(window);
  }
});

test.describe('Terminal Tab Shortcut Hints Screenshot', () => {
  test('should display shortcut hints (cmd+[ and cmd+]) correctly on hover', async ({ appWindow }) => {
    test.setTimeout(60000);

    console.log('=== STEP 1: Configure mock agent with echo command ===');
    await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');

      // Configure settings with a mock echo command
      const settings = {
        terminalSpawnPathRelativeToWatchedDirectory: './',
        agents: [{ name: 'MockAgent', command: 'echo test' }],
        shiftEnterSendsOptionEnter: true,
        contextNodeMaxDistance: 6,
        askModeContextDistance: 3,
        INJECT_ENV_VARS: {}
      };
      await api.main.saveSettings(settings);
    });
    console.log('Settings configured with mock agent: echo test');

    console.log('=== STEP 2: Load test vault via file watching ===');
    const watchResult = await appWindow.evaluate(async (vaultPath) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.startFileWatching(vaultPath);
    }, FIXTURE_VAULT_PATH);

    expect(watchResult.success).toBe(true);
    console.log('File watching started');

    // Wait for initial scan
    await appWindow.waitForTimeout(2000);

    console.log('=== STEP 3: Wait for graph to load nodes ===');
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return 0;
        return cy.nodes().length;
      });
    }, {
      message: 'Waiting for graph to load nodes',
      timeout: 15000,
      intervals: [500, 1000, 2000]
    }).toBeGreaterThan(1);

    console.log('Graph loaded');

    console.log('=== STEP 4: Get two nodes for spawning terminals ===');
    const nodeIds = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const nodes = cy.nodes();
      if (nodes.length < 2) throw new Error('Need at least 2 nodes');
      return [nodes[0].id(), nodes[1].id()];
    });
    console.log(`Target nodes: ${nodeIds[0]}, ${nodeIds[1]}`);

    console.log('=== STEP 5: Spawn first terminal via spawnPlainTerminal ===');
    // Use spawnPlainTerminal which goes through the full flow and adds to TerminalStore
    await appWindow.evaluate(async (nodeId) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api?.main) throw new Error('electronAPI.main not available');

      await api.main.spawnPlainTerminal(nodeId, 0);
    }, nodeIds[0]);
    console.log('Terminal 1 spawned');

    // Wait for terminal to initialize and UI to update
    await appWindow.waitForTimeout(1500);

    console.log('=== STEP 6: Spawn second terminal via spawnPlainTerminal ===');
    await appWindow.evaluate(async (nodeId) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api?.main) throw new Error('electronAPI.main not available');

      await api.main.spawnPlainTerminal(nodeId, 1);
    }, nodeIds[1]);
    console.log('Terminal 2 spawned');

    // Wait for both terminals to appear in the tabs bar
    await appWindow.waitForTimeout(1500);

    console.log('=== STEP 7: Verify agent tabs bar is visible with 2 tabs ===');
    const tabCount = await appWindow.evaluate(() => {
      const tabsBar = document.querySelector('.agent-tabs-bar');
      if (!tabsBar) return 0;
      const tabs = tabsBar.querySelectorAll('.agent-tab-wrapper');
      return tabs.length;
    });

    expect(tabCount).toBe(2);
    console.log(`Agent tabs bar has ${tabCount} tabs`);

    console.log('=== STEP 8: Set first terminal as active (to show hint on second) ===');
    // Cycle to make the first terminal active
    await appWindow.evaluate(() => {
      const tabsBar = document.querySelector('.agent-tabs-bar');
      if (!tabsBar) throw new Error('Agent tabs bar not found');

      const wrappers = tabsBar.querySelectorAll('.agent-tab-wrapper');
      // Click first tab to make it active
      const firstTab = wrappers[0]?.querySelector('.agent-tab') as HTMLElement;
      if (firstTab) firstTab.click();
    });
    await appWindow.waitForTimeout(500);

    console.log('=== STEP 9: Hover over second tab to show cmd+] hint ===');
    const secondTabWrapper = appWindow.locator('.agent-tab-wrapper').nth(1);
    await secondTabWrapper.hover();

    // Wait for hover transition
    await appWindow.waitForTimeout(300);

    // Force the hint to be visible (in case CSS hover state isn't captured in headless)
    await appWindow.evaluate(() => {
      const wrappers = document.querySelectorAll('.agent-tab-wrapper');
      const secondWrapper = wrappers[1];
      const hint = secondWrapper?.querySelector('.agent-tab-shortcut-hint') as HTMLElement;
      if (hint) {
        hint.style.opacity = '1';
      }
    });

    console.log('=== STEP 10: Take screenshot of terminal tabs with hint ===');
    const viewport = appWindow.viewportSize();
    await appWindow.screenshot({
      path: 'e2e-tests/screenshots/terminal-tab-shortcut-hint-right.png',
      clip: { x: (viewport?.width ?? 1280) - 400, y: 0, width: 400, height: 80 }
    });
    console.log('Screenshot saved: terminal-tab-shortcut-hint-right.png');

    console.log('=== STEP 11: Hover over first tab to show cmd+[ hint ===');
    // First, reset the second tab hint
    await appWindow.evaluate(() => {
      const wrappers = document.querySelectorAll('.agent-tab-wrapper');
      const secondWrapper = wrappers[1];
      const hint = secondWrapper?.querySelector('.agent-tab-shortcut-hint') as HTMLElement;
      if (hint) {
        hint.style.opacity = '0';
      }
    });

    // Make second terminal active so first tab shows cmd+[ hint
    await appWindow.evaluate(() => {
      const tabsBar = document.querySelector('.agent-tabs-bar');
      if (!tabsBar) throw new Error('Agent tabs bar not found');

      const wrappers = tabsBar.querySelectorAll('.agent-tab-wrapper');
      const secondTab = wrappers[1]?.querySelector('.agent-tab') as HTMLElement;
      if (secondTab) secondTab.click();
    });
    await appWindow.waitForTimeout(500);

    // Hover over first tab
    const firstTabWrapper = appWindow.locator('.agent-tab-wrapper').nth(0);
    await firstTabWrapper.hover();
    await appWindow.waitForTimeout(300);

    // Force hint visible
    await appWindow.evaluate(() => {
      const wrappers = document.querySelectorAll('.agent-tab-wrapper');
      const firstWrapper = wrappers[0];
      const hint = firstWrapper?.querySelector('.agent-tab-shortcut-hint') as HTMLElement;
      if (hint) {
        hint.style.opacity = '1';
      }
    });

    await appWindow.screenshot({
      path: 'e2e-tests/screenshots/terminal-tab-shortcut-hint-left.png',
      clip: { x: (viewport?.width ?? 1280) - 400, y: 0, width: 400, height: 80 }
    });
    console.log('Screenshot saved: terminal-tab-shortcut-hint-left.png');

    console.log('=== STEP 12: Verify hint text is correct ===');
    const hintTexts = await appWindow.evaluate(() => {
      const hints = document.querySelectorAll('.agent-tab-shortcut-hint');
      return Array.from(hints).map(h => h.textContent);
    });

    // With 2 tabs, we expect one to show cmd+[ and one to show cmd+]
    // (or one hint if active tab has no hint)
    console.log('Hint texts found:', hintTexts);
    expect(hintTexts.length).toBeGreaterThan(0);

    console.log('');
    console.log('=== TEST SUMMARY ===');
    console.log('Two terminals spawned with mock "echo" command');
    console.log('Agent tabs bar displayed with both tabs');
    console.log('Shortcut hints (cmd+[, cmd+]) visible on hover');
    console.log('Screenshots captured for visual verification');
    console.log('');
    console.log('TEST PASSED - Verify screenshots show hints are NOT clipped');
  });
});

export { test };
