/**
 * E2E test for node position save/load persistence.
 *
 * BUG: When opening a folder, nodes all load on top of each other.
 * This test verifies the full e2e flow:
 * 1. Create a vault with markdown files and a positions.json with distinct positions
 * 2. Launch the app and load the vault
 * 3. Verify nodes in Cytoscape have the saved positions (not all stacked at origin)
 *
 * The positions flow:
 * - Save: UI saveNodePositions() -> in-memory graph -> savePositionsSync() -> .voicetree/positions.json
 * - Load: watchFolder loadPositions() -> mergePositionsIntoGraph() -> graph state -> applyGraphDeltaToUI
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore, NodeSingular } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

const PROJECT_ROOT = path.resolve(process.cwd());

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

// Pre-defined positions spread across the canvas (not stacked)
const SAVED_POSITIONS: Record<string, { x: number; y: number }> = {
  'node-a.md': { x: 100, y: 200 },
  'node-b.md': { x: 400, y: 100 },
  'node-c.md': { x: 700, y: 300 },
};

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  testVaultPath: string;
}>({
  testVaultPath: async ({}, use) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-position-test-'));
    const vaultPath = path.join(tempDir, 'voicetree');
    const voicetreeDir = path.join(tempDir, '.voicetree');

    await fs.mkdir(vaultPath, { recursive: true });
    await fs.mkdir(voicetreeDir, { recursive: true });

    // Create markdown files
    await fs.writeFile(
      path.join(vaultPath, 'node-a.md'),
      '# Node A\n\nFirst test node.\n\n[[node-b.md]]'
    );
    await fs.writeFile(
      path.join(vaultPath, 'node-b.md'),
      '# Node B\n\nSecond test node.\n\n[[node-c.md]]'
    );
    await fs.writeFile(
      path.join(vaultPath, 'node-c.md'),
      '# Node C\n\nThird test node.'
    );

    // Write positions.json with absolute paths as keys (matching how the app stores them)
    const positionsWithAbsolutePaths: Record<string, { x: number; y: number }> = {};
    for (const [filename, pos] of Object.entries(SAVED_POSITIONS)) {
      const absolutePath = path.join(vaultPath, filename);
      positionsWithAbsolutePaths[absolutePath] = pos;
    }
    await fs.writeFile(
      path.join(voicetreeDir, 'positions.json'),
      JSON.stringify(positionsWithAbsolutePaths, null, 2)
    );

    console.log('[Position Test] Created vault at:', tempDir);
    console.log('[Position Test] positions.json:', JSON.stringify(positionsWithAbsolutePaths, null, 2));

    await use(tempDir);

    await fs.rm(tempDir, { recursive: true, force: true });
  },

  electronApp: async ({ testVaultPath }, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-position-userdata-'));

    // Create projects.json so app auto-loads the vault
    const projectsPath = path.join(tempUserDataPath, 'projects.json');
    const savedProject = {
      id: 'position-test-project',
      path: testVaultPath,
      name: 'position-test',
      type: 'folder',
      lastOpened: Date.now(),
      voicetreeInitialized: true
    };
    await fs.writeFile(projectsPath, JSON.stringify([savedProject], null, 2), 'utf8');

    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: testVaultPath }, null, 2), 'utf8');

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

    // Wait for project selection screen
    await window.waitForSelector('text=Voicetree', { timeout: 10000 });

    // Click the project to navigate to graph view
    const projectButton = window.locator('button:has-text("position-test")').first();
    await projectButton.click();
    console.log('[Position Test] Clicked project to enter graph view');

    // Wait for cytoscape to initialize
    await window.waitForFunction(
      () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
      { timeout: 15000 }
    );

    // Wait for graph nodes to load
    await window.waitForFunction(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return false;
      return cy.nodes().length >= 3;
    }, { timeout: 10000 });

    // Allow positions to be applied and layout to settle
    await window.waitForTimeout(2000);

    await use(window);
  }
});

test.describe('Node Position Persistence', () => {
  test('nodes should load with saved positions from positions.json, not stacked at origin', async ({ appWindow, testVaultPath }) => {
    test.setTimeout(45000);

    const vaultPath = path.join(testVaultPath, 'voicetree');

    // Get all node positions from Cytoscape
    const nodePositions = await appWindow.evaluate((vaultDir: string) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const positions: Record<string, { x: number; y: number }> = {};
      cy.nodes().forEach((node: NodeSingular) => {
        const id: string = node.id();
        // Only check real nodes (skip virtual/compound nodes)
        if (id.includes(vaultDir)) {
          const pos = node.position();
          positions[id] = { x: pos.x, y: pos.y };
        }
      });
      return positions;
    }, vaultPath);

    console.log('[Position Test] Node positions in Cytoscape:', JSON.stringify(nodePositions, null, 2));

    const positionValues = Object.values(nodePositions);
    expect(positionValues.length).toBeGreaterThanOrEqual(3);

    // CRITICAL ASSERTION: Nodes should NOT all be at the same position (the bug)
    // If positions aren't loaded, all nodes stack at (0,0) or wherever the layout places them initially
    const allSamePosition = positionValues.every(
      (pos, _, arr) => Math.abs(pos.x - arr[0].x) < 5 && Math.abs(pos.y - arr[0].y) < 5
    );
    expect(allSamePosition).toBe(false);

    // Verify positions match what we saved (within tolerance for rounding/layout adjustments)
    const TOLERANCE = 75; // Allow some drift from layout engine / compound node padding
    for (const [filename, expectedPos] of Object.entries(SAVED_POSITIONS)) {
      const nodeId = path.join(vaultPath, filename);
      const actualPos = nodePositions[nodeId];

      if (actualPos) {
        console.log(`[Position Test] ${filename}: expected (${expectedPos.x}, ${expectedPos.y}), got (${actualPos.x}, ${actualPos.y})`);
        expect(Math.abs(actualPos.x - expectedPos.x)).toBeLessThan(TOLERANCE);
        expect(Math.abs(actualPos.y - expectedPos.y)).toBeLessThan(TOLERANCE);
      } else {
        console.warn(`[Position Test] Node ${nodeId} not found in Cytoscape`);
      }
    }
  });

  test('moved node positions should propagate to in-memory graph state', async ({ appWindow, testVaultPath }) => {
    test.setTimeout(45000);

    const vaultPath = path.join(testVaultPath, 'voicetree');

    // Move a node to a new position via the Cytoscape API + saveNodePositions IPC
    const newPosition = { x: 999, y: 888 };
    const targetNodeId = path.join(vaultPath, 'node-a.md');

    await appWindow.evaluate(({ nodeId, pos }: { nodeId: string; pos: { x: number; y: number } }) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const node = cy.getElementById(nodeId);
      if (node.length === 0) throw new Error(`Node ${nodeId} not found`);

      // Move the node in Cytoscape
      node.position(pos);

      // Trigger position save to main process (simulates what happens on drag end)
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      // @types/cytoscape types jsons() as Record<string, any>[] but it actually returns NodeDefinition[]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void api.main.saveNodePositions(cy.nodes().jsons() as any);
    }, { nodeId: targetNodeId, pos: newPosition });

    // Wait for IPC to propagate
    await appWindow.waitForTimeout(500);

    // Verify the in-memory graph state has the updated position
    const graphPosition = await appWindow.evaluate(async (nodeId: string) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');

      const graph = await api.main.getGraph();
      const node = graph.nodes[nodeId];
      if (!node) throw new Error(`Node ${nodeId} not in graph`);

      // Position is stored as Option<Position> (fp-ts)
      const pos = node.nodeUIMetadata.position;
      if (pos._tag === 'Some') {
        return pos.value;
      }
      return null;
    }, targetNodeId);

    console.log('[Position Test] Graph position after move:', graphPosition);
    expect(graphPosition).not.toBeNull();
    if (graphPosition) {
      expect(graphPosition.x).toBe(newPosition.x);
      expect(graphPosition.y).toBe(newPosition.y);
    }
  });
});

export { test };
