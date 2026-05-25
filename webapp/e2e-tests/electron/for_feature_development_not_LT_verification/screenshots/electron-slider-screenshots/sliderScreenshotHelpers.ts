import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type { Core as CytoscapeCore } from 'cytoscape';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { ElectronAPI } from '@/shell/electron';
import type { AgentConfig } from '@/pure/settings';

const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');
const SCREENSHOTS_DIR = path.join(PROJECT_ROOT, 'e2e-tests', 'screenshots');

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-slider-screenshot-'));

    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({
      lastDirectory: FIXTURE_VAULT_PATH,
      suffixes: {
        [FIXTURE_VAULT_PATH]: ''
      }
    }, null, 2), 'utf8');

    const settingsPath = path.join(tempUserDataPath, 'voicetree-settings.json');
    const testAgents: AgentConfig[] = [
      { name: 'Default Agent', command: 'claude-code' },
      { name: 'Test Agent', command: 'test-agent-cmd' },
      { name: 'Another Agent', command: 'another-agent' }
    ];
    await fs.writeFile(settingsPath, JSON.stringify({
      contextNodeMaxDistance: 5,
      agents: testAgents
    }, null, 2), 'utf8');
    console.log('[Test] Created config with 3 agents for dropdown testing');

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

    await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });

    await window.waitForTimeout(1000);
    await use(window);
  }
});

async function waitForGraphLoaded(appWindow: Page): Promise<void> {
  await expect.poll(async () => {
    return appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return 0;
      return cy.nodes().length;
    });
  }, {
    message: 'Waiting for graph to load nodes',
    timeout: 15000,
    intervals: [500, 1000, 1000]
  }).toBeGreaterThan(0);
}

async function getNonContextNodeId(appWindow: Page): Promise<string> {
  return appWindow.evaluate(() => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not available');

    const node = cy.nodes().filter((n) => {
      const id = n.id();
      const isContextNode = n.data('isContextNode') === true;
      const hasFileExtension = /\.\w+$/.test(id);
      return !isContextNode && hasFileExtension;
    }).first();

    if (!node || node.length === 0) {
      throw new Error('No non-context node found');
    }
    return node.id();
  });
}

async function hoverOverNode(appWindow: Page, nodeId: string): Promise<void> {
  await appWindow.evaluate((id) => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not available');
    const node = cy.getElementById(id);
    node.emit('mouseover');
  }, nodeId);
}

async function tapOnNode(appWindow: Page, nodeId: string): Promise<void> {
  await appWindow.evaluate((id) => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not available');
    const node = cy.$(`#${CSS.escape(id)}`);
    node.emit('tap');
  }, nodeId);
}

function getSlider(appWindow: Page) {
  return appWindow.locator('.cy-floating-overlay .distance-slider').first();
}

function getHorizontalMenu(appWindow: Page) {
  return appWindow.locator('.cy-horizontal-context-menu');
}

function screenshotPath(filename: string): string {
  return path.join(SCREENSHOTS_DIR, filename);
}

export {
  expect,
  getHorizontalMenu,
  getNonContextNodeId,
  getSlider,
  hoverOverNode,
  screenshotPath,
  tapOnNode,
  test,
  waitForGraphLoaded
};
