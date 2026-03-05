/**
 * REGRESSION TEST: Web Share Module Safety
 *
 * Purpose: Verify that the Electron app still works correctly after web share
 * modules (pure/web-share/, shell/web/) were added to the codebase.
 * This test does NOT test web share functionality — it confirms that existing
 * Electron functionality is not broken by the new code.
 *
 * Asserts:
 * 1. App starts without crash (no import errors from new modules)
 * 2. Graph loads with nodes (pure/graph/ still works)
 * 3. electronAPI is available (IPC bridge intact)
 * 4. No console errors mentioning web-share or shell/web
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page, ConsoleMessage } from '@playwright/test';
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

interface CollectedError {
  source: 'console' | 'pageerror';
  text: string;
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  collectedErrors: CollectedError[];
}>({
  collectedErrors: async ({}, use) => {
    const errors: CollectedError[] = [];
    await use(errors);
  },

  electronApp: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-web-share-regression-'));

    const projectsPath = path.join(tempUserDataPath, 'projects.json');
    const savedProject = {
      id: 'web-share-regression-project-id',
      path: FIXTURE_VAULT_PATH,
      name: 'example_small',
      type: 'folder',
      lastOpened: Date.now(),
      voicetreeInitialized: true
    };
    await fs.writeFile(projectsPath, JSON.stringify([savedProject], null, 2), 'utf8');

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
      console.log('Note: Could not stop file watching during cleanup (window may be closed)');
    }

    await electronApp.close();
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp, collectedErrors }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15000 });

    // Collect console errors, especially any mentioning web-share or shell/web
    window.on('console', (msg: ConsoleMessage) => {
      const text = msg.text();
      console.log(`BROWSER [${msg.type()}]:`, text);
      if (msg.type() === 'error') {
        collectedErrors.push({ source: 'console', text });
      }
    });

    window.on('pageerror', (error: Error) => {
      console.error('PAGE ERROR:', error.message);
      collectedErrors.push({ source: 'pageerror', text: error.message });
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('text=Voicetree', { timeout: 10000 });
    await window.waitForSelector('text=Recent Projects', { timeout: 10000 });

    const projectButton = window.locator('button:has-text("example_small")').first();
    await projectButton.click();

    await window.waitForFunction(
      () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
      { timeout: 15000 }
    );

    // Allow time for any deferred imports or side effects to surface
    await window.waitForTimeout(2000);

    await use(window);
  }
});

test.describe('Web Share Regression', () => {
  test('Electron app starts and loads graph without web-share side effects', async ({ appWindow, collectedErrors }) => {
    test.setTimeout(45000);

    // 1. App started without crash — if we got here, startup succeeded
    console.log('✓ App started without crash');

    // 2. electronAPI is available (IPC bridge intact)
    const hasElectronAPI = await appWindow.evaluate(() => {
      return !!(window as ExtendedWindow).electronAPI;
    });
    expect(hasElectronAPI).toBe(true);
    console.log('✓ electronAPI is available');

    // 3. Graph loads with nodes
    await appWindow.waitForFunction(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      return cy ? cy.nodes().length > 1 : false;
    }, { timeout: 8000 });

    const graph = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getGraph();
    });

    expect(graph).toBeDefined();
    const nodeCount = Object.keys(graph.nodes).length;
    expect(nodeCount).toBeGreaterThan(1);
    console.log(`✓ Graph loaded with ${nodeCount} nodes`);

    // 4. No console errors mentioning web-share or shell/web
    const webShareErrors = collectedErrors.filter(e =>
      /web-share|shell\/web|shell\\web/i.test(e.text)
    );

    if (webShareErrors.length > 0) {
      console.error('Web-share related errors found:');
      webShareErrors.forEach(e => console.error(`  [${e.source}] ${e.text}`));
    }

    expect(webShareErrors).toHaveLength(0);
    console.log('✓ No console errors mentioning web-share or shell/web');

    console.log('✅ Web share regression test passed — Electron app unaffected by new modules');
  });
});

export { test };
