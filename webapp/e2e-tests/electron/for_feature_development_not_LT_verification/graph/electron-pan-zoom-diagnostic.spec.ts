/**
 * BEHAVIORAL SPEC:
 * Diagnostic Electron E2E coverage for pan-to-target zoom behavior.
 *
 * This spec verifies the renderer paths implicated in the "too zoomed out"
 * report:
 * 1. Search-style node navigation keeps a single node readable.
 * 2. fitToLastNode uses the same readable single-node zoom target.
 * 3. Terminal cycling never lands below the app's comfortable zoom floor.
 *
 * The fixture intentionally includes folders so the test can reproduce the
 * original hypothesis while still asserting the real failure mode.
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { NodeSingular } from 'cytoscape';
import { createFolderTestVault, waitForGraphLoaded } from './folder-test-helpers';
import {
  captureNavigationDiagnostic,
  captureTerminalDiagnostic,
  logNavigationDiag,
  logTerminalDiag,
  type ExtendedWindow,
} from './pan-zoom-diagnostic-helpers';

const PROJECT_ROOT = path.resolve(process.cwd());

const MIN_COMFORTABLE_ZOOM = 0.65;

interface WindowWithGraph extends ExtendedWindow {
  voiceTreeGraphView?: {
    navigateToNodeAndTrack: (nodeId: string) => void;
    navigationService: {
      setLastCreatedNodeId: (nodeId: string) => void;
      fitToLastNode: () => void;
      cycleTerminal: (direction: 1 | -1) => void;
    };
  };
}

const test = base.extend<{ electronApp: ElectronApplication; appWindow: Page; vaultPath: string }>({
  vaultPath: async ({}, use) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-pan-zoom-vault-'));
    const vaultPath = await createFolderTestVault(tempDir);
    await use(vaultPath);
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  electronApp: async ({ vaultPath }, use) => {
    const tempUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-pan-zoom-ud-'));

    await fs.writeFile(path.join(tempUserData, 'voicetree-config.json'), JSON.stringify({
      lastDirectory: vaultPath,
      vaultConfig: {
        [vaultPath]: {
          writePath: vaultPath,
          readPaths: [],
        },
      },
    }, null, 2), 'utf8');

    await fs.writeFile(path.join(tempUserData, 'projects.json'), JSON.stringify([{
      id: 'pan-zoom-diag',
      path: vaultPath,
      name: 'pan-zoom-diag-vault',
      type: 'folder',
      lastOpened: Date.now(),
      voicetreeInitialized: true,
    }], null, 2), 'utf8');

    const app = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserData}`,
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
        VOICETREE_PERSIST_STATE: '1',
      },
      timeout: 15000,
    });

    await use(app);

    try {
      const window = await app.firstWindow();
      await window.evaluate(async () => {
        await (window as unknown as ExtendedWindow).electronAPI?.main.stopFileWatching();
      });
      await window.waitForTimeout(300);
    } catch {
      // Best-effort cleanup only.
    }

    await app.close();
    await fs.rm(tempUserData, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp, vaultPath }, use) => {
    const window = await electronApp.firstWindow({ timeout: 20000 });

    window.on('console', msg => {
      if (msg.type() === 'warning' || msg.type() === 'error') {
        console.log(`BROWSER [${msg.type()}]:`, msg.text());
      }
    });
    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await window.evaluate(async (targetVaultPath: string) => {
      await (window as unknown as ExtendedWindow).electronAPI?.main.startFileWatching(targetVaultPath);
    }, vaultPath);

    await window.waitForFunction(() => !!(window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 30000 });
    await window.waitForTimeout(3000);

    await use(window);
  },
});

async function pickTargetNode(page: Page): Promise<string> {
  return page.evaluate(() => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance!;
    const candidates = cy.nodes().filter((node: NodeSingular) =>
      !node.data('isFolderNode')
      && !node.data('isShadowNode')
      && !node.data('isContextNode')
      && node.neighborhood().nodes().length >= 2
    );

    if (candidates.length > 0) {
      return candidates[0].id();
    }

    return cy.nodes().filter((node: NodeSingular) =>
      !node.data('isFolderNode') && !node.data('isShadowNode') && !node.data('isContextNode')
    )[0].id();
  });
}

async function panAway(page: Page, zoom: number = 1): Promise<void> {
  await page.evaluate((targetZoom: number) => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance!;
    cy.zoom(targetZoom);
    cy.pan({ x: -3000, y: -3000 });
  }, zoom);
  await page.waitForTimeout(200);
}



async function navigateToNodeViaSearch(page: Page, nodeId: string): Promise<void> {
  await page.evaluate((targetNodeId: string) => {
    const graphView = (window as unknown as WindowWithGraph).voiceTreeGraphView;
    if (!graphView) throw new Error('voiceTreeGraphView not available');
    graphView.navigateToNodeAndTrack(targetNodeId);
  }, nodeId);
  await page.waitForTimeout(500);
}

async function fitToLastNode(page: Page, nodeId: string): Promise<void> {
  await page.evaluate((targetNodeId: string) => {
    const graphView = (window as unknown as WindowWithGraph).voiceTreeGraphView;
    if (!graphView) throw new Error('voiceTreeGraphView not available');
    graphView.navigationService.setLastCreatedNodeId(targetNodeId);
    graphView.navigationService.fitToLastNode();
  }, nodeId);
  await page.waitForTimeout(500);
}

async function cycleTerminal(page: Page): Promise<void> {
  await page.evaluate(() => {
    const graphView = (window as unknown as WindowWithGraph).voiceTreeGraphView;
    if (!graphView) throw new Error('voiceTreeGraphView not available');
    graphView.navigationService.cycleTerminal(1);
  });
  await page.waitForTimeout(500);
}

async function spawnPlainTerminal(page: Page, nodeId: string): Promise<void> {
  await page.evaluate(async (targetNodeId: string) => {
    const api = (window as unknown as ExtendedWindow).electronAPI;
    if (!api?.main) throw new Error('electronAPI.main not available');
    await api.main.spawnPlainTerminal(targetNodeId, 0);
  }, nodeId);
}

test.describe('Pan/Zoom Diagnostic', () => {
  test('search-style node navigation keeps the target readable', async ({ appWindow }) => {
    await waitForGraphLoaded(appWindow, 3);

    const targetNodeId = await pickTargetNode(appWindow);
    await panAway(appWindow);
    await navigateToNodeViaSearch(appWindow, targetNodeId);

    const diagnostic = await captureNavigationDiagnostic(appWindow, targetNodeId);
    logNavigationDiag('search-style navigation', diagnostic);

    expect(diagnostic.targetNodeVisibleInExtent).toBe(true);
    expect(diagnostic.zoom).toBeGreaterThanOrEqual(MIN_COMFORTABLE_ZOOM);
  });

  test('fitToLastNode keeps the target readable', async ({ appWindow }) => {
    await waitForGraphLoaded(appWindow, 3);

    const targetNodeId = await pickTargetNode(appWindow);
    await panAway(appWindow);
    await fitToLastNode(appWindow, targetNodeId);

    const diagnostic = await captureNavigationDiagnostic(appWindow, targetNodeId);
    logNavigationDiag('fitToLastNode', diagnostic);

    expect(diagnostic.targetNodeVisibleInExtent).toBe(true);
    expect(diagnostic.zoom).toBeGreaterThanOrEqual(MIN_COMFORTABLE_ZOOM);
  });

  test('terminal cycling stays above the comfortable zoom floor', async ({ appWindow }) => {
    await waitForGraphLoaded(appWindow, 3);

    const targetNodeId = await pickTargetNode(appWindow);
    await spawnPlainTerminal(appWindow, targetNodeId);
    await expect(appWindow.locator('.cy-floating-window-terminal')).toBeVisible({ timeout: 5000 });

    await panAway(appWindow, 0.2);
    await cycleTerminal(appWindow);

    const diagnostic = await captureTerminalDiagnostic(appWindow);
    logTerminalDiag(diagnostic);

    if ('error' in diagnostic) {
      throw new Error(diagnostic.error);
    }

    expect(diagnostic.shadowVisibleInExtent).toBe(true);
    expect(diagnostic.zoom).toBeGreaterThanOrEqual(MIN_COMFORTABLE_ZOOM);
  });
});

export { test };
