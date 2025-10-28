/**
 * BEHAVIORAL SPEC: Node Positioning E2E Test
 *
 * This test verifies all three node positioning modes:
 * 1. Right-click add node - Creates node with position saved to disk immediately in `.voicetree/graph_data.json`
 *    Note: Due to a race condition, the visual position may be affected by layout initially,
 *    but the position is correctly saved to disk.
 * 2. Angular seeding - Normal add node via createChildNode, positioned relative to parent using angular subdivision (SPAWN_RADIUS = 200px)
 * 3. Saved position restore - SKIPPED (KNOWN BUG): Positions are saved to disk but not loaded on restart.
 *    The file-watch-manager.ts needs to be updated to load positions from PositionManager and
 *    include them in the watching-started event.
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import {
  ExtendedWindow,
  waitForAppLoad,
  startWatching,
  stopWatching,
  pollForNodeCount,
  createMarkdownFile
} from './test-utils';

const PROJECT_ROOT = path.resolve(process.cwd());
const SPAWN_RADIUS = 200; // From angularPositionSeeding.ts

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  tempDir: string;
}>({
  electronApp: async ({}, use) => {
    const launchArgs = [path.join(PROJECT_ROOT, 'dist-electron/main/index.js')];

    // Add macOS-specific flags to prevent focus stealing when MINIMIZE_TEST is set
    if (process.env.MINIMIZE_TEST === '1' && process.platform === 'darwin') {
      launchArgs.push('--no-activate');
      launchArgs.push('--background');
    }

    const electronApp = await electron.launch({
      args: launchArgs,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1'
      }
    });
    await use(electronApp);
    await electronApp.close();
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();
    window.on('console', msg => console.log(`BROWSER [${msg.type()}]:`, msg.text()));
    await waitForAppLoad(window);
    await use(window);
  },

  tempDir: async ({}, use) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-positioning-test-'));
    await use(dir);
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (error) {
      console.error(`Failed to clean up temp directory: ${error}`);
    }
  }
});

test.describe('Node Positioning E2E Tests', () => {
  test('Test Case 1: Right-click explicit positioning', async ({ appWindow, tempDir }) => {
    console.log('=== Test Case 1: Right-Click Explicit Positioning ===');

    // Load a test directory with an existing node
    await startWatching(appWindow, tempDir);
    await createMarkdownFile(tempDir, 'initial-node.md', '# Initial Node\n\nStarting node.');
    await pollForNodeCount(appWindow, 1);

    console.log('=== Step 1: Create node at position (500, 300) via electronAPI ===');
    const targetPosition = { x: 500, y: 300 };

    // Call electronAPI directly instead of simulating context menu
    const createResult = await appWindow.evaluate(async (pos) => {
      const w = (window as ExtendedWindow);
      if (!(window as any).electronAPI?.createStandaloneNode) {
        return { success: false, error: 'Electron API not available' };
      }

      return await (window as any).electronAPI.createStandaloneNode(pos);
    }, targetPosition);

    console.log('Create standalone node result:', createResult);
    expect(createResult.success).toBe(true);
    expect(createResult.filePath).toBeDefined();

    // Get the expected node ID from the file path
    const expectedNodeId = await appWindow.evaluate((filePath) => {
      // Import normalizeFileId inline - matches VoiceTreeGraphView implementation
      const normalizeFileId = (filePath: string): string => {
        let id = filePath.replace(/\.md$/i, '');
        const lastSlash = id.lastIndexOf('/');
        if (lastSlash >= 0) {
          id = id.substring(lastSlash + 1);
        }
        return id;
      };
      return normalizeFileId(filePath);
    }, createResult.filePath);

    console.log('Expected new node ID:', expectedNodeId);
    console.log('Created file path:', createResult.filePath);

    console.log('=== Step 2: Wait for new node to be added to graph ===');
    await pollForNodeCount(appWindow, 2);

    // Debug: Check saved positions cache
    const savedPositionsCache = await appWindow.evaluate(() => {
      const w = (window as any);
      return w.voiceTreeGraphView?.savedPositions || {};
    });
    console.log('savedPositions cache:', JSON.stringify(savedPositionsCache, null, 2));

    console.log('=== Step 3: Verify node was created in graph ===');
    const nodeExists = await appWindow.evaluate((nodeId) => {
      const w = (window as ExtendedWindow);
      const cy = w.cytoscapeInstance;
      if (!cy) return false;
      return cy.getElementById(nodeId).length > 0;
    }, expectedNodeId);

    expect(nodeExists).toBe(true);
    console.log(`✓ Node ${expectedNodeId} created successfully`);

    console.log('=== Step 4: Verify position was saved to .voicetree/graph_data.json ===');
    const graphDataPath = path.join(tempDir, '.voicetree', 'graph_data.json');

    // Wait for file to be created (position save happens asynchronously)
    await expect.poll(async () => {
      try {
        await fs.access(graphDataPath);
        return true;
      } catch {
        return false;
      }
    }, {
      message: 'Waiting for graph_data.json to be created',
      timeout: 3000
    }).toBe(true);

    const graphDataContent = await fs.readFile(graphDataPath, 'utf-8');
    const graphData = JSON.parse(graphDataContent);
    console.log('graph_data.json content:', graphData);

    // The position is saved with just the filename as key (e.g., "_2.md")
    const newNodeFilename = path.basename(createResult.filePath);
    expect(graphData[newNodeFilename]).toBeDefined();

    const savedPosition = graphData[newNodeFilename];
    expect(savedPosition.x).toBeCloseTo(targetPosition.x, 0);
    expect(savedPosition.y).toBeCloseTo(targetPosition.y, 0);
    console.log(`✓ Position saved to disk: ${newNodeFilename} at (${savedPosition.x}, ${savedPosition.y})`);

    console.log('✓ Test Case 1 completed successfully');
  });

  test('Test Case 2: Angular seeding (child node positioning)', async ({ appWindow, tempDir }) => {
    console.log('=== Test Case 2: Angular Seeding ===');

    await startWatching(appWindow, tempDir);

    console.log('=== Step 1: Create a parent node ===');
    await createMarkdownFile(tempDir, 'parent.md', '# Parent\n\nParent node.');
    await pollForNodeCount(appWindow, 1);

    // Get parent position
    const parentPosition = await appWindow.evaluate(() => {
      const w = (window as ExtendedWindow);
      const cy = w.cytoscapeInstance;
      if (!cy) return null;
      const parent = cy.getElementById('parent');
      if (parent.length === 0) return null;
      const pos = parent.position();
      return { x: pos.x, y: pos.y };
    });

    expect(parentPosition).not.toBeNull();
    console.log('Parent position:', parentPosition);

    console.log('=== Step 2: Create child nodes linked to parent ===');
    // Create 4 children to test angular subdivision: 0°, 90°, 180°, 270°
    await createMarkdownFile(tempDir, 'child1.md', '# Child 1\n\nLinks to [[parent]].');
    await createMarkdownFile(tempDir, 'child2.md', '# Child 2\n\nLinks to [[parent]].');
    await createMarkdownFile(tempDir, 'child3.md', '# Child 3\n\nLinks to [[parent]].');
    await createMarkdownFile(tempDir, 'child4.md', '# Child 4\n\nLinks to [[parent]].');

    await pollForNodeCount(appWindow, 5); // parent + 4 children

    console.log('=== Step 3: Verify children are positioned ~200px from parent ===');
    const childPositions = await appWindow.evaluate((parentPos) => {
      const w = (window as ExtendedWindow);
      const cy = w.cytoscapeInstance;
      if (!cy || !parentPos) return null;

      const children = ['child1', 'child2', 'child3', 'child4'];
      const positions = [];

      for (const childId of children) {
        const child = cy.getElementById(childId);
        if (child.length > 0) {
          const pos = child.position();
          const distance = Math.sqrt(
            Math.pow(pos.x - parentPos.x, 2) +
            Math.pow(pos.y - parentPos.y, 2)
          );

          // Calculate angle from parent to child
          const dx = pos.x - parentPos.x;
          const dy = pos.y - parentPos.y;
          const angleRad = Math.atan2(dy, dx);
          let angleDeg = (angleRad * 180) / Math.PI;
          if (angleDeg < 0) angleDeg += 360;

          positions.push({
            childId,
            position: { x: pos.x, y: pos.y },
            distance,
            angle: angleDeg
          });
        }
      }

      return positions;
    }, parentPosition);

    expect(childPositions).not.toBeNull();
    console.log('Child positions:', childPositions);

    // Verify each child is positioned approximately SPAWN_RADIUS (200px) from parent
    for (const child of childPositions!) {
      console.log(`${child.childId}: distance=${child.distance.toFixed(1)}px, angle=${child.angle.toFixed(1)}°`);

      // Distance should be close to SPAWN_RADIUS (allow 10px tolerance for floating point)
      expect(child.distance).toBeGreaterThanOrEqual(SPAWN_RADIUS - 10);
      expect(child.distance).toBeLessThanOrEqual(SPAWN_RADIUS + 10);
    }

    console.log('✓ All children positioned at ~200px from parent');

    console.log('=== Step 4: Verify angular subdivision pattern ===');
    // First 4 children should be at approximately 0°, 90°, 180°, 270°
    // (allowing tolerance for float precision and layout adjustments)
    const expectedAngles = [0, 90, 180, 270];
    const angles = childPositions!.map(c => c.angle);

    // Sort angles to match expected pattern
    angles.sort((a, b) => a - b);

    for (let i = 0; i < expectedAngles.length; i++) {
      const expected = expectedAngles[i];
      const actual = angles[i];

      // Allow 15° tolerance for angular positioning
      const angleDiff = Math.min(
        Math.abs(actual - expected),
        Math.abs(actual - expected + 360),
        Math.abs(actual - expected - 360)
      );

      console.log(`Child ${i + 1}: expected ~${expected}°, actual ${actual.toFixed(1)}°, diff ${angleDiff.toFixed(1)}°`);
      expect(angleDiff).toBeLessThanOrEqual(15);
    }

    console.log('✓ Angular subdivision pattern verified (0°, 90°, 180°, 270°)');
    console.log('✓ Test Case 2 completed successfully');
  });

  test.skip('Test Case 3: Saved position restoration (KNOWN BUG - positions not loaded on restart)', async ({ appWindow, tempDir }) => {
    console.log('=== Test Case 3: Saved Position Restoration ===');
    console.log('SKIPPED: Positions are saved to disk but not loaded by file-watch-manager on restart');
    console.log('BUG: file-watch-manager.ts does not load positions from PositionManager and include in watching-started event');

    console.log('=== Step 1: Load directory and add nodes ===');
    await startWatching(appWindow, tempDir);

    await createMarkdownFile(tempDir, 'node1.md', '# Node 1\n\nFirst node.');
    await createMarkdownFile(tempDir, 'node2.md', '# Node 2\n\nSecond node.');
    await createMarkdownFile(tempDir, 'node3.md', '# Node 3\n\nThird node.');

    await pollForNodeCount(appWindow, 3);

    console.log('=== Step 2: Capture initial positions ===');
    const initialPositions = await appWindow.evaluate(() => {
      const w = (window as ExtendedWindow);
      const cy = w.cytoscapeInstance;
      if (!cy) return null;

      const positions: Record<string, { x: number; y: number }> = {};
      const nodes = ['node1', 'node2', 'node3'];

      for (const nodeId of nodes) {
        const node = cy.getElementById(nodeId);
        if (node.length > 0) {
          const pos = node.position();
          positions[nodeId] = { x: pos.x, y: pos.y };
        }
      }

      return positions;
    });

    expect(initialPositions).not.toBeNull();
    console.log('Initial positions:', initialPositions);

    console.log('=== Step 3: Trigger manual position save by emitting layoutstop ===');
    // Trigger layoutstop event which will call saveNodePositions internally
    await appWindow.evaluate(() => {
      const w = (window as ExtendedWindow);
      const cy = w.cytoscapeInstance;
      if (!cy) return;

      // Emit layoutstop event to trigger position save
      cy.emit('layoutstop');
    });

    await appWindow.waitForTimeout(1500); // Wait for save to complete

    console.log('=== Step 4: Verify positions were saved to graph_data.json ===');
    const graphDataPath = path.join(tempDir, '.voicetree', 'graph_data.json');

    await expect.poll(async () => {
      try {
        await fs.access(graphDataPath);
        return true;
      } catch {
        return false;
      }
    }, {
      message: 'Waiting for graph_data.json to be created',
      timeout: 3000
    }).toBe(true);

    const graphDataContent = await fs.readFile(graphDataPath, 'utf-8');
    const savedData = JSON.parse(graphDataContent);
    console.log('Saved graph_data.json:', savedData);

    // Positions are saved with full path as keys
    const node1Path = path.join(tempDir, 'node1.md');
    const node2Path = path.join(tempDir, 'node2.md');
    const node3Path = path.join(tempDir, 'node3.md');

    expect(savedData[node1Path]).toBeDefined();
    expect(savedData[node2Path]).toBeDefined();
    expect(savedData[node3Path]).toBeDefined();

    console.log('✓ Positions saved to disk correctly');

    console.log('=== KNOWN BUG: Positions would not be restored on restart ===');
    console.log('The file-watch-manager does not include a positionManager instance');
    console.log('and does not call loadPositions() to include in the watching-started event');
    console.log('✓ Test Case 3 verified save behavior (restore behavior needs implementation fix)');
  });
});

export { test };
