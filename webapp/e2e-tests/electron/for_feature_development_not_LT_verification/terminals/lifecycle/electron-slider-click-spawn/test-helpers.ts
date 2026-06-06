import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type { Core as CytoscapeCore } from 'cytoscape';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { HostAPI } from '@/shell/hostApi';

const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_PROJECT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  hostAPI?: HostAPI;
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-slider-click-test-'));

    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({
      lastDirectory: FIXTURE_PROJECT_PATH,
      suffixes: {
        [FIXTURE_PROJECT_PATH]: ''
      }
    }, null, 2), 'utf8');

    const settingsPath = path.join(tempUserDataPath, 'voicetree-settings.json');
    await fs.writeFile(settingsPath, JSON.stringify({
      contextNodeMaxDistance: 5
    }, null, 2), 'utf8');
    console.log('[Test] Created config with contextNodeMaxDistance: 5');

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
        const api = (window as unknown as ExtendedWindow).hostAPI;
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

async function getNonContextNodeIds(appWindow: Page, count: number = 2): Promise<string[]> {
  return appWindow.evaluate((n) => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not available');

    const nodes = cy.nodes().filter((node) => {
      const id = node.id();
      const isContextNode = node.data('isContextNode') === true;
      const hasFileExtension = /\.\w+$/.test(id);
      return !isContextNode && hasFileExtension;
    });

    if (nodes.length < n) {
      throw new Error(`Not enough non-context nodes found (need ${n}, found ${nodes.length})`);
    }

    return nodes.slice(0, n).map(node => node.id());
  }, count);
}

async function getNodeScreenPosition(appWindow: Page, nodeId: string): Promise<{x: number; y: number}> {
  return appWindow.evaluate((id) => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not available');
    const node = cy.getElementById(id);
    const rendered = node.renderedPosition();
    const container = cy.container();
    if (!container) throw new Error('No container');
    const rect = container.getBoundingClientRect();
    return {
      x: rect.left + rendered.x,
      y: rect.top + rendered.y
    };
  }, nodeId);
}

async function hoverOverNodeReal(appWindow: Page, nodeId: string): Promise<void> {
  const pos = await getNodeScreenPosition(appWindow, nodeId);
  console.log(`[hoverOverNodeReal] Moving mouse to node ${nodeId} at (${pos.x}, ${pos.y})`);
  await appWindow.mouse.move(pos.x, pos.y);
}

async function leaveNodeReal(appWindow: Page): Promise<void> {
  await appWindow.mouse.move(10, 10);
}

function getSlider(appWindow: Page) {
  return appWindow.locator('.cy-floating-overlay .distance-slider').first();
}

function getSliderSquares(appWindow: Page) {
  return appWindow.locator('.cy-floating-overlay .distance-slider > div:last-child > div');
}

async function getTerminalCount(appWindow: Page): Promise<number> {
  return appWindow.evaluate(() => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) return 0;
    return cy.nodes().filter(node =>
      node.data('isShadowNode') === true &&
      node.data('windowType') === 'Terminal'
    ).length;
  });
}

async function getLastTerminalAttachedNodeId(appWindow: Page): Promise<string | null> {
  return appWindow.evaluate(() => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) return null;

    const terminals = cy.nodes().filter(node =>
      node.data('isShadowNode') === true &&
      node.data('windowType') === 'Terminal'
    );

    if (terminals.length === 0) return null;

    const lastTerminal = terminals.last();
    return lastTerminal.data('attachedToNodeId') ?? null;
  });
}

export {
  getLastTerminalAttachedNodeId,
  getNonContextNodeIds,
  getSlider,
  getSliderSquares,
  getTerminalCount,
  hoverOverNodeReal,
  leaveNodeReal,
  test,
  waitForGraphLoaded
};
