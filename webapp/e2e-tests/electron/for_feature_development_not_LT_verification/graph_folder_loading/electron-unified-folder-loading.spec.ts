/**
 * BEHAVIORAL SPEC:
 * E2E tests for the unified folder loading refactor (Phase 5).
 *
 * These tests verify that the loadAndMergeVaultPath function correctly handles:
 * - Creating starter nodes for empty write paths
 * - NOT creating starter nodes for read paths (even if empty)
 * - Loading files correctly when reopening a project
 * - Wikilink resolution
 *
 * Prerequisites:
 * - Phases 1-4 of the "Unify Folder Loading" refactor are complete
 * - loadAndMergeVaultPath handles isWritePath option correctly
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore, NodeSingular } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

const PROJECT_ROOT = path.resolve(process.cwd());

// Type definitions
interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

// Extend test with Electron app
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  testProjectPath: string;
  primaryVaultPath: string;
  secondVaultPath: string;
  tempUserDataPath: string;
}>({
  // Create temp userData path for isolated config
  tempUserDataPath: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-unified-loading-userdata-'));
    await use(tempUserDataPath);
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  // Create a test project with two vault directories
  testProjectPath: async ({}, use) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-unified-loading-test-'));
    const primaryVault = path.join(tempDir, 'primary');
    const secondVault = path.join(tempDir, 'second-vault');

    await fs.mkdir(primaryVault, { recursive: true });
    await fs.mkdir(secondVault, { recursive: true });

    // CRITICAL: Create an initial node in primary vault so the app auto-loads
    // Without this, the app shows the project selector instead of loading
    await fs.writeFile(
      path.join(primaryVault, 'initial-node.md'),
      '# Initial Node\n\nThis is the starting node in primary vault.'
    );

    await use(tempDir);

    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  primaryVaultPath: async ({ testProjectPath }, use) => {
    await use(path.join(testProjectPath, 'primary'));
  },

  secondVaultPath: async ({ testProjectPath }, use) => {
    await use(path.join(testProjectPath, 'second-vault'));
  },

  electronApp: async ({ testProjectPath, tempUserDataPath, primaryVaultPath }, use) => {
    // Write config to auto-load the test project
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({
      lastDirectory: testProjectPath,
      vaultConfig: {
        [testProjectPath]: {
          writePath: primaryVaultPath,
          readPaths: []
        }
      }
    }, null, 2), 'utf8');

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
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15000 });

    window.on('console', msg => {
      const text = msg.text();
      // Only log important messages for debugging
      if (text.includes('[Unified Loading]') || text.includes('Error')) {
        console.log(`[${msg.type()}] ${text}`);
      }
    });

    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 15000 });
    await window.waitForTimeout(1000);

    await use(window);
  }
});

test.describe('Unified Folder Loading E2E Tests', () => {
  /**
   * Test 5A: New folder creation via VaultPathSelector creates starter node
   *
   * SCENARIO: User creates a new folder and sets it as write destination
   * EXPECTED: Starter node is created in the new empty folder
   */
  test('5A: setting write path to empty folder creates starter node', async ({
    appWindow,
    primaryVaultPath,
    secondVaultPath
  }) => {
    test.setTimeout(45000);

    console.log('=== TEST 5A: Setting write path to empty folder creates starter node ===');

    console.log('=== STEP 1: Verify initial state ===');
    await appWindow.waitForTimeout(500);

    // Get initial write path
    const initialWritePath = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      const result = await api.main.getWritePath();
      if (result && typeof result === 'object' && '_tag' in result) {
        return (result as { _tag: string; value?: string })._tag === 'Some' ? (result as { value: string }).value : null;
      }
      return null;
    });

    console.log('Initial write path:', initialWritePath);
    expect(initialWritePath).toBe(primaryVaultPath);

    console.log('=== STEP 2: Verify second-vault is empty ===');
    const secondVaultFiles = await fs.readdir(secondVaultPath);
    console.log('Files in second-vault before setWritePath:', secondVaultFiles);
    expect(secondVaultFiles.length).toBe(0);

    console.log('=== STEP 3: Set write path to empty second-vault ===');
    const setResult = await appWindow.evaluate(async (secondPath: string) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.setWritePath(secondPath);
    }, secondVaultPath);

    console.log('Set write path result:', setResult);
    expect(setResult.success).toBe(true);

    // Wait for file system and graph to update
    await appWindow.waitForTimeout(1500);

    console.log('=== STEP 4: Verify starter node was created on disk ===');
    const filesAfterSet = await fs.readdir(secondVaultPath);
    console.log('Files in second-vault after setWritePath:', filesAfterSet);

    // Should have exactly one starter node file
    const mdFiles = filesAfterSet.filter(f => f.endsWith('.md'));
    expect(mdFiles.length).toBe(1);
    console.log('Starter node file created:', mdFiles[0]);

    console.log('=== STEP 5: Verify starter node appears in graph ===');
    const graphNodes = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return [];
      return cy.nodes().filter(n => !n.data('isShadowNode')).map((n: NodeSingular) => ({
        id: n.id(),
        label: n.data('label')
      }));
    });

    console.log('Graph nodes:', graphNodes);
    expect(graphNodes.length).toBeGreaterThan(0);

    // Find nodes in second-vault
    const nodesInSecondVault = graphNodes.filter(n => n.id.includes('second-vault'));
    console.log('Nodes in second-vault:', nodesInSecondVault);
    expect(nodesInSecondVault.length).toBe(1);

    // Take screenshot for verification
    await appWindow.screenshot({ path: 'e2e-tests/screenshots/e2e-5a-starter-node-created.png' });

    console.log('=== TEST 5A PASSED: Starter node created for empty write path ===');
  });

  /**
   * Test 5D: Adding read path does NOT create starter node
   *
   * SCENARIO: User adds an empty folder as read path
   * EXPECTED: No starter node is created (folder stays empty)
   */
  test('5D: adding read path does NOT create starter node', async ({
    appWindow,
    primaryVaultPath,
    secondVaultPath
  }) => {
    test.setTimeout(45000);

    console.log('=== TEST 5D: Adding read path does NOT create starter node ===');

    console.log('=== STEP 1: Verify initial state ===');
    await appWindow.waitForTimeout(500);

    // Create an initial node in primary vault so graph isn't empty
    await fs.writeFile(
      path.join(primaryVaultPath, 'initial-node.md'),
      '# Initial Node\n\nThis is the starting node.'
    );

    // Wait for file watcher to pick it up
    await appWindow.waitForTimeout(1500);

    console.log('=== STEP 2: Verify second-vault is empty ===');
    const secondVaultFilesBefore = await fs.readdir(secondVaultPath);
    console.log('Files in second-vault before addReadPath:', secondVaultFilesBefore);
    expect(secondVaultFilesBefore.length).toBe(0);

    console.log('=== STEP 3: Add second-vault as read path ===');
    const addResult = await appWindow.evaluate(async (secondPath: string) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.addReadPath(secondPath);
    }, secondVaultPath);

    console.log('Add read path result:', addResult);
    expect(addResult.success).toBe(true);

    // Wait for file system and graph to update
    await appWindow.waitForTimeout(1500);

    console.log('=== STEP 4: Verify NO starter node was created on disk ===');
    const filesAfterAdd = await fs.readdir(secondVaultPath);
    console.log('Files in second-vault after addReadPath:', filesAfterAdd);

    // Should still be empty - NO starter node for read paths
    expect(filesAfterAdd.length).toBe(0);

    console.log('=== STEP 5: Verify read path was added to config ===');
    const vaultPaths = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getVaultPaths();
    });

    console.log('All vault paths:', vaultPaths);
    expect(vaultPaths).toContain(secondVaultPath);

    // Take screenshot for verification
    await appWindow.screenshot({ path: 'e2e-tests/screenshots/e2e-5d-no-starter-for-read-path.png' });

    console.log('=== TEST 5D PASSED: No starter node created for read path ===');
  });

  /**
   * Test 5B: Reopening project loads all files correctly
   *
   * SCENARIO: User reopens a project that has existing files
   * EXPECTED: All files are loaded, wikilinks resolved, no duplicate starter nodes
   */
  test('5B: reopening project loads all files correctly', async ({
    testProjectPath,
    primaryVaultPath,
    tempUserDataPath
  }) => {
    test.setTimeout(60000);

    console.log('=== TEST 5B: Reopening project loads all files correctly ===');

    console.log('=== STEP 1: Create test files with wikilinks ===');
    // Create multiple files with wikilinks to test resolution
    await fs.writeFile(
      path.join(primaryVaultPath, 'parent-node.md'),
      '# Parent Node\n\nThis links to [[child-node]] and [[sibling-node]].'
    );
    await fs.writeFile(
      path.join(primaryVaultPath, 'child-node.md'),
      '# Child Node\n\nThis is a child that links back to [[parent-node]].'
    );
    await fs.writeFile(
      path.join(primaryVaultPath, 'sibling-node.md'),
      '# Sibling Node\n\nThis is a sibling that links to [[child-node]].'
    );

    console.log('=== STEP 2: Update config to load this project ===');
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({
      lastDirectory: testProjectPath,
      vaultConfig: {
        [testProjectPath]: {
          writePath: primaryVaultPath,
          readPaths: []
        }
      }
    }, null, 2), 'utf8');

    console.log('=== STEP 3: Launch Electron app ===');
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

    try {
      const appWindow = await electronApp.firstWindow({ timeout: 15000 });
      await appWindow.waitForLoadState('domcontentloaded');
      await appWindow.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 15000 });

      // Wait for auto-load to complete
      await appWindow.waitForTimeout(2000);

      console.log('=== STEP 4: Verify all files loaded into graph ===');
      const graphState = await appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return { nodeCount: 0, edgeCount: 0, nodeLabels: [], edges: [] };

        const nodes = cy.nodes().filter(n => !n.data('isShadowNode'));
        return {
          nodeCount: nodes.length,
          edgeCount: cy.edges().filter(e => !e.data('isGhostEdge')).length,
          nodeLabels: nodes.map((n: NodeSingular) => n.data('label') || n.id()),
          edges: cy.edges().filter(e => !e.data('isGhostEdge')).map(e => ({
            source: e.source().data('label') || e.source().id(),
            target: e.target().data('label') || e.target().id()
          }))
        };
      });

      console.log('Graph state:', graphState);
      console.log('Node labels:', graphState.nodeLabels);
      console.log('Edges:', graphState.edges);

      // Should have exactly 3 nodes (parent, child, sibling)
      expect(graphState.nodeCount).toBe(3);
      expect(graphState.nodeLabels).toContain('Parent Node');
      expect(graphState.nodeLabels).toContain('Child Node');
      expect(graphState.nodeLabels).toContain('Sibling Node');

      // Should have edges from wikilinks (at least some resolved)
      expect(graphState.edgeCount).toBeGreaterThan(0);

      console.log('=== STEP 5: Verify no duplicate starter nodes ===');
      const starterNodes = graphState.nodeLabels.filter(label =>
        label.toLowerCase().includes('starter') ||
        label.toLowerCase().includes('start here')
      );
      console.log('Starter nodes found:', starterNodes);
      // Should have no starter nodes since folder wasn't empty
      expect(starterNodes.length).toBe(0);

      // Take screenshot for verification
      await appWindow.screenshot({ path: 'e2e-tests/screenshots/e2e-5b-reopen-project.png' });

      console.log('=== TEST 5B PASSED: All files loaded correctly on reopen ===');
    } finally {
      try {
        const window = await electronApp.firstWindow();
        await window.evaluate(async () => {
          const api = (window as unknown as ExtendedWindow).electronAPI;
          if (api) await api.main.stopFileWatching();
        });
      } catch { /* ignore */ }
      await electronApp.close();
    }
  });

  /**
   * Test 5C: Changing write path to empty folder creates starter node
   *
   * SCENARIO: User has existing project with files, changes write path to new empty folder
   * EXPECTED: Starter node created in new folder, old files still accessible
   */
  test('5C: changing write path to empty folder creates starter node', async ({
    appWindow,
    primaryVaultPath,
    secondVaultPath
  }) => {
    test.setTimeout(45000);

    console.log('=== TEST 5C: Changing write path to empty folder creates starter node ===');

    console.log('=== STEP 1: Create initial content in primary vault ===');
    await fs.writeFile(
      path.join(primaryVaultPath, 'existing-note.md'),
      '# Existing Note\n\nThis note existed before changing write path.'
    );

    // Wait for file watcher to pick it up
    await appWindow.waitForTimeout(1500);

    console.log('=== STEP 2: Verify initial state ===');
    const initialNodes = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return [];
      return cy.nodes().filter(n => !n.data('isShadowNode')).map((n: NodeSingular) => ({
        id: n.id(),
        label: n.data('label')
      }));
    });

    console.log('Initial nodes:', initialNodes);
    expect(initialNodes.length).toBeGreaterThan(0);

    console.log('=== STEP 3: Verify second-vault is empty ===');
    const secondVaultFilesBefore = await fs.readdir(secondVaultPath);
    console.log('Files in second-vault before:', secondVaultFilesBefore);
    expect(secondVaultFilesBefore.length).toBe(0);

    console.log('=== STEP 4: Change write path to empty second-vault ===');
    const setResult = await appWindow.evaluate(async (secondPath: string) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.setWritePath(secondPath);
    }, secondVaultPath);

    console.log('Set write path result:', setResult);
    expect(setResult.success).toBe(true);

    // Wait for file creation and graph update
    await appWindow.waitForTimeout(1500);

    console.log('=== STEP 5: Verify starter node created in new write path ===');
    const filesAfterChange = await fs.readdir(secondVaultPath);
    console.log('Files in second-vault after change:', filesAfterChange);

    const mdFiles = filesAfterChange.filter(f => f.endsWith('.md'));
    expect(mdFiles.length).toBe(1);
    console.log('Starter node file:', mdFiles[0]);

    console.log('=== STEP 6: Verify write path was updated ===');
    const newWritePath = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      const result = await api.main.getWritePath();
      if (result && typeof result === 'object' && '_tag' in result) {
        return (result as { _tag: string; value?: string })._tag === 'Some' ? (result as { value: string }).value : null;
      }
      return null;
    });

    console.log('New write path:', newWritePath);
    expect(newWritePath).toBe(secondVaultPath);

    // Take screenshot for verification
    await appWindow.screenshot({ path: 'e2e-tests/screenshots/e2e-5c-change-write-path.png' });

    console.log('=== TEST 5C PASSED: Starter node created when changing write path ===');
  });

  /**
   * Test 5E: Screenshot verification helper test
   *
   * This test captures screenshots at each step to enable visual verification.
   */
  test('5E: visual verification flow with screenshots', async ({
    appWindow,
    primaryVaultPath,
    secondVaultPath
  }) => {
    test.setTimeout(60000);

    console.log('=== TEST 5E: Visual verification flow ===');

    console.log('=== STEP 1: Screenshot before any action ===');
    await appWindow.screenshot({ path: 'e2e-tests/screenshots/e2e-flow-step1-initial.png' });

    // Get initial node count
    const initialNodeCount = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return 0;
      return cy.nodes().filter(n => !n.data('isShadowNode')).length;
    });
    console.log('Initial node count:', initialNodeCount);

    console.log('=== STEP 2: Create file in primary vault ===');
    await fs.writeFile(
      path.join(primaryVaultPath, 'visual-test.md'),
      '# Visual Test Node\n\nThis node is for visual verification.'
    );

    await appWindow.waitForTimeout(1500);
    await appWindow.screenshot({ path: 'e2e-tests/screenshots/e2e-flow-step2-file-created.png' });

    const afterFileCount = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return 0;
      return cy.nodes().filter(n => !n.data('isShadowNode')).length;
    });
    console.log('Node count after file creation:', afterFileCount);
    expect(afterFileCount).toBeGreaterThan(initialNodeCount);

    console.log('=== STEP 3: Add empty read path ===');
    const addResult = await appWindow.evaluate(async (path: string) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.addReadPath(path);
    }, secondVaultPath);

    expect(addResult.success).toBe(true);
    await appWindow.waitForTimeout(1000);
    await appWindow.screenshot({ path: 'e2e-tests/screenshots/e2e-flow-step3-read-path-added.png' });

    // Verify no starter node in read path
    const secondVaultFiles = await fs.readdir(secondVaultPath);
    expect(secondVaultFiles.length).toBe(0);

    console.log('=== STEP 4: Verify graph node count ===');
    const finalNodeCount = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return 0;
      return cy.nodes().filter(n => !n.data('isShadowNode')).length;
    });
    console.log('Final node count:', finalNodeCount);
    await appWindow.screenshot({ path: 'e2e-tests/screenshots/e2e-flow-step4-final.png' });

    console.log('=== TEST 5E PASSED: Visual verification complete ===');
    console.log(`Screenshots saved to e2e-tests/screenshots/e2e-flow-*.png`);
  });
});

export { test };
