/**
 * BEHAVIORAL SPEC:
 * E2E test for lazy loading when adding a readOnLinkPath.
 *
 * This test verifies that when a user adds a readOnLinkPath via the UI:
 * 1. ONLY nodes that are linked by visible nodes are loaded
 * 2. Unlinked nodes remain hidden (NOT loaded into the graph)
 *
 * BUG BEING TESTED:
 * addReadOnLinkPath() currently uses loadVaultPathAdditively() which loads ALL files,
 * defeating lazy loading. This test will FAIL until the bug is fixed.
 *
 * EXPECTED OUTCOME (when bug is fixed):
 * - Adding a readOnLinkPath should only load nodes that are linked from writePath nodes
 * - Unlinked nodes should remain hidden
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

const PROJECT_ROOT = path.resolve(process.cwd());

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  testDir: string;
  writePath: string;
  readOnLinkPath: string;
}>({
  // Create test directory structure:
  // testDir/
  //   write-vault/           <- writePath (loaded immediately)
  //     linking-node.md      <- Links to [[linked-node]]
  //   read-vault/            <- readOnLinkPath (added later, should lazy load)
  //     linked-node.md       <- SHOULD be loaded (linked by linking-node)
  //     unlinked-node.md     <- SHOULD NOT be loaded (no links to it)
  testDir: async ({}, use) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-lazy-load-test-'));
    await use(tempDir);
    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  writePath: async ({ testDir }, use) => {
    const writePath = path.join(testDir, 'write-vault');
    await fs.mkdir(writePath, { recursive: true });

    // Create a node that links to a node in readOnLinkPath
    await fs.writeFile(
      path.join(writePath, 'linking-node.md'),
      `# Linking Node

This node links to a node in the readOnLinkPath:

- references [[linked-node]]
`
    );

    await use(writePath);
  },

  readOnLinkPath: async ({ testDir }, use) => {
    const readOnLinkPath = path.join(testDir, 'read-vault');
    await fs.mkdir(readOnLinkPath, { recursive: true });

    // Create a node that SHOULD be loaded (linked by linking-node)
    await fs.writeFile(
      path.join(readOnLinkPath, 'linked-node.md'),
      `# Linked Node

This node is linked from the writePath and should be lazy-loaded.
`
    );

    // Create a node that SHOULD NOT be loaded (no links to it)
    await fs.writeFile(
      path.join(readOnLinkPath, 'unlinked-node.md'),
      `# Unlinked Node

This node has NO links pointing to it.
It should NOT be loaded when lazy loading is working correctly.
`
    );

    await use(readOnLinkPath);
  },

  electronApp: async ({ testDir, writePath }, use) => {
    // Create a temporary userData directory
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-lazy-load-userdata-'));

    // Write config to auto-load the testDir with writePath as the only vault initially
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        lastDirectory: testDir,
        vaultConfig: {
          [testDir]: {
            writePath: writePath,
            readOnLinkPaths: []  // Start with no readOnLinkPaths
          }
        }
      }, null, 2),
      'utf8'
    );
    console.log('[Lazy Load Test] Config created for:', testDir);

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
    const window = await electronApp.firstWindow({ timeout: 10000 });

    window.on('console', msg => {
      const text = msg.text();
      if (text.includes('Lazy loaded') || text.includes('[loadFolder]') || text.includes('[handleFSEvent]')) {
        console.log(`[Browser] ${text}`);
      }
    });

    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });

    // Wait for graph to load
    await window.waitForTimeout(1000);

    await use(window);
  }
});

test.describe('Lazy Loading - addReadOnLinkPath', () => {
  test('should only load linked nodes when adding a readOnLinkPath (BUG: currently loads ALL)', async ({
    appWindow,
    readOnLinkPath
  }) => {
    test.setTimeout(30000);

    console.log('=== STEP 1: Verify initial state (only writePath nodes loaded) ===');

    // Get initial node count - should only have linking-node from writePath
    const initialNodes = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return cy.nodes().map(n => n.id());
    });

    console.log('Initial nodes:', initialNodes);
    expect(initialNodes.length).toBe(1);
    expect(initialNodes.some(id => id.includes('linking-node'))).toBe(true);
    expect(initialNodes.some(id => id.includes('linked-node'))).toBe(false);
    expect(initialNodes.some(id => id.includes('unlinked-node'))).toBe(false);

    console.log('=== STEP 2: Add readOnLinkPath via API ===');
    console.log('Adding readOnLinkPath:', readOnLinkPath);

    // Add the readOnLinkPath - this is where the bug manifests
    const addResult = await appWindow.evaluate(async (pathToAdd: string) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.addReadOnLinkPath(pathToAdd);
    }, readOnLinkPath);

    console.log('addReadOnLinkPath result:', addResult);
    expect(addResult.success).toBe(true);

    // Wait for lazy loading to complete
    await appWindow.waitForTimeout(1500);

    console.log('=== STEP 3: Verify lazy loading behavior ===');

    // Get nodes after adding readOnLinkPath
    const nodesAfterAdd = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return cy.nodes().map(n => n.id());
    });

    console.log('Nodes after addReadOnLinkPath:', nodesAfterAdd);

    // EXPECTED (when bug is fixed):
    // - linking-node (from writePath) - LOADED
    // - linked-node (from readOnLinkPath, linked by linking-node) - LOADED
    // - unlinked-node (from readOnLinkPath, not linked) - NOT LOADED

    console.log('=== VERIFICATION ===');
    console.log('Expected nodes: linking-node, linked-node');
    console.log('Should NOT have: unlinked-node');

    // Check that linking-node is still there
    expect(nodesAfterAdd.some(id => id.includes('linking-node'))).toBe(true);

    // Check that linked-node was loaded (it's linked by linking-node)
    const hasLinkedNode = nodesAfterAdd.some(id => id.includes('linked-node'));
    console.log('Has linked-node:', hasLinkedNode);
    expect(hasLinkedNode).toBe(true);

    // THIS IS THE CRITICAL ASSERTION - will fail with current bug
    // unlinked-node should NOT be loaded because nothing links to it
    const hasUnlinkedNode = nodesAfterAdd.some(id => id.includes('unlinked-node'));
    console.log('Has unlinked-node (BUG if true):', hasUnlinkedNode);

    // This assertion catches the bug:
    // - PASSES when lazy loading works correctly (unlinked-node NOT loaded)
    // - FAILS when bug exists (unlinked-node IS loaded because loadVaultPathAdditively loads ALL)
    expect(hasUnlinkedNode).toBe(false);

    // Also verify total node count
    // Expected: 2 (linking-node + linked-node)
    // With bug: 3 (linking-node + linked-node + unlinked-node)
    console.log('Total node count:', nodesAfterAdd.length);
    expect(nodesAfterAdd.length).toBe(2);

    console.log('');
    console.log('=== TEST SUMMARY ===');
    console.log('Lazy loading test for addReadOnLinkPath:');
    console.log('- Initial state: only writePath nodes loaded');
    console.log('- After addReadOnLinkPath: only LINKED nodes from readOnLinkPath loaded');
    console.log('- Unlinked nodes correctly remain hidden');
  });

  test('should load transitively linked nodes when adding readOnLinkPath', async ({
    appWindow,
    testDir,
    writePath
  }) => {
    test.setTimeout(30000);

    // Create a more complex scenario with transitive links:
    // writePath/a.md -> [[b]] -> [[c]]
    // readOnLinkPath has: b.md, c.md, orphan.md
    // Expected: a, b, c loaded; orphan NOT loaded

    const readOnLinkPath = path.join(testDir, 'transitive-vault');
    await fs.mkdir(readOnLinkPath, { recursive: true });

    // Update writePath node to link to b
    await fs.writeFile(
      path.join(writePath, 'linking-node.md'),
      `# Node A

Links to [[b]] in readOnLinkPath.
`
    );

    // Create b.md which links to c.md (transitive)
    await fs.writeFile(
      path.join(readOnLinkPath, 'b.md'),
      `# Node B

This links to [[c]] transitively.
`
    );

    // Create c.md (end of transitive chain)
    await fs.writeFile(
      path.join(readOnLinkPath, 'c.md'),
      `# Node C

End of transitive chain.
`
    );

    // Create orphan.md (should not be loaded)
    await fs.writeFile(
      path.join(readOnLinkPath, 'orphan.md'),
      `# Orphan Node

Nobody links to this node.
`
    );

    // Wait for FS to settle
    await appWindow.waitForTimeout(500);

    console.log('=== Adding readOnLinkPath with transitive links ===');

    const addResult = await appWindow.evaluate(async (pathToAdd: string) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.addReadOnLinkPath(pathToAdd);
    }, readOnLinkPath);

    expect(addResult.success).toBe(true);
    await appWindow.waitForTimeout(1500);

    const nodes = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return cy.nodes().map(n => n.id());
    });

    console.log('Nodes after transitive lazy load:', nodes);

    // Should have: linking-node (a), b, c
    // Should NOT have: orphan
    expect(nodes.some(id => id.includes('linking-node'))).toBe(true);
    expect(nodes.some(id => id.includes('/b.md'))).toBe(true);
    expect(nodes.some(id => id.includes('/c.md'))).toBe(true);

    // This catches the bug - orphan should not be loaded
    const hasOrphan = nodes.some(id => id.includes('orphan'));
    console.log('Has orphan (BUG if true):', hasOrphan);
    expect(hasOrphan).toBe(false);
  });

});

/**
 * Separate test suite with its own fixtures for file-change triggered lazy loading
 */
const testFileChange = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  testDir: string;
  writePath: string;
  readOnLinkPath: string;
}>({
  testDir: async ({}, use) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-file-change-test-'));
    await use(tempDir);
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  writePath: async ({ testDir }, use) => {
    const writePath = path.join(testDir, 'write-vault');
    await fs.mkdir(writePath, { recursive: true });

    // Start with a node that has NO links
    await fs.writeFile(
      path.join(writePath, 'source-node.md'),
      `# Source Node

This node starts with NO links to readOnLinkPath.
`
    );

    await use(writePath);
  },

  readOnLinkPath: async ({ testDir }, use) => {
    const readOnLinkPath = path.join(testDir, 'read-vault');
    await fs.mkdir(readOnLinkPath, { recursive: true });

    // Create a target node that SHOULD be lazy loaded when linked
    await fs.writeFile(
      path.join(readOnLinkPath, 'target-node.md'),
      `# Target Node

This should be lazy loaded when source-node links to it.
`
    );

    await use(readOnLinkPath);
  },

  electronApp: async ({ testDir, writePath, readOnLinkPath }, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-file-change-userdata-'));

    // Config already includes readOnLinkPath (simulating user already added it)
    // Note: readOnLinkPath fixture dependency ensures the directory is created first
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        lastDirectory: testDir,
        vaultConfig: {
          [testDir]: {
            writePath: writePath,
            readOnLinkPaths: [readOnLinkPath]  // Already configured!
          }
        }
      }, null, 2),
      'utf8'
    );

    console.log('[Test Setup] Config saved. testDir:', testDir, 'writePath:', writePath, 'readOnLinkPath:', readOnLinkPath);

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

    // Capture main process console output
    electronApp.process().stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      if (text.includes('resolveNewLinksToReadOnLinkPaths') || text.includes('[handleFSEvent]') || text.includes('[loadFolder]')) {
        console.log(`[Main] ${text.trim()}`);
      }
    });
    electronApp.process().stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      if (text.includes('resolveNewLinksToReadOnLinkPaths') || text.includes('[handleFSEvent]') || text.includes('[loadFolder]')) {
        console.log(`[Main STDERR] ${text.trim()}`);
      }
    });

    await use(electronApp);

    try {
      const window = await electronApp.firstWindow();
      await window.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (api) await api.main.stopFileWatching();
      });
      await window.waitForTimeout(300);
    } catch {
      // ignore
    }

    await electronApp.close();
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 10000 });

    window.on('console', msg => {
      const text = msg.text();
      if (text.includes('Lazy loaded') || text.includes('[loadFolder]') || text.includes('[handleFSEvent]') || text.includes('resolveLinkedNodes') || text.includes('resolveNewLinksToReadOnLinkPaths')) {
        console.log(`[Browser] ${text}`);
      }
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
    await window.waitForTimeout(1000);

    await use(window);
  }
});

testFileChange.describe('Lazy Loading - File Change Triggers', () => {
  testFileChange('should lazy load nodes when a file change adds a new link to readOnLinkPath', async ({
    appWindow,
    writePath,
    readOnLinkPath  // Include to ensure fixture runs and creates the directory
  }) => {
    testFileChange.setTimeout(30000);

    // This tests the scenario where:
    // 1. readOnLinkPath is already configured
    // 2. source-node has NO links initially (so target-node not loaded)
    // 3. User EDITS source-node to add [[target-node]]
    // 4. File watcher should trigger lazy loading

    console.log('=== STEP 1: Verify initial state (only source-node, no target-node) ===');

    const initialNodes = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return cy.nodes().map(n => n.id());
    });

    console.log('Initial nodes:', initialNodes);
    expect(initialNodes.length).toBe(1);
    expect(initialNodes.some(id => id.includes('source-node'))).toBe(true);
    expect(initialNodes.some(id => id.includes('target-node'))).toBe(false);

    console.log('=== STEP 2: Edit source-node to add link [[target-node]] ===');

    const sourceNodePath = path.join(writePath, 'source-node.md');
    await fs.writeFile(
      sourceNodePath,
      `# Source Node

This node now links to [[target-node]] in readOnLinkPath!
`
    );

    // Wait for file watcher + lazy loading
    await appWindow.waitForTimeout(2500);

    console.log('=== STEP 3: Verify lazy loading triggered ===');

    const nodesAfterEdit = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return cy.nodes().map(n => n.id());
    });

    console.log('Nodes after edit:', nodesAfterEdit);

    // Check the edges on the source node - also get from graph store via IPC
    const sourceNodeData = await appWindow.evaluate(async () => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      const api = (window as ExtendedWindow).electronAPI;
      if (!cy) throw new Error('Cytoscape not available');

      const sourceNode = cy.nodes().filter(n => n.id().includes('source-node'))[0];
      if (!sourceNode) return null;

      // Get edges from the main process graph store
      let graphStoreEdges: unknown = null;
      if (api) {
        try {
          // Get the graph from main process to check node's outgoingEdges
          const graph = await api.main.getGraph();
          if (graph) {
            const sourceNodeInStore = Object.values(graph.nodes as Record<string, { absoluteFilePathIsID: string; outgoingEdges: { targetId: string; label: string }[] }>).find(n => n.absoluteFilePathIsID.includes('source-node'));
            graphStoreEdges = sourceNodeInStore?.outgoingEdges;
          }
        } catch (e) {
          graphStoreEdges = `error: ${e}`;
        }
      }

      return {
        id: sourceNode.id(),
        cytoscapeEdges: cy.edges().filter(e => e.source().id() === sourceNode.id()).map(e => ({
          targetId: e.target().id(),
          label: e.data('label')
        })),
        nodeData: sourceNode.data(),
        graphStoreEdges
      };
    });

    console.log('Source node data:', JSON.stringify(sourceNodeData, null, 2));

    // Check what edges exist in the cytoscape graph
    const allEdges = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return cy.edges().map(e => ({
        id: e.id(),
        source: e.source().id(),
        target: e.target().id()
      }));
    });

    console.log('All edges in cytoscape:', JSON.stringify(allEdges, null, 2));

    // EXPECTED: target-node should now be loaded
    const hasTargetNode = nodesAfterEdit.some(id => id.includes('target-node'));

    // Create detailed debug info for assertion message
    const debugInfo = {
      nodesAfterEdit,
      sourceNodeData,
      allEdges,
      hasTargetNode
    };

    // THIS ASSERTION catches the bug - include debug info in error
    expect(hasTargetNode, `target-node not found. Debug info: ${JSON.stringify(debugInfo, null, 2)}`).toBe(true);
    // 3 nodes: source-node + target-node + shadow node (for editor anchor)
    expect(nodesAfterEdit.length).toBe(3);
  });
});

export { test };
