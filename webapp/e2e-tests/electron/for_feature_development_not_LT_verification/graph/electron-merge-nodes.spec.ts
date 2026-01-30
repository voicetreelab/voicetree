/**
 * E2E TEST: Merge Nodes Feature
 *
 * BEHAVIORAL SPEC:
 * When a user selects 2+ nodes in the graph and triggers "Merge Selected" from the context menu:
 * 1. A new merged_*.md file is created on disk containing combined content
 * 2. The original files are deleted from disk
 * 3. External edges are redirected to the new merged node
 *
 * This test exists to debug the broken merge feature that "does nothing".
 * Console logs are captured to identify where the flow breaks.
 *
 * DEBUGGING CHECKLIST (console messages to watch for):
 * - "[mergeSelectedNodesFromUI] Need at least 2 nodes to merge"
 * - "[mergeSelectedNodesFromUI] NO GRAPH IN STATE"
 * - "[mergeSelectedNodesFromUI] No valid merge delta generated"
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_SOURCE = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');

// Type definitions
interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

// Console messages captured during tests
const consoleLogs: string[] = [];

// Extend test with Electron app
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  testVaultPath: string;
}>({
  // Create a COPY of the fixture vault for each test to avoid modifying the original
  testVaultPath: async ({}, use) => {
    const tempVaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-merge-vault-'));

    // Copy fixture files to temp vault (shallow copy - just the .md files)
    const files = await fs.readdir(FIXTURE_VAULT_SOURCE);
    for (const file of files) {
      if (file.endsWith('.md')) {
        const srcPath = path.join(FIXTURE_VAULT_SOURCE, file);
        const destPath = path.join(tempVaultPath, file);
        await fs.copyFile(srcPath, destPath);
      }
    }

    console.log(`[Test] Created temp vault at: ${tempVaultPath}`);

    await use(tempVaultPath);

    // Cleanup temp vault
    await fs.rm(tempVaultPath, { recursive: true, force: true });
  },

  electronApp: async ({ testVaultPath }, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-merge-test-'));

    // Write config to auto-load the test vault
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({
      lastDirectory: testVaultPath,
      suffixes: {
        [testVaultPath]: '' // Empty suffix means use directory directly
      }
    }, null, 2), 'utf8');
    console.log('[Test] Created config file to auto-load:', testVaultPath);

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
      timeout: 20000
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

    // Clear console logs from previous test
    consoleLogs.length = 0;

    // Capture ALL console messages for debugging
    window.on('console', msg => {
      const text = msg.text();
      consoleLogs.push(`[${msg.type()}] ${text}`);
      console.log(`BROWSER [${msg.type()}]:`, text);
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

/**
 * Wait for graph to load and have nodes
 */
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

/**
 * Get all node IDs in the graph
 */
async function getAllNodeIds(appWindow: Page): Promise<string[]> {
  return appWindow.evaluate(() => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) return [];
    return cy.nodes().map(n => n.id());
  });
}

/**
 * Select multiple nodes by their IDs
 */
async function selectNodes(appWindow: Page, nodeIds: string[]): Promise<void> {
  await appWindow.evaluate((ids) => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not available');
    // First unselect all
    cy.nodes().unselect();
    // Then select the specified nodes
    for (const id of ids) {
      const node = cy.getElementById(id);
      if (node.length > 0) {
        node.select();
      }
    }
  }, nodeIds);
}

/**
 * Get count of currently selected nodes
 */
async function getSelectedNodeCount(appWindow: Page): Promise<number> {
  return appWindow.evaluate(() => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) return 0;
    return cy.$(':selected').nodes().length;
  });
}

/**
 * Get IDs of selected nodes
 */
async function getSelectedNodeIds(appWindow: Page): Promise<string[]> {
  return appWindow.evaluate(() => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) return [];
    return cy.$(':selected').nodes().map(n => n.id());
  });
}

/**
 * Trigger merge via right-click context menu on canvas background
 * Note: The merge option is in the canvas context menu, not node-specific menu
 */
async function triggerMergeViaContextMenu(appWindow: Page): Promise<void> {
  // Right-click on canvas background to open context menu
  await appWindow.evaluate(() => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not available');

    // Trigger cxttap on cytoscape core (canvas background)
    // Need to include position and renderedPosition for the menu to appear
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cy as any).emit('cxttap', {
      target: cy,
      position: { x: 300, y: 300 },
      renderedPosition: { x: 300, y: 300 }
    });
  });

  // Wait for context menu to appear
  await appWindow.waitForTimeout(500);

  // Find and click the "Merge Selected" menu item (ctxmenu uses <li> elements)
  const mergeButton = appWindow.locator('.ctxmenu li').filter({
    hasText: /Merge Selected/
  });

  await expect(mergeButton).toBeVisible({ timeout: 5000 });
  await mergeButton.click();
}

/**
 * List files in a directory
 */
async function listFiles(dirPath: string): Promise<string[]> {
  const files = await fs.readdir(dirPath);
  return files.filter(f => f.endsWith('.md'));
}

test.describe('Merge Nodes Feature', () => {

  test('happy path: merge 2 nodes creates merged file and deletes originals', async ({ appWindow, testVaultPath }) => {
    test.setTimeout(90000); // Increase timeout for complex test

    console.log('=== TEST: merge 2 nodes creates merged file and deletes originals ===');

    // ARRANGE: Wait for graph to load
    await waitForGraphLoaded(appWindow);
    const allNodeIds = await getAllNodeIds(appWindow);
    console.log(`✓ Graph loaded with ${allNodeIds.length} nodes`);
    console.log(`Node IDs: ${allNodeIds.join(', ')}`);

    // List initial files
    const initialFiles = await listFiles(testVaultPath);
    console.log(`Initial files (${initialFiles.length}): ${initialFiles.join(', ')}`);

    // Pick 2 nodes to merge (not context nodes)
    const nodesToMerge = allNodeIds
      .filter(id => !id.includes('ctx-nodes') && id.endsWith('.md'))
      .slice(0, 2);

    if (nodesToMerge.length < 2) {
      throw new Error(`Not enough nodes to merge. Found: ${allNodeIds.join(', ')}`);
    }

    console.log(`Nodes to merge: ${nodesToMerge.join(', ')}`);

    // ACT: Select the 2 nodes
    await selectNodes(appWindow, nodesToMerge);
    await appWindow.waitForTimeout(200);

    const selectedCount = await getSelectedNodeCount(appWindow);
    expect(selectedCount).toBe(2);
    console.log(`✓ Selected ${selectedCount} nodes`);

    // Get selected node IDs for verification
    const selectedIds = await getSelectedNodeIds(appWindow);
    console.log(`Selected node IDs: ${selectedIds.join(', ')}`);

    // Debug: Check if selected IDs exist in the graph state
    await appWindow.evaluate(async (ids) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) {
        console.log('[E2E DEBUG] electronAPI not available');
        return;
      }

      // Try to get the graph state
      const graph = await api.main.getGraph();
      if (!graph) {
        console.log('[E2E DEBUG] NO GRAPH IN STATE - getGraph() returned undefined');
        return;
      }

      console.log('[E2E DEBUG] Graph node keys:', Object.keys(graph.nodes).slice(0, 10).join(', '), '...');

      for (const id of ids) {
        const exists = graph.nodes[id] !== undefined;
        console.log(`[E2E DEBUG] Node "${id}" exists in graph: ${exists}`);
      }

      // Also check writePath
      const writePathOption = await api.main.getWritePath();
      console.log('[E2E DEBUG] writePath option:', JSON.stringify(writePathOption));
    }, selectedIds);

    // Take screenshot before merge
    await appWindow.screenshot({ path: 'e2e-tests/screenshots/merge-before.png' });

    // Trigger merge via context menu (right-click on canvas background)
    console.log('Triggering merge via context menu...');
    await triggerMergeViaContextMenu(appWindow);

    // Wait for merge operation to complete
    await appWindow.waitForTimeout(2000);

    // Take screenshot after merge
    await appWindow.screenshot({ path: 'e2e-tests/screenshots/merge-after.png' });

    // ASSERT: Check filesystem changes
    const finalFiles = await listFiles(testVaultPath);
    console.log(`Final files (${finalFiles.length}): ${finalFiles.join(', ')}`);

    // Check for merged_*.md file
    const mergedFiles = finalFiles.filter(f => f.startsWith('merged_'));
    console.log(`Merged files found: ${mergedFiles.join(', ') || 'NONE'}`);

    // Check if original files were deleted
    const originalFile1 = path.basename(nodesToMerge[0]);
    const originalFile2 = path.basename(nodesToMerge[1]);
    const file1Exists = finalFiles.includes(originalFile1);
    const file2Exists = finalFiles.includes(originalFile2);

    console.log(`Original file 1 (${originalFile1}) still exists: ${file1Exists}`);
    console.log(`Original file 2 (${originalFile2}) still exists: ${file2Exists}`);

    // Print captured console logs for debugging
    console.log('\n=== CAPTURED CONSOLE LOGS ===');
    const mergeRelatedLogs = consoleLogs.filter(log =>
      log.includes('merge') ||
      log.includes('Merge') ||
      log.includes('E2E') ||
      log.includes('DEBUG') ||
      log.includes('delta') ||
      log.includes('writePath')
    );
    for (const log of mergeRelatedLogs) {
      console.log(log);
    }
    console.log('=== END CONSOLE LOGS ===\n');

    // Assertions
    expect(mergedFiles.length).toBeGreaterThan(0);
    expect(file1Exists).toBe(false);
    expect(file2Exists).toBe(false);

    console.log('✅ TEST PASSED: Merge created new file and deleted originals');
  });

  test('edge case: merge with < 2 nodes selected should do nothing', async ({ appWindow, testVaultPath }) => {
    test.setTimeout(60000);

    console.log('=== TEST: merge with < 2 nodes selected should do nothing ===');

    // ARRANGE: Wait for graph to load
    await waitForGraphLoaded(appWindow);
    const allNodeIds = await getAllNodeIds(appWindow);
    console.log(`✓ Graph loaded with ${allNodeIds.length} nodes`);

    // List initial files
    const initialFiles = await listFiles(testVaultPath);
    console.log(`Initial files (${initialFiles.length}): ${initialFiles.join(', ')}`);

    // Select only 1 node
    const nodesToSelect = allNodeIds
      .filter(id => !id.includes('ctx-nodes') && id.endsWith('.md'))
      .slice(0, 1);

    await selectNodes(appWindow, nodesToSelect);
    await appWindow.waitForTimeout(200);

    const selectedCount = await getSelectedNodeCount(appWindow);
    expect(selectedCount).toBe(1);
    console.log(`✓ Selected ${selectedCount} node`);

    // ACT: Try to trigger merge via context menu
    console.log('Triggering context menu with 1 node selected...');

    await appWindow.evaluate((id) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      const node = cy.getElementById(id);
      node.emit('cxttap');
    }, nodesToSelect[0]);

    await appWindow.waitForTimeout(500);

    // Check that merge menu item is disabled (has "1 node selected" text)
    const mergeButton = appWindow.locator('.cy-vertical-context-menu-item').filter({
      hasText: /Merge.*1 node selected/
    });

    const isDisabled = await mergeButton.evaluate(el => {
      return el.classList.contains('disabled') || el.getAttribute('data-disabled') === 'true';
    }).catch(() => true); // If element not found, consider it "disabled"

    console.log(`Merge button disabled: ${isDisabled}`);

    // Click somewhere else to close the menu
    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (cy) cy.emit('tap');
    });

    await appWindow.waitForTimeout(500);

    // ASSERT: No filesystem changes
    const finalFiles = await listFiles(testVaultPath);
    const mergedFiles = finalFiles.filter(f => f.startsWith('merged_'));

    expect(mergedFiles.length).toBe(0);
    expect(finalFiles.length).toBe(initialFiles.length);

    console.log('✅ TEST PASSED: No merge occurred with < 2 nodes selected');
  });
});

export { test };
