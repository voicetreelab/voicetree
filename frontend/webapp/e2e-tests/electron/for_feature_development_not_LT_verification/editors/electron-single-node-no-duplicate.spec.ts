/**
 * Test for duplicate node creation bug (multivault path duplication)
 *
 * Purpose: Verify that creating a node in an empty folder only creates ONE file,
 * not duplicates from path concatenation bugs in the multivault refactor.
 *
 * This test catches the bug where paths like:
 *   /vault//vault/vault/file.md
 * were being created due to absolute paths being concatenated multiple times.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';
import * as fs from 'fs/promises';
import * as os from 'os';

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  testVaultPath: string;
  watchedFolder: string;
}>({
  electronApp: async ({}, use, testInfo) => {
    const PROJECT_ROOT = path.resolve(process.cwd());

    // Create temp userData directory
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-single-node-test-'));

    // Create the watched folder (what config points to)
    const watchedFolder = path.join(tempUserDataPath, 'test-vault');
    await fs.mkdir(watchedFolder, { recursive: true });

    // Create the actual vault path with default suffix 'voicetree'
    // IMPORTANT: Start EMPTY - no files created
    const vaultPath = path.join(watchedFolder, 'voicetree');
    await fs.mkdir(vaultPath, { recursive: true });

    // Write config to auto-load the watched folder
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: watchedFolder }, null, 2), 'utf8');
    console.log('[Test] Watched folder:', watchedFolder);
    console.log('[Test] Vault path (with suffix):', vaultPath);

    // Store paths for test access via testInfo
    (testInfo as unknown as { vaultPath: string; watchedFolder: string }).vaultPath = vaultPath;
    (testInfo as unknown as { vaultPath: string; watchedFolder: string }).watchedFolder = watchedFolder;

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1'
      },
      timeout: 30000
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
      console.log('[Test] Could not stop file watching during cleanup');
    }

    await electronApp.close();
    console.log('[Test] Electron app closed');

    // Cleanup entire temp directory
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
    console.log('[Test] Cleaned up temp directory');
  },

  testVaultPath: async ({}, use, testInfo) => {
    await use((testInfo as unknown as { vaultPath: string }).vaultPath);
  },

  watchedFolder: async ({}, use, testInfo) => {
    await use((testInfo as unknown as { watchedFolder: string }).watchedFolder);
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();

    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
      console.error('Stack:', error.stack);
    });

    await window.waitForLoadState('domcontentloaded', { timeout: 60000 });
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 20000 });
    await window.waitForTimeout(500);

    await use(window);
  }
});

/**
 * Recursively list all files in a directory
 */
async function listFilesRecursive(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const subFiles = await listFilesRecursive(fullPath);
      files.push(...subFiles.map(f => path.join(entry.name, f)));
    } else {
      files.push(entry.name);
    }
  }
  return files;
}

/**
 * Recursively list all directories in a path
 */
async function listDirsRecursive(dir: string, prefix = ''): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const dirs: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const relativePath = prefix ? path.join(prefix, entry.name) : entry.name;
      dirs.push(relativePath);
      const subDirs = await listDirsRecursive(path.join(dir, entry.name), relativePath);
      dirs.push(...subDirs);
    }
  }
  return dirs;
}

test.describe('Single Node Creation - No Duplicate Files', () => {
  test('should not create duplicate nodes when file watcher processes new file', async ({ appWindow, testVaultPath, watchedFolder }) => {
    test.setTimeout(90000);
    console.log('=== Testing node creation duplicate bug ===');
    console.log('[Test] Vault path:', testVaultPath);
    console.log('[Test] Watched folder:', watchedFolder);

    // Get initial state (may have default nodes from onboarding)
    const initialState = await appWindow.evaluate(async () => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      const api = (window as ExtendedWindow).electronAPI;
      if (!cy || !api) throw new Error('Not initialized');

      const graphState = await api.main.getGraph();
      return {
        cytoscapeNodeCount: cy.nodes().length,
        cytoscapeNodeIds: cy.nodes().map(n => n.id()),
        graphNodeCount: Object.keys(graphState.nodes).length,
        graphNodeIds: Object.keys(graphState.nodes),
      };
    });

    console.log('[Test] Initial state:');
    console.log('  Cytoscape nodes:', initialState.cytoscapeNodeCount, initialState.cytoscapeNodeIds);
    console.log('  Graph nodes:', initialState.graphNodeCount, initialState.graphNodeIds);

    // Create a single node using the API with a RELATIVE path ID
    // (This is how the existing tests do it, and how the UI creates nodes)
    console.log('[Test] Creating a single node with relative ID...');
    const relativeNodeId = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');

      const newNodeId = 'voicetree/test-single-node.md';
      const newNode = {
        absoluteFilePathIsID: newNodeId,
        outgoingEdges: [] as const,
        contentWithoutYamlOrLinks: '# Test Single Node\n\nThis is a test node.',
        nodeUIMetadata: {
          title: 'Test Single Node',
          color: { _tag: 'None' } as const,
          position: { _tag: 'Some', value: { x: 100, y: 100 } } as const,
          additionalYAMLProps: new Map()
        }
      };

      await api.main.applyGraphDeltaToDBThroughMemUIAndEditorExposed([
        { type: 'UpsertNode' as const, nodeToUpsert: newNode, previousNode: { _tag: 'None' } as const }
      ]);

      return newNodeId;
    });

    console.log('[Test] Created node with relative ID:', relativeNodeId);

    // Wait for file watcher to process the new file
    // The bug: file watcher creates a SECOND node with absolute path ID
    console.log('[Test] Waiting for file watcher to process...');
    await appWindow.waitForTimeout(3000);

    // Check file system - where was the file actually written?
    const allFilesInWatchedFolder = await listFilesRecursive(watchedFolder);
    console.log('[Test] All files in watched folder:', allFilesInWatchedFolder);

    // Check all directories to detect path duplication
    const allDirs = await listDirsRecursive(watchedFolder);
    console.log('[Test] All directories:', allDirs);

    // Get final state
    const finalState = await appWindow.evaluate(async () => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      const api = (window as ExtendedWindow).electronAPI;
      if (!cy || !api) throw new Error('Not initialized');

      const graphState = await api.main.getGraph();
      return {
        cytoscapeNodeCount: cy.nodes().length,
        cytoscapeNodeIds: cy.nodes().map(n => n.id()),
        graphNodeCount: Object.keys(graphState.nodes).length,
        graphNodeIds: Object.keys(graphState.nodes),
      };
    });

    console.log('=====================================');
    console.log('[Test] FINAL STATE');
    console.log('  Cytoscape nodes:', finalState.cytoscapeNodeCount, finalState.cytoscapeNodeIds);
    console.log('  Graph nodes:', finalState.graphNodeCount, finalState.graphNodeIds);
    console.log('=====================================');

    // Calculate how many NEW nodes were created
    const newCytoscapeNodes = finalState.cytoscapeNodeIds.filter(
      id => !initialState.cytoscapeNodeIds.includes(id)
    );
    const newGraphNodes = finalState.graphNodeIds.filter(
      id => !initialState.graphNodeIds.includes(id)
    );

    console.log('[Test] NEW Cytoscape nodes:', newCytoscapeNodes.length, JSON.stringify(newCytoscapeNodes));
    console.log('[Test] NEW Graph nodes:', newGraphNodes.length, JSON.stringify(newGraphNodes));

    // Check for the duplicate bug pattern:
    // If we have both a relative ID (voicetree/test-single-node.md) AND an absolute ID
    // (/path/to/vault/voicetree/test-single-node.md), that's a duplicate
    const hasRelativeId = finalState.graphNodeIds.some(id => id === relativeNodeId);
    const hasAbsoluteVersion = finalState.graphNodeIds.some(id =>
      id !== relativeNodeId && id.endsWith('/test-single-node.md')
    );

    console.log('[Test] Has relative ID node:', hasRelativeId);
    console.log('[Test] Has absolute path version:', hasAbsoluteVersion);

    if (hasRelativeId && hasAbsoluteVersion) {
      const absoluteVersions = finalState.graphNodeIds.filter(id =>
        id !== relativeNodeId && id.endsWith('/test-single-node.md')
      );
      console.error('[Test] BUG DETECTED: Both relative and absolute ID versions exist!');
      console.error('  Relative ID:', relativeNodeId);
      console.error('  Absolute versions:', absoluteVersions);
    }

    // ASSERTIONS

    // 1. Only ONE new node should be created (not duplicates)
    console.log(`\n[Test] Checking for duplicate nodes...`);
    console.log(`  Expected: 1 new node`);
    console.log(`  Actual new Cytoscape nodes: ${newCytoscapeNodes.length}`);
    console.log(`  Actual new Graph nodes: ${newGraphNodes.length}`);

    if (newCytoscapeNodes.length !== 1) {
      console.error(`\n❌ DUPLICATE BUG: Expected 1 new Cytoscape node, found ${newCytoscapeNodes.length}`);
      console.error('  New nodes:', newCytoscapeNodes);
    }

    if (newGraphNodes.length !== 1) {
      console.error(`\n❌ DUPLICATE BUG: Expected 1 new Graph node, found ${newGraphNodes.length}`);
      console.error('  New nodes:', newGraphNodes);
    }

    // Should NOT have both relative and absolute versions (that's the duplicate bug)
    expect(hasRelativeId && hasAbsoluteVersion).toBe(false);

    // Should have exactly 1 new node
    expect(newGraphNodes.length).toBe(1);
    expect(newCytoscapeNodes.length).toBe(1);

    // 2. Check for nested directories (path duplication creates /vault/vault/vault/...)
    const unexpectedDirs = allDirs.filter(d => {
      // Allow 'voicetree' and 'onboarding' (default dirs)
      return d !== 'voicetree' && d !== 'onboarding' && !d.startsWith('voicetree/');
    });

    if (unexpectedDirs.length > 0) {
      console.error('[Test] UNEXPECTED DIRECTORIES (possible path duplication):');
      console.error('  ', unexpectedDirs);
    }

    console.log('✅ Test complete!');
  });

  test('should not create duplicate nodes when creating multiple nodes', async ({ appWindow, _testVaultPath, watchedFolder }) => {
    test.setTimeout(90000);
    console.log('=== Testing multiple node creation (no duplicates) ===');

    // Get initial state
    const initialState = await appWindow.evaluate(async () => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      const api = (window as ExtendedWindow).electronAPI;
      if (!cy || !api) throw new Error('Not initialized');

      const graphState = await api.main.getGraph();
      return {
        cytoscapeNodeCount: cy.nodes().length,
        cytoscapeNodeIds: cy.nodes().map(n => n.id()),
        graphNodeCount: Object.keys(graphState.nodes).length,
        graphNodeIds: Object.keys(graphState.nodes),
      };
    });

    console.log('[Test] Initial state:', initialState.graphNodeCount, 'nodes');

    // Create first node
    console.log('[Test] Creating first node...');
    await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');

      const newNode = {
        absoluteFilePathIsID: 'voicetree/multi-node-one.md',
        outgoingEdges: [] as const,
        contentWithoutYamlOrLinks: '# Multi Node One',
        nodeUIMetadata: {
          title: 'Multi Node One',
          color: { _tag: 'None' } as const,
          position: { _tag: 'Some', value: { x: 100, y: 100 } } as const,
          additionalYAMLProps: new Map()
        }
      };

      await api.main.applyGraphDeltaToDBThroughMemUIAndEditorExposed([
        { type: 'UpsertNode' as const, nodeToUpsert: newNode, previousNode: { _tag: 'None' } as const }
      ]);
    });

    await appWindow.waitForTimeout(2000);

    // Create second node
    console.log('[Test] Creating second node...');
    await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');

      const newNode = {
        absoluteFilePathIsID: 'voicetree/multi-node-two.md',
        outgoingEdges: [] as const,
        contentWithoutYamlOrLinks: '# Multi Node Two',
        nodeUIMetadata: {
          title: 'Multi Node Two',
          color: { _tag: 'None' } as const,
          position: { _tag: 'Some', value: { x: 200, y: 100 } } as const,
          additionalYAMLProps: new Map()
        }
      };

      await api.main.applyGraphDeltaToDBThroughMemUIAndEditorExposed([
        { type: 'UpsertNode' as const, nodeToUpsert: newNode, previousNode: { _tag: 'None' } as const }
      ]);
    });

    await appWindow.waitForTimeout(2000);

    // Check file system
    const allFiles = await listFilesRecursive(watchedFolder);
    const allDirs = await listDirsRecursive(watchedFolder);

    console.log('[Test] All files in watched folder:', allFiles);
    console.log('[Test] All directories:', allDirs);

    // Get final state
    const finalState = await appWindow.evaluate(async () => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      const api = (window as ExtendedWindow).electronAPI;
      if (!cy || !api) throw new Error('Not initialized');

      const graphState = await api.main.getGraph();
      return {
        cytoscapeNodeCount: cy.nodes().length,
        cytoscapeNodeIds: cy.nodes().map(n => n.id()),
        graphNodeCount: Object.keys(graphState.nodes).length,
        graphNodeIds: Object.keys(graphState.nodes),
      };
    });

    console.log('[Test] Final state:');
    console.log('  Cytoscape nodes:', finalState.cytoscapeNodeCount, finalState.cytoscapeNodeIds);
    console.log('  Graph nodes:', finalState.graphNodeCount, finalState.graphNodeIds);

    // Calculate new nodes
    const newGraphNodes = finalState.graphNodeIds.filter(
      id => !initialState.graphNodeIds.includes(id)
    );
    const newCytoscapeNodes = finalState.cytoscapeNodeIds.filter(
      id => !initialState.cytoscapeNodeIds.includes(id)
    );

    console.log('[Test] NEW Graph nodes:', newGraphNodes.length, newGraphNodes);
    console.log('[Test] NEW Cytoscape nodes:', newCytoscapeNodes.length, newCytoscapeNodes);

    // Check for duplicate bug: count nodes matching each filename
    const nodeOneVersions = finalState.graphNodeIds.filter(id => id.includes('multi-node-one'));
    const nodeTwoVersions = finalState.graphNodeIds.filter(id => id.includes('multi-node-two'));

    console.log('[Test] Nodes containing "multi-node-one":', nodeOneVersions);
    console.log('[Test] Nodes containing "multi-node-two":', nodeTwoVersions);

    if (nodeOneVersions.length > 1) {
      console.error('[Test] BUG: Multiple versions of node-one exist!');
    }
    if (nodeTwoVersions.length > 1) {
      console.error('[Test] BUG: Multiple versions of node-two exist!');
    }

    // ASSERTIONS
    // Should have exactly 2 new nodes (not 4 due to duplicates)
    expect(newGraphNodes.length).toBe(2);
    expect(newCytoscapeNodes.length).toBe(2);

    // Each node should only have ONE version (not both relative and absolute)
    expect(nodeOneVersions.length).toBe(1);
    expect(nodeTwoVersions.length).toBe(1);

    // Check for nested directories (path duplication symptom)
    const unexpectedDirs = allDirs.filter(d =>
      d !== 'voicetree' && d !== 'onboarding' && !d.startsWith('voicetree/')
    );
    if (unexpectedDirs.length > 0) {
      console.error('[Test] UNEXPECTED DIRECTORIES:', unexpectedDirs);
    }

    console.log('✅ Test complete!');
  });
});

export { test };
