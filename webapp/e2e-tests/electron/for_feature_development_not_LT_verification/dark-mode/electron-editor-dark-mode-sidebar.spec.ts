/**
 * BEHAVIORAL SPEC: Editor Sidebar Dark Mode
 * Verifies the horizontal menu pill and line number gutter have proper dark mode styling
 *
 * Test flow:
 * 1. Start in light mode
 * 2. Open a floating editor by clicking a node
 * 3. Take screenshot showing light mode editor
 * 4. Toggle to dark mode
 * 5. Take screenshot showing dark mode editor
 * 6. Verify horizontal-menu-pill AND cm-gutters backgrounds are dark (not white)
 * 7. Toggle back to light mode
 * 8. Take screenshot showing light mode restored
 * 9. Verify gutter background is light again
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';

const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: {
    main: {
      startFileWatching: (dir: string) => Promise<{ success: boolean; directory?: string; error?: string }>;
      stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
    };
  };
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: [async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-dark-mode-test-'));
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: FIXTURE_VAULT_PATH }, null, 2), 'utf8');

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
      }
    });

    await use(electronApp);

    try {
      const page = await electronApp.firstWindow();
      await page.evaluate(async () => {
        const api = (window as ExtendedWindow).electronAPI;
        if (api) {
          await api.main.stopFileWatching();
        }
      });
      await page.waitForTimeout(300);
    } catch {
      console.log('Note: Could not stop file watching during cleanup');
    }

    await electronApp.close();
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  }, { timeout: 45000 }],

  appWindow: [async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();

    // Wait for Cytoscape to be ready
    await page.waitForFunction(
      () => (window as ExtendedWindow).cytoscapeInstance !== undefined,
      { timeout: 15000 }
    );

    // Wait for graph to load
    await page.waitForTimeout(1000);

    await use(page);
  }, { timeout: 20000 }]
});

test.describe('Editor Dark Mode Styling', () => {
  test('should display editor sidebar and gutter with proper dark mode styling', async ({ appWindow }) => {
    // Verify we're in light mode initially
    const isInitiallyLight = await appWindow.evaluate(() => {
      return !document.documentElement.classList.contains('dark');
    });
    expect(isInitiallyLight).toBe(true);

    // Click on a node to open an editor
    await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (cy) {
        const nodes = cy.nodes('[id$=".md"]');
        if (nodes.length > 0) {
          const firstNode = nodes[0];
          firstNode.emit('tap');
        }
      }
    });

    // Wait for editor to open
    await appWindow.waitForTimeout(800);

    // Check for floating window with horizontal menu and gutter
    const hasEditor = await appWindow.evaluate(() => {
      return document.querySelector('.cm-editor') !== null;
    });
    expect(hasEditor).toBe(true);

    // Take screenshot in light mode
    await appWindow.screenshot({
      path: 'e2e-tests/screenshots/editor-sidebar-light-mode.png'
    });

    // Toggle dark mode via SpeedDial button or fallback
    const darkModeButton = appWindow.locator('.speed-dial-container button[data-item-relativeFilePathIsID="dark-mode"]');
    if (await darkModeButton.isVisible()) {
      await darkModeButton.click();
    } else {
      await appWindow.evaluate(() => {
        document.documentElement.classList.add('dark');
      });
    }

    await appWindow.waitForTimeout(300);

    // Verify dark mode is active
    const isDarkMode = await appWindow.evaluate(() => {
      return document.documentElement.classList.contains('dark');
    });
    expect(isDarkMode).toBe(true);

    // Take screenshot in dark mode
    await appWindow.screenshot({
      path: 'e2e-tests/screenshots/editor-sidebar-dark-mode.png'
    });

    // Verify horizontal menu pill background is dark
    const pillBackground = await appWindow.evaluate(() => {
      const pill = document.querySelector('.horizontal-menu-pill');
      if (!pill) return null;
      return getComputedStyle(pill).backgroundColor;
    });

    if (pillBackground) {
      console.log(`[Test] Horizontal menu pill background: ${pillBackground}`);
      const rgbMatch = pillBackground.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (rgbMatch) {
        const avg = (parseInt(rgbMatch[1], 10) + parseInt(rgbMatch[2], 10) + parseInt(rgbMatch[3], 10)) / 3;
        expect(avg).toBeLessThan(150);
      }
    }

    // Verify gutter (line numbers) background is dark
    const gutterBackgroundDark = await appWindow.evaluate(() => {
      const gutter = document.querySelector('.cm-gutters');
      if (!gutter) return null;
      return getComputedStyle(gutter).backgroundColor;
    });

    if (gutterBackgroundDark) {
      console.log(`[Test] Line number gutter background (dark): ${gutterBackgroundDark}`);
      const rgbMatch = gutterBackgroundDark.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (rgbMatch) {
        const avg = (parseInt(rgbMatch[1], 10) + parseInt(rgbMatch[2], 10) + parseInt(rgbMatch[3], 10)) / 3;
        // Gutter should be dark in dark mode (avg < 150, where 255 is white)
        expect(avg).toBeLessThan(150);
      }
    }

    // Toggle back to light mode
    if (await darkModeButton.isVisible()) {
      await darkModeButton.click();
    } else {
      await appWindow.evaluate(() => {
        document.documentElement.classList.remove('dark');
      });
    }

    await appWindow.waitForTimeout(300);

    // Verify light mode is restored
    const isLightModeRestored = await appWindow.evaluate(() => {
      return !document.documentElement.classList.contains('dark');
    });
    expect(isLightModeRestored).toBe(true);

    // Take screenshot after toggling back to light mode
    await appWindow.screenshot({
      path: 'e2e-tests/screenshots/editor-sidebar-light-mode-restored.png'
    });

    // Verify gutter background is light again
    const gutterBackgroundLight = await appWindow.evaluate(() => {
      const gutter = document.querySelector('.cm-gutters');
      if (!gutter) return null;
      return getComputedStyle(gutter).backgroundColor;
    });

    if (gutterBackgroundLight) {
      console.log(`[Test] Line number gutter background (light restored): ${gutterBackgroundLight}`);
      const rgbMatch = gutterBackgroundLight.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (rgbMatch) {
        const avg = (parseInt(rgbMatch[1], 10) + parseInt(rgbMatch[2], 10) + parseInt(rgbMatch[3], 10)) / 3;
        // Gutter should be light in light mode (avg > 200, where 255 is white)
        expect(avg).toBeGreaterThan(200);
      }
    }
  });
});
