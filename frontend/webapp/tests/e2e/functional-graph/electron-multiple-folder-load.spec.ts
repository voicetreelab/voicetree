/**
 * E2E TEST: Multiple Folder Loading
 *
 * BEHAVIORAL SPEC:
 * 1. Load first folder - verify graph contains only nodes from that folder
 * 2. Load second folder - verify graph clears and contains only nodes from new folder
 * 3. Verify placeholder text disappears when graph has nodes
 *
 * BUG REPRODUCTION:
 * - When loading a second folder, nodes from first folder should be cleared
 * - Placeholder text should hide when graph loads
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import type { Core as CytoscapeCore, NodeSingular } from 'cytoscape';

// Use absolute paths
const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_SMALL = path.join(PROJECT_ROOT, 'tests', 'fixtures', 'example_small');
const FIXTURE_LARGE = path.join(PROJECT_ROOT, 'tests', 'fixtures', 'example_real_large', '2025-09-30');

// Type definitions
interface ExtendedWindow extends Window {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: {
    startFileWatching: (dir: string) => Promise<{ success: boolean; directory?: string; error?: string }>;
    stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
    getWatchStatus: () => Promise<{ isWatching: boolean; directory?: string }>;
  };
}

// Extend test with Electron app
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    const electronApp = await electron.launch({
      args: [path.join(PROJECT_ROOT, 'dist-electron/main/index.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1'
      }
    });

    await use(electronApp);

    // Graceful shutdown
    try {
      const window = await electronApp.firstWindow();
      await window.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (api) {
          await api.stopFileWatching();
        }
      });
      await window.waitForTimeout(300);
    } catch {
      console.log('Note: Could not stop file watching during cleanup');
    }

    await electronApp.close();
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();

    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
    await window.waitForTimeout(1000);

    await use(window);
  }
});

test.describe('Multiple Folder Load Tests', () => {
  test('should clear graph when loading a new folder', async ({ appWindow }) => {
    console.log('=== TEST: Graph clearing on folder switch ===');

    console.log('=== STEP 1: Load first folder (example_small - 6 nodes) ===');
    const firstLoad = await appWindow.evaluate(async (folderPath) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.startFileWatching(folderPath);
    }, FIXTURE_SMALL);

    expect(firstLoad.success).toBe(true);
    console.log('✓ Started watching first folder:', firstLoad.directory);

    // Wait for initial load
    await appWindow.waitForTimeout(3000);

    console.log('=== STEP 2: Verify first folder loaded correctly ===');
    const firstFolderState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Filter out ghost root node
      const realNodes = cy.nodes().filter((n: NodeSingular) => !n.data('isGhostRoot'));

      return {
        nodeCount: realNodes.length,
        nodeIds: realNodes.map((n: NodeSingular) => n.id()).sort()
      };
    });

    console.log(`First folder: ${firstFolderState.nodeCount} nodes`);
    console.log('GraphNode IDs:', firstFolderState.nodeIds);

    // example_small has 6 markdown files
    expect(firstFolderState.nodeCount).toBe(6);

    console.log('=== STEP 3: Verify placeholder text is hidden ===');
    const placeholderHidden1 = await appWindow.evaluate(() => {
      const emptyStateOverlay = document.querySelector('.absolute.inset-0.flex.items-center.justify-center');
      if (!emptyStateOverlay) return true; // Not found means hidden
      const style = window.getComputedStyle(emptyStateOverlay as Element);
      return style.display === 'none' || style.visibility === 'hidden';
    });

    expect(placeholderHidden1).toBe(true);
    console.log('✓ Placeholder text hidden after first load');

    console.log('=== STEP 4: Load second folder (example_real_large - 56 nodes) ===');
    // Stop watching first folder
    await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      await api.stopFileWatching();
    });

    await appWindow.waitForTimeout(500);

    // Load second folder
    const secondLoad = await appWindow.evaluate(async (folderPath) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.startFileWatching(folderPath);
    }, FIXTURE_LARGE);

    expect(secondLoad.success).toBe(true);
    console.log('✓ Started watching second folder:', secondLoad.directory);

    // Wait for second folder to load
    await appWindow.waitForTimeout(3000);

    console.log('=== STEP 5: Verify ONLY second folder nodes are present ===');
    const secondFolderState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Filter out ghost root node
      const realNodes = cy.nodes().filter((n: NodeSingular) => !n.data('isGhostRoot'));

      return {
        nodeCount: realNodes.length,
        nodeIds: realNodes.map((n: NodeSingular) => n.id()).sort()
      };
    });

    console.log(`Second folder: ${secondFolderState.nodeCount} nodes`);
    console.log('Sample node IDs:', secondFolderState.nodeIds.slice(0, 5));

    // CRITICAL: Should have ONLY 56 nodes from second folder, NOT 6 + 56 = 62
    console.log(`Expected: 56 nodes, Got: ${secondFolderState.nodeCount} nodes`);

    if (secondFolderState.nodeCount === 62) {
      console.error('❌ BUG REPRODUCED: Graph was not cleared! Has nodes from both folders.');
      console.error('  First folder nodes should have been deleted');
    }

    expect(secondFolderState.nodeCount).toBe(56);
    console.log('✓ Graph contains only nodes from second folder');

    // Verify none of the first folder nodes remain
    const firstFolderNodesRemaining = firstFolderState.nodeIds.filter(id =>
      secondFolderState.nodeIds.includes(id)
    );

    expect(firstFolderNodesRemaining.length).toBe(0);
    console.log('✓ No nodes from first folder remain in graph');

    console.log('=== STEP 6: Verify placeholder text is still hidden ===');
    const placeholderHidden2 = await appWindow.evaluate(() => {
      const emptyStateOverlay = document.querySelector('.absolute.inset-0.flex.items-center.justify-center');
      if (!emptyStateOverlay) return true;
      const style = window.getComputedStyle(emptyStateOverlay as Element);
      return style.display === 'none' || style.visibility === 'hidden';
    });

    expect(placeholderHidden2).toBe(true);
    console.log('✓ Placeholder text still hidden after second load');

    console.log('\n✅ Multiple folder load test completed successfully!');
  });

  test('should show placeholder when graph is empty', async ({ appWindow }) => {
    console.log('=== TEST: Placeholder visibility ===');

    console.log('=== STEP 1: Verify placeholder is visible on empty graph ===');
    const placeholderVisibleEmpty = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Check if graph is empty (only ghost root)
      const realNodes = cy.nodes().filter((n: NodeSingular) => !n.data('isGhostRoot'));
      const isEmpty = realNodes.length === 0;

      // Check placeholder visibility
      const emptyStateOverlay = document.querySelector('.absolute.inset-0.flex.items-center.justify-center');
      if (!emptyStateOverlay) return { isEmpty, placeholderFound: false, visible: false };

      const style = window.getComputedStyle(emptyStateOverlay as Element);
      const isVisible = style.display !== 'none' && style.visibility !== 'hidden';

      return {
        isEmpty,
        placeholderFound: true,
        visible: isVisible
      };
    });

    console.log('Graph empty:', placeholderVisibleEmpty.isEmpty);
    console.log('Placeholder found:', placeholderVisibleEmpty.placeholderFound);
    console.log('Placeholder visible:', placeholderVisibleEmpty.visible);

    if (placeholderVisibleEmpty.isEmpty) {
      expect(placeholderVisibleEmpty.visible).toBe(true);
      console.log('✓ Placeholder is visible when graph is empty');
    }

    console.log('=== STEP 2: Load folder and verify placeholder hides ===');
    await appWindow.evaluate(async (folderPath) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.startFileWatching(folderPath);
    }, FIXTURE_SMALL);

    await appWindow.waitForTimeout(3000);

    const placeholderHiddenWithNodes = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const realNodes = cy.nodes().filter((n: NodeSingular) => !n.data('isGhostRoot'));
      const hasNodes = realNodes.length > 0;

      const emptyStateOverlay = document.querySelector('.absolute.inset-0.flex.items-center.justify-center');
      if (!emptyStateOverlay) return { hasNodes, placeholderFound: false, visible: false };

      const style = window.getComputedStyle(emptyStateOverlay as Element);
      const isVisible = style.display !== 'none' && style.visibility !== 'hidden';

      return {
        hasNodes,
        placeholderFound: true,
        visible: isVisible
      };
    });

    console.log('Graph has nodes:', placeholderHiddenWithNodes.hasNodes);
    console.log('Placeholder visible:', placeholderHiddenWithNodes.visible);

    if (placeholderHiddenWithNodes.hasNodes) {
      if (placeholderHiddenWithNodes.visible) {
        console.error('❌ BUG REPRODUCED: Placeholder still visible even though graph has nodes!');
      }
      expect(placeholderHiddenWithNodes.visible).toBe(false);
      console.log('✓ Placeholder is hidden when graph has nodes');
    }

    console.log('\n✅ Placeholder visibility test completed successfully!');
  });
});

export { test };
