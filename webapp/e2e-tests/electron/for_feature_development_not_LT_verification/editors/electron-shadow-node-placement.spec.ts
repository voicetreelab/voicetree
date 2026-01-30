/**
 * FEATURE TEST: Shadow Node Initial Placement
 *
 * Verifies that shadow nodes spawn at the correct position (matching cola's edge length)
 * by taking screenshots immediately after node creation and after layout settles.
 *
 * If the fix works correctly, both screenshots should look nearly identical.
 */

import { test as base, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';

const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_real_large');

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: {
    main: {
      stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
    };
  };
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: [async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-shadow-test-'));

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

    page.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => (window as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
    await page.waitForTimeout(500);

    await use(page);
  }, { timeout: 30000 }]
});

test.describe('Shadow Node Placement Screenshots', () => {
  test('screenshot before and after layout on Cmd+N node creation', async ({ appWindow }) => {
    test.setTimeout(60000);
    console.log('=== Testing shadow node placement with screenshots ===');

    // Wait for graph to load
    await appWindow.waitForFunction(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      return cy && cy.nodes().length > 0;
    }, { timeout: 15000 });
    console.log('Graph loaded');

    // Select a node first (Cmd+N creates child of selected node)
    await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Find a node to select
      const nodes = cy.nodes().filter(n => !n.data('isShadowNode'));
      if (nodes.length === 0) throw new Error('No nodes found');

      // Select the first non-shadow node
      nodes[0].select();
      console.log('Selected node:', nodes[0].id());
    });

    await appWindow.waitForTimeout(200);

    // Press Cmd+N to create new node
    const isMac = process.platform === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';

    console.log('Pressing Cmd+N to create new node...');
    await appWindow.keyboard.press(`${modifier}+n`);

    // Take screenshot IMMEDIATELY (before layout settles)
    // Use a very short delay just to let the DOM update
    await appWindow.waitForTimeout(50);

    const screenshotDir = path.join(PROJECT_ROOT, 'e2e-tests', 'screenshots');
    await fs.mkdir(screenshotDir, { recursive: true });

    await appWindow.screenshot({
      path: path.join(screenshotDir, 'shadow-node-placement-immediate.png'),
      fullPage: true
    });
    console.log('Screenshot taken: shadow-node-placement-immediate.png');

    // Wait for layout to settle (cola runs for up to 1750ms + debounce)
    await appWindow.waitForTimeout(2500);

    // Take screenshot AFTER layout
    await appWindow.screenshot({
      path: path.join(screenshotDir, 'shadow-node-placement-after-layout.png'),
      fullPage: true
    });
    console.log('Screenshot taken: shadow-node-placement-after-layout.png');

    console.log('=== Screenshots saved to e2e-tests/screenshots/ ===');
    console.log('Compare the two images - they should look nearly identical if the fix works.');
  });
});

export { test };
