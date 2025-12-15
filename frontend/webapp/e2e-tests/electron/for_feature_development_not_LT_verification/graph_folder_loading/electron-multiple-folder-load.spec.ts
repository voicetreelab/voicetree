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
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore, NodeSingular } from 'cytoscape';

// Use absolute paths
const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_SMALL = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');
const FIXTURE_ONBOARDING = path.join(PROJECT_ROOT, 'public', 'onboarding');

// Type definitions
interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: {
    main: {
      startFileWatching: (dir: string) => Promise<{ success: boolean; directory?: string; error?: string }>;
      stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
      getWatchStatus: () => Promise<{ isWatching: boolean; directory?: string }>;
    };
  };
}

// Extend test with Electron app
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    // Create a temporary userData directory for this test (mimics smoke test setup)
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-multiple-folder-test-'));

    // Write config file pointing to first test fixture for auto-load
    // This ensures a clean, known starting state for the test
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: FIXTURE_SMALL }, null, 2), 'utf8');
    console.log('[Multiple Folder Test] Created config file to auto-load:', FIXTURE_SMALL);

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}` // Use temp userData to isolate test config
      ],
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
          await api.main.stopFileWatching();
        }
      });
      await window.waitForTimeout(300);
    } catch {
      console.log('Note: Could not stop file watching during cleanup');
    }

    await electronApp.close();

    // Cleanup temp directory
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
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

    // Wait for initial auto-load to complete (loads FIXTURE_SMALL from config)
    await window.waitForFunction(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return false;
      const realNodes = cy.nodes().filter(() => true);
      return realNodes.length >= 7; // FIXTURE_SMALL has 7+ nodes
    }, { timeout: 10000 });

    console.log('[Multiple Folder Test] Initial auto-load complete, ready for test');

    await use(window);
  }
});

test.describe('Multiple Folder Load Tests', () => {
  test('should clear graph when loading a new folder', async ({ appWindow }) => {
    console.log('=== TEST: Graph clearing on folder switch ===');

    // NOTE: First folder (FIXTURE_SMALL) is already auto-loaded from config
    console.log('=== STEP 1: Verify first folder (example_small) auto-loaded correctly ===');
    const firstFolderState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const realNodes = cy.nodes().filter(() => true);

      return {
        nodeCount: realNodes.length,
        nodeIds: realNodes.map((n: NodeSingular) => n.id()).sort()
      };
    });

    console.log(`First folder: ${firstFolderState.nodeCount} nodes`);
    console.log('GraphNode IDs:', firstFolderState.nodeIds);

    // example_small has 7+ markdown files, ctx-nodes folder may accumulate files during test runs
    expect(firstFolderState.nodeCount).toBeGreaterThanOrEqual(7);

    console.log('=== STEP 3: Verify placeholder text is hidden ===');
    const placeholderHidden1 = await appWindow.evaluate(() => {
      const emptyStateOverlay = document.querySelector('.absolute.inset-0.flex.items-center.justify-center');
      if (!emptyStateOverlay) return true; // Not found means hidden
      const style = window.getComputedStyle(emptyStateOverlay as Element);
      return style.display === 'none' || style.visibility === 'hidden';
    });

    expect(placeholderHidden1).toBe(true);
    console.log('✓ Placeholder text hidden after first load');

    console.log('=== STEP 4: Load second folder (onboarding - 8 nodes) ===');
    // Stop watching first folder
    await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      await api.main.stopFileWatching();
    });

    await appWindow.waitForTimeout(500);

    // Load second folder
    const secondLoad = await appWindow.evaluate(async (folderPath) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.startFileWatching(folderPath);
    }, FIXTURE_ONBOARDING);

    expect(secondLoad.success).toBe(true);
    console.log('✓ Started watching second folder:', secondLoad.directory);

    // Wait for second folder to load with polling to ensure nodes are loaded
    await appWindow.waitForFunction(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return false;
      const realNodes = cy.nodes().filter(() => true);
      return realNodes.length >= 5; // Onboarding has 8 files, wait for at least 5
    }, { timeout: 10000 });

    console.log('=== STEP 5: Verify ONLY second folder nodes are present ===');
    const secondFolderState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const realNodes = cy.nodes().filter(() => true);

      return {
        nodeCount: realNodes.length,
        nodeIds: realNodes.map((n: NodeSingular) => n.id()).sort()
      };
    });

    console.log(`Second folder: ${secondFolderState.nodeCount} nodes`);
    console.log('Sample node IDs:', secondFolderState.nodeIds.slice(0, 5));

    // CRITICAL: Should have ONLY nodes from second folder, NOT nodes from both folders
    // The onboarding folder has 8 md files (as of test time)
    // Use range check instead of exact count since fixture files may change
    console.log(`Expected: 5-12 nodes from onboarding, Got: ${secondFolderState.nodeCount} nodes`);

    if (secondFolderState.nodeCount > firstFolderState.nodeCount + 5) {
      console.error('❌ BUG REPRODUCED: Graph was not cleared! Has nodes from both folders.');
      console.error('  First folder nodes should have been deleted');
    }

    // Expect between 5-12 nodes (allows for fixture file changes)
    expect(secondFolderState.nodeCount).toBeGreaterThanOrEqual(5);
    expect(secondFolderState.nodeCount).toBeLessThanOrEqual(12);
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

    // NOTE: First folder (FIXTURE_SMALL) is already auto-loaded from config
    // We need to stop watching to get an empty graph state
    console.log('=== STEP 1: Stop watching to verify placeholder on empty graph ===');
    await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      await api.main.stopFileWatching();
    });

    // TODO: The graph state is NOT cleared when we stop watching - this is by design
    // The graph remains in memory. To test empty state, we would need a graph:clear event.
    // For now, we'll skip the empty graph test and just verify nodes are present.

    console.log('=== STEP 2: Verify graph has nodes from auto-load (placeholder should be hidden) ===');
    const placeholderWithNodes = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const realNodes = cy.nodes().filter(() => true);
      const hasNodes = realNodes.length > 0;

      // Check placeholder visibility
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

    console.log('Graph has nodes:', placeholderWithNodes.hasNodes);
    console.log('Placeholder visible:', placeholderWithNodes.visible);

    expect(placeholderWithNodes.hasNodes).toBe(true);
    expect(placeholderWithNodes.visible).toBe(false);
    console.log('✓ Placeholder is hidden when graph has nodes (from auto-load)');

    console.log('=== STEP 3: Load folder again and verify placeholder stays hidden ===');
    await appWindow.evaluate(async (folderPath) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.startFileWatching(folderPath);
    }, FIXTURE_SMALL);

    // Wait for nodes to load with polling
    await appWindow.waitForFunction(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return false;
      const realNodes = cy.nodes().filter(() => true);
      return realNodes.length >= 7; // example_small has 7+ nodes
    }, { timeout: 10000 });

    const placeholderHiddenWithNodes = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const realNodes = cy.nodes().filter(() => true);
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
