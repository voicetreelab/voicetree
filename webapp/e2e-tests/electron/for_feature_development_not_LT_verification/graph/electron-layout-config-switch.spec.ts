/**
 * E2E TEST - Layout Config Engine Switching (cola <-> fcose)
 *
 * BEHAVIORAL SPEC:
 * When a user changes the layoutConfig setting from cola to fcose,
 * the graph should re-layout using the fcose engine and node positions
 * should actually change. This verifies the full settings hot-reload
 * pipeline: saveSettings -> onSettingsChanged -> parseLayoutConfig -> runLayout.
 *
 * TEST FLOW:
 * 1. Wait for graph to load with default cola layout
 * 2. Capture initial node positions (cola)
 * 3. Change layoutConfig.engine to 'fcose' via saveSettings
 * 4. Wait for layout to re-run (debounce 300ms + layout animation)
 * 5. Capture new node positions
 * 6. Assert positions changed
 * 7. Restore original settings
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
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

interface NodePosition {
  id: string;
  x: number;
  y: number;
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-layout-switch-test-'));

    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({
      lastDirectory: FIXTURE_VAULT_PATH,
      suffixes: {
        [FIXTURE_VAULT_PATH]: ''
      }
    }, null, 2), 'utf8');
    console.log('[Layout Switch Test] Config file created, auto-loading:', FIXTURE_VAULT_PATH);

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

/** Wait for graph to have nodes loaded */
async function waitForGraphLoaded(appWindow: Page): Promise<void> {
  await expect.poll(async () => {
    return appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return 0;
      return cy.nodes().length;
    });
  }, {
    message: 'Waiting for graph nodes to load',
    timeout: 15000,
    intervals: [500, 1000, 1000]
  }).toBeGreaterThan(0);
}

/** Capture current positions of all non-context nodes */
async function captureNodePositions(appWindow: Page): Promise<NodePosition[]> {
  return appWindow.evaluate(() => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not initialized');
    const positions: { id: string; x: number; y: number }[] = [];
    cy.nodes().forEach(n => {
      if (!n.data('isContextNode')) {
        positions.push({
          id: n.id(),
          x: Math.round(n.position('x') * 100) / 100,
          y: Math.round(n.position('y') * 100) / 100,
        });
      }
    });
    return positions;
  });
}

/** Wait for layout to complete by watching for position stabilization */
async function waitForLayoutStable(appWindow: Page, previousPositions: NodePosition[]): Promise<void> {
  // Wait for debounce (300ms) + layout animation to settle
  // Poll positions until they differ from previous AND stop changing
  let lastSnapshot: string = '';

  await expect.poll(async () => {
    const current = await captureNodePositions(appWindow);
    const currentSnapshot = JSON.stringify(current);
    const positionsChanged = currentSnapshot !== JSON.stringify(previousPositions);
    const positionsStable = currentSnapshot === lastSnapshot;
    lastSnapshot = currentSnapshot;
    // Done when positions have changed from original AND have stopped moving
    return positionsChanged && positionsStable;
  }, {
    message: 'Waiting for layout to stabilize after engine switch',
    timeout: 10000,
    intervals: [500, 500, 500, 1000, 1000]
  }).toBe(true);
}

test.describe('Layout Config Engine Switching', () => {

  test('changing engine from cola to fcose changes node positions', async ({ appWindow }) => {
    test.setTimeout(60000);

    console.log('=== STEP 1: Wait for graph to load with cola layout ===');
    await waitForGraphLoaded(appWindow);

    const nodeCount = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      return cy ? cy.nodes().length : 0;
    });
    console.log(`Graph loaded with ${nodeCount} nodes`);

    // Wait for initial cola layout to finish running
    await appWindow.waitForTimeout(3000);

    console.log('=== STEP 2: Capture initial node positions (cola) ===');
    const colaPositions = await captureNodePositions(appWindow);
    console.log(`Captured ${colaPositions.length} non-context node positions`);
    expect(colaPositions.length).toBeGreaterThan(0);

    for (const pos of colaPositions.slice(0, 3)) {
      console.log(`  Cola: ${pos.id} -> (${pos.x}, ${pos.y})`);
    }

    console.log('=== STEP 3: Save original settings ===');
    const originalSettings = await appWindow.evaluate(async () => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.loadSettings();
    });

    console.log('=== STEP 4: Switch engine to fcose ===');
    await appWindow.evaluate(async () => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      const settings = await api.main.loadSettings();
      const testSettings = JSON.parse(JSON.stringify(settings));

      // Parse the existing layoutConfig, change engine to fcose
      const layoutConfig = JSON.parse(testSettings.layoutConfig ?? '{}');
      layoutConfig.engine = 'fcose';
      testSettings.layoutConfig = JSON.stringify(layoutConfig, null, 2);

      await api.main.saveSettings(testSettings);
      console.log('[Test] Settings saved with engine: fcose');
    });

    console.log('=== STEP 5: Wait for fcose layout to run and stabilize ===');
    await waitForLayoutStable(appWindow, colaPositions);

    console.log('=== STEP 6: Capture fcose node positions ===');
    const fcosePositions = await captureNodePositions(appWindow);
    console.log(`Captured ${fcosePositions.length} non-context node positions after fcose`);

    for (const pos of fcosePositions.slice(0, 3)) {
      console.log(`  Fcose: ${pos.id} -> (${pos.x}, ${pos.y})`);
    }

    console.log('=== STEP 7: Verify positions actually changed ===');
    // Build a map of fcose positions by node ID
    const fcoseMap = new Map<string, NodePosition>(fcosePositions.map(p => [p.id, p]));

    let changedCount = 0;
    for (const colaPos of colaPositions) {
      const fcosePos = fcoseMap.get(colaPos.id);
      if (fcosePos && (Math.abs(fcosePos.x - colaPos.x) > 1 || Math.abs(fcosePos.y - colaPos.y) > 1)) {
        changedCount++;
      }
    }

    console.log(`${changedCount} of ${colaPositions.length} nodes moved (threshold: 1px)`);
    // At least some nodes should have moved
    expect(changedCount).toBeGreaterThan(0);

    // Take screenshot of fcose layout
    await appWindow.screenshot({ path: 'e2e-tests/screenshots/layout-config-fcose.png' });

    console.log('=== STEP 8: Restore original settings ===');
    await appWindow.evaluate(async (original) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      await api.main.saveSettings(original);
    }, originalSettings);

    console.log('=== TEST SUMMARY ===');
    console.log(`Nodes in graph: ${nodeCount}`);
    console.log(`Nodes with positions captured: ${colaPositions.length}`);
    console.log(`Nodes that moved after engine switch: ${changedCount}`);
    console.log('Settings restored to original');
  });

  test('switching back from fcose to cola also changes positions', async ({ appWindow }) => {
    test.setTimeout(60000);

    console.log('=== Wait for graph to load ===');
    await waitForGraphLoaded(appWindow);
    await appWindow.waitForTimeout(3000);

    console.log('=== Save original settings ===');
    const originalSettings = await appWindow.evaluate(async () => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.loadSettings();
    });

    console.log('=== Switch to fcose first ===');
    await appWindow.evaluate(async () => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      const settings = await api.main.loadSettings();
      const testSettings = JSON.parse(JSON.stringify(settings));
      const layoutConfig = JSON.parse(testSettings.layoutConfig ?? '{}');
      layoutConfig.engine = 'fcose';
      testSettings.layoutConfig = JSON.stringify(layoutConfig, null, 2);
      await api.main.saveSettings(testSettings);
    });

    // Wait for fcose layout to complete
    await appWindow.waitForTimeout(4000);
    const fcosePositions = await captureNodePositions(appWindow);
    console.log(`Captured ${fcosePositions.length} fcose positions`);

    console.log('=== Switch back to cola ===');
    await appWindow.evaluate(async () => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      const settings = await api.main.loadSettings();
      const testSettings = JSON.parse(JSON.stringify(settings));
      const layoutConfig = JSON.parse(testSettings.layoutConfig ?? '{}');
      layoutConfig.engine = 'cola';
      testSettings.layoutConfig = JSON.stringify(layoutConfig, null, 2);
      await api.main.saveSettings(testSettings);
    });

    // Wait for cola layout to complete
    await waitForLayoutStable(appWindow, fcosePositions);
    const colaPositions = await captureNodePositions(appWindow);
    console.log(`Captured ${colaPositions.length} cola positions`);

    // Verify at least some positions changed
    const colaMap = new Map<string, NodePosition>(colaPositions.map(p => [p.id, p]));
    let changedCount = 0;
    for (const fcosePos of fcosePositions) {
      const colaPos = colaMap.get(fcosePos.id);
      if (colaPos && (Math.abs(colaPos.x - fcosePos.x) > 1 || Math.abs(colaPos.y - fcosePos.y) > 1)) {
        changedCount++;
      }
    }

    console.log(`${changedCount} of ${fcosePositions.length} nodes moved when switching back to cola`);
    expect(changedCount).toBeGreaterThan(0);

    // Take screenshot of cola layout after switching back
    await appWindow.screenshot({ path: 'e2e-tests/screenshots/layout-config-cola-restored.png' });

    console.log('=== Restore original settings ===');
    await appWindow.evaluate(async (original) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      await api.main.saveSettings(original);
    }, originalSettings);

    console.log(`Nodes that moved: ${changedCount}/${fcosePositions.length}`);
  });
});

export { test };

