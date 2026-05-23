/**
 * BEHAVIORAL SPEC:
 * E2E test for terminal x-overflow fix
 *
 * This test verifies:
 * 1. Terminal spawns correctly
 * 2. Long output lines don't cause horizontal scrollbar
 * 3. Terminal window housing has no x-overflow
 *
 * The fix adds overflow-x: hidden to .cy-floating-window-terminal
 * to prevent horizontal scrollbars at the window wrapper level.
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

// Use example_small for faster loading
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
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-x-overflow-test-'));

    // Write the config file to auto-load the test vault
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
        VOICETREE_PERSIST_STATE: '1'
        // No MINIMIZE_TEST so screenshots are useful
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

    // Cleanup temp directory
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

    // Wait for cytoscape instance
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

test.describe('Terminal No X-Overflow E2E', () => {
  test('terminal housing has no horizontal scrollbar', async ({ appWindow }) => {
    test.setTimeout(90000);

    console.log('=== STEP 1: Wait for auto-load to complete ===');
    // Wait for auto-load using waitForFunction (matches smoke test pattern)
    await appWindow.waitForFunction(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return false;
      return cy.nodes().length > 0;
    }, { timeout: 15000 });
    console.log('Graph auto-loaded with nodes');

    console.log('=== STEP 2: Get a node to create terminal from ===');
    const targetNodeId = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const nodes = cy.nodes();
      if (nodes.length === 0) throw new Error('No nodes available');
      return nodes[0].id();
    });

    console.log(`Target node: ${targetNodeId}`);

    console.log('=== STEP 3: Spawn plain terminal (no agent) ===');
    // Use spawnPlainTerminal to create terminal with floating window UI
    await appWindow.evaluate(async (nodeId) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      // terminalCount=0 for first terminal
      await api.main.spawnPlainTerminal(nodeId, 0);
    }, targetNodeId);

    // Wait for terminal to spawn and render
    await appWindow.waitForTimeout(2000);

    console.log('=== STEP 4: Verify terminal floating window exists ===');
    const terminalWindow = appWindow.locator('.cy-floating-window-terminal');
    await expect(terminalWindow).toBeVisible({ timeout: 5000 });
    console.log('Terminal floating window visible');

    console.log('=== STEP 5: Output long lines to potentially trigger x-overflow ===');
    // Click to focus terminal
    await terminalWindow.click();
    await appWindow.waitForTimeout(200);

    // Type a very long line that would exceed terminal width
    const longLine = 'A'.repeat(200);
    await appWindow.keyboard.type(`echo "${longLine}"`, { delay: 5 });
    await appWindow.keyboard.press('Enter');
    await appWindow.waitForTimeout(500);

    // Type another command with a long path
    await appWindow.keyboard.type('echo "This is a test of terminal overflow with a very long line that should wrap or be clipped without showing horizontal scrollbar"', { delay: 5 });
    await appWindow.keyboard.press('Enter');
    await appWindow.waitForTimeout(500);

    console.log('=== STEP 6: Verify no horizontal overflow on terminal window ===');
    const overflowState = await appWindow.evaluate(() => {
      const terminalEl = document.querySelector('.cy-floating-window-terminal') as HTMLElement;
      if (!terminalEl) throw new Error('Terminal element not found');

      const contentEl = terminalEl.querySelector('.cy-floating-window-content') as HTMLElement;
      if (!contentEl) throw new Error('Content element not found');

      // Get computed styles
      const terminalStyles = window.getComputedStyle(terminalEl);
      const contentStyles = window.getComputedStyle(contentEl);

      // Check for actual scrollbar by comparing scrollWidth to clientWidth
      const terminalHasXScroll = terminalEl.scrollWidth > terminalEl.clientWidth;
      const contentHasXScroll = contentEl.scrollWidth > contentEl.clientWidth;

      return {
        terminalOverflowX: terminalStyles.overflowX,
        contentOverflowX: contentStyles.overflowX,
        terminalScrollWidth: terminalEl.scrollWidth,
        terminalClientWidth: terminalEl.clientWidth,
        terminalHasXScroll,
        contentScrollWidth: contentEl.scrollWidth,
        contentClientWidth: contentEl.clientWidth,
        contentHasXScroll,
      };
    });

    console.log('Overflow state:');
    console.log(`  Terminal overflow-x: ${overflowState.terminalOverflowX}`);
    console.log(`  Content overflow-x: ${overflowState.contentOverflowX}`);
    console.log(`  Terminal scrollWidth: ${overflowState.terminalScrollWidth}, clientWidth: ${overflowState.terminalClientWidth}`);
    console.log(`  Terminal has x-scroll: ${overflowState.terminalHasXScroll}`);
    console.log(`  Content scrollWidth: ${overflowState.contentScrollWidth}, clientWidth: ${overflowState.contentClientWidth}`);
    console.log(`  Content has x-scroll: ${overflowState.contentHasXScroll}`);

    console.log('=== STEP 7: Take screenshot for visual verification ===');
    // Ensure screenshots directory exists
    await fs.mkdir('e2e-tests/screenshots', { recursive: true });

    await appWindow.screenshot({ path: 'e2e-tests/screenshots/terminal-no-x-overflow.png' });
    console.log('Screenshot saved: e2e-tests/screenshots/terminal-no-x-overflow.png');

    // Also take a screenshot focused on just the terminal
    const terminalBox = await terminalWindow.boundingBox();
    if (terminalBox) {
      await appWindow.screenshot({
        path: 'e2e-tests/screenshots/terminal-no-x-overflow-cropped.png',
        clip: {
          x: Math.max(0, terminalBox.x - 10),
          y: Math.max(0, terminalBox.y - 10),
          width: terminalBox.width + 20,
          height: terminalBox.height + 20
        }
      });
      console.log('Cropped screenshot saved: e2e-tests/screenshots/terminal-no-x-overflow-cropped.png');
    }

    console.log('=== STEP 8: Assert overflow-x is hidden ===');
    // The CSS fix should set overflow-x: hidden on .cy-floating-window-terminal
    expect(overflowState.terminalOverflowX).toBe('hidden');
    console.log('Terminal overflow-x is hidden');

    // Content should also have overflow-x: hidden
    expect(overflowState.contentOverflowX).toBe('hidden');
    console.log('Content overflow-x is hidden');

    // Neither should have actual scrollbar (scrollWidth should not exceed clientWidth when overflow is hidden)
    expect(overflowState.terminalHasXScroll).toBe(false);
    expect(overflowState.contentHasXScroll).toBe(false);
    console.log('No horizontal scrollbars detected');

    console.log('');
    console.log('TERMINAL NO X-OVERFLOW TEST PASSED');
    console.log('Review screenshots at: e2e-tests/screenshots/terminal-no-x-overflow*.png');
  });
});

export { test };
