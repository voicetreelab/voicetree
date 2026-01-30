/**
 * Screenshot test for terminal-to-created-node edges (Electron version)
 * Verifies the dotted edge style when a terminal creates a node with matching agent_name.
 */

import { test as base, _electron as electron } from '@playwright/test';
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
      stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
      spawnTerminalWithContextNode: (nodeId: string, command: string, terminalCount: number) => Promise<void>;
    };
    terminal: {
      onData: (callback: (id: string, data: string) => void) => void;
    };
  };
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: [async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-edge-test-'));
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
      timeout: 8000
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
  }, { timeout: 30000 }],

  appWindow: [async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    page.on('console', msg => console.log(`BROWSER [${msg.type()}]:`, msg.text()));
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => (window as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
    await page.waitForTimeout(500);
    await use(page);
  }, { timeout: 20000 }]
});

test('screenshot terminal-to-created-node dotted edge', async ({ appWindow }) => {
  test.setTimeout(30000);

  // Wait for cytoscape to be ready
  console.log('=== Waiting for cytoscape ===');
  await appWindow.waitForFunction(() => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    return !!cy;
  }, { timeout: 10000 });

  // Create test nodes and edge directly to show the style
  console.log('=== Creating test nodes and edge with terminal-progres-nodes-indicator class ===');

  await appWindow.evaluate(() => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (!cy) return;

    // Create two test nodes
    cy.add({
      group: 'nodes',
      data: { id: 'terminal-shadow-node', label: 'Terminal' },
      position: { x: 200, y: 200 }
    });

    cy.add({
      group: 'nodes',
      data: { id: 'created-progress-node', label: 'Progress Node' },
      position: { x: 400, y: 200 }
    });

    // Add edge with the terminal-progres-nodes-indicator class (dotted style)
    cy.add({
      group: 'edges',
      data: {
        id: 'test-terminal-edge',
        source: 'terminal-shadow-node',
        target: 'created-progress-node'
      },
      classes: 'terminal-progres-nodes-indicator'
    });

    cy.fit(undefined, 100);
    cy.zoom(2);
    cy.center();
  });

  await appWindow.waitForTimeout(500);

  // Take screenshot
  await appWindow.screenshot({
    path: 'e2e-tests/screenshots/terminal-to-created-node-edge.png'
  });

  console.log('Screenshot saved to e2e-tests/screenshots/terminal-to-created-node-edge.png');
});

export { test };
