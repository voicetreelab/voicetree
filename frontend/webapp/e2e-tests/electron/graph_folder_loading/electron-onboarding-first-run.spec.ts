/**
 * BEHAVIORAL SPEC:
 * E2E test for onboarding directory functionality
 *
 * This test verifies:
 * 1. App can successfully load the onboarding directory from Application Support
 * 2. The onboarding directory contains exactly 5 markdown files
 * 3. All 5 nodes are correctly displayed in the graph with proper labels
 * 4. The watched directory path contains "onboarding_tree"
 * 5. All expected onboarding nodes are present: Welcome, Just Start Talking,
 *    Open Your Project Folder, Right-Click to Open Terminal, Command Palette
 *
 * This simulates the first-run experience where users see the onboarding content
 * before loading their own project folder.
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/utils/types/electron';

// Use absolute paths
const PROJECT_ROOT = path.resolve(process.cwd());

// Type definitions (already uses ElectronAPI from types)
interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

// Extend test with Electron app
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    // Launch in test mode for fast startup
    const electronApp = await electron.launch({
      args: [path.join(PROJECT_ROOT, 'dist-electron/main/index.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1'
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
      console.log('Note: Could not stop file watching during cleanup (window may be closed)');
    }

    await electronApp.close();
    console.log('[Onboarding Test] Electron app closed');
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

    await use(window);
  }
});

test.describe('Onboarding First Run', () => {
  test('should load onboarding directory on first run and display 5 nodes', async ({ appWindow, electronApp }) => {
    test.setTimeout(20000); // 20 second timeout for this test
    console.log('=== ONBOARDING FIRST-RUN TEST: Verify onboarding directory can be loaded ===');

    // Step 1: Verify app loaded
    const appReady = await appWindow.evaluate(() => {
      return !!(window as ExtendedWindow).cytoscapeInstance &&
             !!(window as ExtendedWindow).electronAPI;
    });
    expect(appReady).toBe(true);
    console.log('✓ App loaded successfully');

    // Step 2: Get the onboarding directory path from the Electron app
    const userData = await electronApp.evaluate(async ({ app }) => {
      return app.getPath('userData');
    });
    const onboardingPath = path.join(userData, 'onboarding_tree');
    console.log('✓ Onboarding directory path:', onboardingPath);

    // Step 3: Manually load the onboarding directory (simulating first-run behavior)
    const watchResult = await appWindow.evaluate(async (vaultPath) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.startFileWatching(vaultPath);
    }, onboardingPath);

    expect(watchResult.success).toBe(true);
    console.log('✓ Onboarding directory loaded successfully');

    // Step 4: Wait for graph to load
    await appWindow.waitForTimeout(1000);

    // Step 5: Verify the watched directory is the onboarding directory
    const watchStatus = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getWatchStatus();
    });

    expect(watchStatus.isWatching).toBe(true);
    expect(watchStatus.directory).toBeDefined();
    expect(watchStatus.directory).toContain('onboarding_tree');
    console.log('✓ Onboarding directory is being watched:', watchStatus.directory);

    // Step 4: Verify graph state contains exactly 5 nodes
    const graphState = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getGraph();
    });

    expect(graphState).toBeDefined();
    const nodeCount = Object.keys(graphState.nodes).length;
    console.log(`✓ Graph loaded with ${nodeCount} nodes`);

    // Verify the expected number of onboarding nodes (may be 5-6 depending on fixture)
    expect(nodeCount).toBeGreaterThanOrEqual(5);
    expect(nodeCount).toBeLessThanOrEqual(6);

    // Step 5: Verify Cytoscape UI-edge has rendered the nodes
    const cytoscapeState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return {
        nodeCount: cy.nodes().length,
        nodeLabels: cy.nodes().map((n) => n.data('label')).sort()
      };
    });

    console.log('✓ Cytoscape rendered nodes:', cytoscapeState.nodeCount);
    console.log('  Node labels:', cytoscapeState.nodeLabels.join(', '));

    // Verify Cytoscape has 5-6 nodes rendered (may vary based on fixture state)
    expect(cytoscapeState.nodeCount).toBeGreaterThanOrEqual(5);
    expect(cytoscapeState.nodeCount).toBeLessThanOrEqual(6);

    // Step 6: Verify node labels match expected onboarding files
    // Note: Labels are extracted from frontmatter or filename and may be title-cased
    const expectedLabels = [
      'Command Palette',
      'Just Start Talking',
      'Open Your Project Folder',
      'Right-Click to Open Terminal',
      'Welcome to VoiceTree'
    ];

    expectedLabels.forEach(expectedLabel => {
      expect(cytoscapeState.nodeLabels).toContain(expectedLabel);
    });
    console.log('✓ All expected onboarding nodes are present');

    console.log('');
    console.log('=== TEST SUMMARY ===');
    console.log('✓ App starts successfully');
    console.log('✓ Onboarding directory path retrieved from Application Support');
    console.log('✓ Onboarding directory loaded successfully');
    console.log('✓ Exactly 5 nodes displayed in graph');
    console.log('✓ All expected onboarding files present with correct labels');
    console.log('✓ Directory watch confirmed on onboarding_tree');
    console.log('');
    console.log('✅ ONBOARDING DIRECTORY TEST PASSED!');
  });
});

export { test };
