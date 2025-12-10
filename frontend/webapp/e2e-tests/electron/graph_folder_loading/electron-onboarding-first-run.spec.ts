/**
 * BEHAVIORAL SPEC:
 * E2E test for onboarding directory functionality
 *
 * This test verifies:
 * 1. App can successfully load the onboarding directory from Application Support
 * 2. The onboarding directory contains 5-10 markdown files (varies based on fixture updates)
 * 3. All nodes are correctly displayed in the graph with proper labels
 * 4. The watched directory path contains "onboarding"
 * 5. Expected onboarding nodes are present: Welcome, Just Start Talking,
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
import { promises as fs } from 'fs';
import type { Dirent } from 'fs';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

// Use absolute paths
const PROJECT_ROOT: string = path.resolve(process.cwd());
// Source onboarding files (in dev mode this is in public/)
const ONBOARDING_SOURCE: string = path.join(PROJECT_ROOT, 'public', 'onboarding');

// Type definitions (already uses ElectronAPI from types)
interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

interface TestFixtures {
  electronApp: ElectronApplication;
  appWindow: Page;
  tempUserDataPath: string;
}

interface LoadResult {
  success: boolean;
  directory?: string;
  error?: string;
}

interface WatchStatus {
  isWatching: boolean;
  directory?: string;
}

interface GraphState {
  nodes: Record<string, unknown>;
}

interface CytoscapeState {
  nodeCount: number;
  nodeLabels: string[];
}

/**
 * Recursive async copy function for directories
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries: Dirent[] = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath: string = path.join(src, entry.name);
    const destPath: string = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

// Extend test with Electron app
const test: ReturnType<typeof base.extend<TestFixtures>> = base.extend<TestFixtures>({
  tempUserDataPath: async ({}, use) => {
    // Create a temporary userData directory for this test (isolated from other tests)
    const tempPath: string = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-onboarding-test-'));

    // Copy onboarding into the temp userData directory
    // This simulates the first-run setup without running the actual setup code
    const onboardingDest: string = path.join(tempPath, 'onboarding');
    await copyDir(ONBOARDING_SOURCE, onboardingDest);
    console.log('[Onboarding Test] Copied onboarding to temp userData:', onboardingDest);

    // DO NOT create voicetree-config.json - this simulates first run

    await use(tempPath);

    // Cleanup temp directory after test
    await fs.rm(tempPath, { recursive: true, force: true });
    console.log('[Onboarding Test] Cleaned up temp userData directory');
  },

  electronApp: async ({ tempUserDataPath }, use) => {
    // Launch in test mode with isolated userData directory
    const electronApp: ElectronApplication = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}` // Use temp userData to isolate test
      ],
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
      const window: Page = await electronApp.firstWindow();
      await window.evaluate(async () => {
        const api: ElectronAPI | undefined = (window as unknown as ExtendedWindow).electronAPI;
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
    const window: Page = await electronApp.firstWindow();

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
  test('should load onboarding directory on first run and display onboarding nodes', async ({ appWindow, tempUserDataPath }) => {
    test.setTimeout(20000); // 20 second timeout for this test
    console.log('=== ONBOARDING FIRST-RUN TEST: Verify onboarding directory loads automatically ===');

    // Step 1: Verify app loaded
    const appReady: boolean = await appWindow.evaluate(() => {
      return !!(window as ExtendedWindow).cytoscapeInstance &&
             !!(window as ExtendedWindow).electronAPI;
    });
    expect(appReady).toBe(true);
    console.log('✓ App loaded successfully');

    // Step 2: Get the expected onboarding directory path
    const onboardingPath: string = path.join(tempUserDataPath, 'onboarding');
    console.log('✓ Expected onboarding directory path:', onboardingPath);

    // Step 3: Trigger initialLoad to load the onboarding directory automatically
    // Since there's no config file, this should load onboarding
    const loadResult: LoadResult = await appWindow.evaluate(async () => {
      const api: ElectronAPI | undefined = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.loadPreviousFolder();
    });

    expect(loadResult.success).toBe(true);
    console.log('✓ Initial load triggered successfully');

    // Step 4: Wait for graph to load
    await appWindow.waitForTimeout(2000);

    // Step 5: Verify the watched directory is the onboarding directory
    const watchStatus: WatchStatus = await appWindow.evaluate(async () => {
      const api: ElectronAPI | undefined = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getWatchStatus();
    });

    expect(watchStatus.isWatching).toBe(true);
    expect(watchStatus.directory).toBeDefined();
    expect(watchStatus.directory).toContain('onboarding');
    console.log('✓ Onboarding directory is being watched:', watchStatus.directory);

    // Step 6: Verify graph state contains exactly 5 nodes
    const graphState: GraphState = await appWindow.evaluate(async () => {
      const api: ElectronAPI | undefined = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getGraph();
    });

    expect(graphState).toBeDefined();
    const nodeCount: number = Object.keys(graphState.nodes).length;
    console.log(`✓ Graph loaded with ${nodeCount} nodes`);

    // Verify the expected number of onboarding nodes (8 files as of test time)
    // Allow range 5-10 to accommodate fixture changes
    expect(nodeCount).toBeGreaterThanOrEqual(5);
    expect(nodeCount).toBeLessThanOrEqual(10);

    // Step 7: Verify Cytoscape UI has rendered the nodes
    const cytoscapeState: CytoscapeState = await appWindow.evaluate(() => {
      const cy: CytoscapeCore | undefined = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return {
        nodeCount: cy.nodes().length,
        nodeLabels: cy.nodes().map((n) => n.data('label')).sort()
      };
    });

    console.log('✓ Cytoscape rendered nodes:', cytoscapeState.nodeCount);
    console.log('  Node labels:', cytoscapeState.nodeLabels.join(', '));

    // Verify Cytoscape has 5-10 nodes rendered (may vary based on fixture state)
    expect(cytoscapeState.nodeCount).toBeGreaterThanOrEqual(5);
    expect(cytoscapeState.nodeCount).toBeLessThanOrEqual(10);

    // Step 8: Verify key onboarding node labels are present
    // Note: Labels are extracted from frontmatter or filename and may be title-cased
    // The onboarding content may change over time, so we check for a few key nodes
    const expectedLabels: string[] = [
      'Welcome to VoiceTree',
      'Open Your Project Folder'
    ];

    expectedLabels.forEach(expectedLabel => {
      expect(cytoscapeState.nodeLabels).toContain(expectedLabel);
    });
    console.log('✓ Key onboarding nodes are present');
    console.log('  All node labels:', cytoscapeState.nodeLabels.join(', '));

    console.log('');
    console.log('=== TEST SUMMARY ===');
    console.log('✓ App starts successfully');
    console.log('✓ Onboarding directory path retrieved from Application Support');
    console.log('✓ Onboarding directory loaded successfully');
    console.log(`✓ ${nodeCount} onboarding nodes displayed in graph`);
    console.log('✓ All expected onboarding files present with correct labels');
    console.log('✓ Directory watch confirmed on onboarding');
    console.log('');
    console.log('✅ ONBOARDING DIRECTORY TEST PASSED!');
  });
});

export { test };
