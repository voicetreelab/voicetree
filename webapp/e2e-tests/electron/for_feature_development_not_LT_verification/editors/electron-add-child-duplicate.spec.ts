/**
 * Test for add child node duplicate bug
 *
 * Purpose: Verify that adding a child node from context menu only creates ONE node in cytoscape,
 * not duplicates from optimistic UI-edge update + file system event
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import type { Core as CytoscapeCore, NodeSingular } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';
import * as fs from 'fs/promises';
import * as os from 'os';

// Type definitions
interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

// Extend test with Electron app
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  testVaultPath: string;
}>({
  // Create temp userData directory with embedded vault + config
  // The config auto-loads the vault during app initialization
  // IMPORTANT: Files must be in {watchedFolder}/voicetree/ due to default vaultSuffix
  electronApp: async ({}, use, testInfo) => {
    const PROJECT_ROOT = path.resolve(process.cwd());

    // Create temp userData directory
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-add-child-test-'));

    // Create the watched folder (what config points to)
    const watchedFolder = path.join(tempUserDataPath, 'test-vault');
    await fs.mkdir(watchedFolder, { recursive: true });

    // Create the actual vault path with default suffix 'voicetree'
    // The app looks for .md files in {watchedFolder}/voicetree/
    const vaultPath = path.join(watchedFolder, 'voicetree');
    await fs.mkdir(vaultPath, { recursive: true });

    // Create a simple parent node
    const parentContent = '# Parent GraphNode\n\nThis is the parent.';
    await fs.writeFile(path.join(vaultPath, 'parent.md'), parentContent, 'utf-8');

    // Write config to auto-load the watched folder (vault = watchedFolder + 'voicetree')
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: watchedFolder }, null, 2), 'utf8');
    console.log('[Test] Watched folder:', watchedFolder);
    console.log('[Test] Vault path (with suffix):', vaultPath);

    // Store vaultPath for test access via testInfo (the actual path where .md files live)
    (testInfo as unknown as { vaultPath: string }).vaultPath = vaultPath;

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}` // Isolate test userData
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

    // Cleanup entire temp directory (includes vault)
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
    console.log('[Test] Cleaned up temp directory');
  },

  // Get vault path from testInfo (set by electronApp fixture)
  testVaultPath: async ({}, use, testInfo) => {
    // Wait for electronApp fixture to set vaultPath
    await use((testInfo as unknown as { vaultPath: string }).vaultPath);
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

    // Check for errors before waiting for cytoscapeInstance
    const hasErrors = await window.evaluate(() => {
      const errors: string[] = [];
      // Check if React rendered
      if (!document.querySelector('#root')) errors.push('No #root element');
      // Check if any error boundaries triggered
      const errorText = document.body.textContent;
      if (errorText?.includes('Error') || errorText?.includes('error')) {
        errors.push(`Page contains error text: ${errorText.substring(0, 200)}`);
      }
      return errors;
    });

    if (hasErrors.length > 0) {
      console.error('Pre-initialization errors:', hasErrors);
    }

    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 20000 });
    await window.waitForTimeout(500); // Give extra time for auto-load to complete

    await use(window);
  }
});

test.describe('Add Child GraphNode - Duplicate Bug Test', () => {
  test('should only create ONE node when adding child via context menu', async ({ appWindow, testVaultPath }) => {
    test.setTimeout(90000);
    console.log('=== Testing add child node duplicate bug ===');
    console.log('[Test] Vault path:', testVaultPath);

    // Vault is auto-loaded via config - wait for graph to have nodes
    // The appWindow fixture already waits for cytoscapeInstance, but we need nodes loaded too
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return 0;
        return cy.nodes().length;
      });
    }, {
      message: 'Waiting for graph to load nodes (auto-loaded via config)',
      timeout: 15000
    }).toBeGreaterThan(0);

    console.log('[Test] Graph loaded with nodes');

    // Get initial state
    const initialState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const nodes = cy.nodes().map((n: NodeSingular) => ({
        id: n.id(),
        label: n.data('label'),
      }));

      const realNodes = nodes;

      return {
        nodeCount: realNodes.length,
        nodes: realNodes
      };
    });

    console.log('=====================================');
    console.log('[Test] INITIAL STATE');
    console.log('  GraphNode count:', initialState.nodeCount);
    console.log('  Nodes:', JSON.stringify(initialState.nodes, null, 2));
    console.log('=====================================');

    // Find the parent node (node ID includes the vault subdirectory path)
    const parentNodeExists = initialState.nodes.some(n => n.id === 'voicetree/parent.md');
    expect(parentNodeExists).toBe(true);

    // Manually replicate the createNewChildNodeFromUI logic
    // (since the function is not exposed on window in current implementation)
    // This simulates what happens when user clicks "Create Child" in context menu:
    // 1. Gets graph state
    // 2. Creates GraphDelta
    // 3. Applies optimistic UI-edge update
    // 4. Sends delta to backend
    // 5. Backend writes file
    // 6. File watcher detects file
    // 7. File watcher MAY create duplicate node (THE BUG!)
    console.log('[Test] Triggering create child node (simulating context menu action)...');
    const childNodeId = await appWindow.evaluate(async () => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');

      // Get current graph state
      const currentGraph = await api.main.getGraph();
      if (!currentGraph) throw new Error('No graph state');

      // Get parent node (node ID includes the vault subdirectory path)
      const parentNode = currentGraph.nodes['voicetree/parent.md'];
      if (!parentNode) throw new Error('Parent node not found');

      // Create child node (replicating fromUICreateChildToUpsertNode logic)
      const childId = parentNode.absoluteFilePathIsID + '_' + parentNode.outgoingEdges.length + '.md';
      const newNode = {
        relativeFilePathIsID: childId,
        outgoingEdges: [] as const,
        contentWithoutYamlOrLinks: '# New GraphNode',
        nodeUIMetadata: {
          title: 'New GraphNode',
          color: { _tag: 'None' } as const,
          position: { _tag: 'None' } as const, // Will be positioned by layout
          additionalYAMLProps: new Map()
        }
      };

      // Create updated parent with edge to child
      const updatedParent = {
        ...parentNode,
        outgoingEdges: [...parentNode.outgoingEdges, { targetId: childId, label: '' }]
      };

      // Create GraphDelta
      const graphDelta = [
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: newNode,
          previousNode: { _tag: 'None' } as const
        },
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: updatedParent,
          previousNode: { _tag: 'Some', value: parentNode } as const
        }
      ];

      // Send to backend (which will update UI-edge and write to file system)
      await api.main.applyGraphDeltaToDBThroughMemUIAndEditorExposed(graphDelta);

      return childId;
    });

    console.log('[Test] Child node ID:', childNodeId);

    // Give file watcher time to process the file creation
    console.log('[Test] Waiting for file watcher to process new file...');
    await appWindow.waitForTimeout(3000);

    console.log('[Test] Checking if child node appeared in Cytoscape...');
    const debugInfo = await appWindow.evaluate((nId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return { found: false, allNodeIds: [], error: 'Cytoscape not initialized' };

      const nodeCount = cy.getElementById(nId).length;
      const allNodeIds = cy.nodes().map(n => n.id());

      return {
        found: nodeCount > 0,
        allNodeIds,
        searchedFor: nId
      };
    }, childNodeId);

    console.log('[Test] Debug info:', JSON.stringify(debugInfo, null, 2));

    if (!debugInfo.found) {
      console.error(`[Test] Node ${childNodeId} NOT found in Cytoscape after 3 seconds!`);
      console.error(`[Test] Available nodes:`, debugInfo.allNodeIds);
      // Don't fail yet, continue to see full state
    } else {
      console.log('[Test] Child node appeared in Cytoscape!');
    }

    console.log('[Test] Waiting 2 more seconds for any duplicate node creation...');
    // Wait for potential duplicates from file watcher
    await appWindow.waitForTimeout(2000);

    console.log('[Test] Now checking both Graph state and Cytoscape state...');

    // Get BOTH Graph state and Cytoscape state
    const finalState = await appWindow.evaluate(async () => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');

      // Get Graph state from main process
      const graphState = await api.main.getGraph();

      // Get Cytoscape node IDs
      const cytoscapeNodes = cy.nodes().map((n: NodeSingular) => ({
        id: n.id(),
        label: n.data('label'),
      }));

      const realCytoscapeNodes = cytoscapeNodes;

      // Pretty print Graph state
      const graphNodeIds = Object.keys(graphState.nodes).sort();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const graphNodeDetails = Object.entries(graphState.nodes).map(([id, node]: [string, any]) => ({
        id,
        content: node.contentWithoutYamlOrLinks ? node.contentWithoutYamlOrLinks.substring(0, 50) : '',
        outgoingEdges: node.outgoingEdges,
        position: node.nodeUIMetadata.position
      }));

      return {
        // Graph state
        graphNodeCount: graphNodeIds.length,
        graphNodeIds: graphNodeIds,
        graphNodeDetails: graphNodeDetails,

        // Cytoscape state
        cytoscapeNodeCount: realCytoscapeNodes.length,
        cytoscapeNodeIds: realCytoscapeNodes.map(n => n.id).sort(),
        cytoscapeNodes: realCytoscapeNodes,

        // All cytoscape nodes including ghost
        allCytoscapeNodeIds: cytoscapeNodes.map(n => n.id).sort()
      };
    });

    // Pretty print both states
    console.log('=====================================');
    console.log('[Test] GRAPH STATE (Main Process)');
    console.log('  GraphNode count:', finalState.graphNodeCount);
    console.log('  GraphNode IDs:', finalState.graphNodeIds);
    console.log('  GraphNode details:', JSON.stringify(finalState.graphNodeDetails, null, 2));
    console.log('=====================================');
    console.log('[Test] CYTOSCAPE STATE (UI-edge)');
    console.log('  GraphNode count:', finalState.cytoscapeNodeCount);
    console.log('  GraphNode IDs:', finalState.cytoscapeNodeIds);
    console.log('  All node IDs (incl ghost):', finalState.allCytoscapeNodeIds);
    console.log('=====================================');

    // Compare initial vs final Cytoscape node IDs
    const initialIds = initialState.nodes.map((n: { id: string }) => n.id).sort();
    const finalCyIds = finalState.cytoscapeNodeIds;
    console.log('[Test] Initial Cytoscape IDs:', initialIds);
    console.log('[Test] Final Cytoscape IDs:', finalCyIds);
    console.log('[Test] New nodes in Cytoscape:', finalCyIds.filter((id: string) => !initialIds.includes(id)));
    console.log('[Test] Removed nodes from Cytoscape:', initialIds.filter((id: string) => !finalCyIds.includes(id)));

    // Check for duplicates in Cytoscape
    const cytoscapeChildNodes = finalCyIds.filter((id: string) => id === childNodeId);
    console.log('[Test] Cytoscape nodes matching', childNodeId, ':', cytoscapeChildNodes);
    console.log('[Test] DUPLICATE COUNT IN CYTOSCAPE:', cytoscapeChildNodes.length);

    // Check for duplicates in Graph
    const graphChildNodes = finalState.graphNodeIds.filter((id: string) => id === childNodeId);
    console.log('[Test] Graph nodes matching', childNodeId, ':', graphChildNodes);
    console.log('[Test] COUNT IN GRAPH:', graphChildNodes.length);

    // Verify file was created on disk
    const files = await fs.readdir(testVaultPath);
    console.log('[Test] Files in vault:', files);

    // The child node ID includes the voicetree/ prefix (e.g., "voicetree/parent.md_0.md")
    // But readdir returns just filenames without directory prefixes
    // Extract just the filename from the child node ID
    const childFileName = childNodeId.replace('voicetree/', '');
    expect(files).toContain(childFileName);

    // ASSERTION: Should only have ONE child node in CYTOSCAPE
    console.log('\n[Test] CHECKING FOR DUPLICATES IN CYTOSCAPE:');
    console.log(`  Expected: 1 child node with ID '${childNodeId}'`);
    console.log(`  Actual: ${cytoscapeChildNodes.length} child nodes: ${JSON.stringify(cytoscapeChildNodes)}`);

    if (cytoscapeChildNodes.length !== 1) {
      console.error(`❌ BUG FOUND: Expected 1 node with ID ${childNodeId} in Cytoscape, found ${cytoscapeChildNodes.length}`);
      console.error(`  This suggests ${cytoscapeChildNodes.length > 1 ? 'DUPLICATE nodes' : 'MISSING node'}`);
    }

    expect(cytoscapeChildNodes.length).toBe(1);
    expect(cytoscapeChildNodes[0]).toBe(childNodeId);

    // ASSERTION: Total Cytoscape nodes should be initial + 1 (new child)
    console.log(`\n[Test] Cytoscape node count check:`);
    console.log(`  Initial: ${initialState.nodeCount}`);
    console.log(`  Final: ${finalState.cytoscapeNodeCount}`);
    console.log(`  Expected: ${initialState.nodeCount + 1}`);
    console.log(`  Difference: ${finalState.cytoscapeNodeCount - initialState.nodeCount} (should be +1)`);

    // Print everything before assertion
    console.log('\n\n========================================');
    console.log('DEBUG SUMMARY BEFORE ASSERTION');
    console.log('========================================');
    console.log('Initial Cytoscape IDs:', initialIds);
    console.log('Final Cytoscape IDs:', finalCyIds);
    console.log('Final Graph IDs:', finalState.graphNodeIds);
    console.log('New in Cytoscape:', finalCyIds.filter((id: string) => !initialIds.includes(id)));
    console.log('Removed from Cytoscape:', initialIds.filter((id: string) => !finalCyIds.includes(id)));
    console.log(`Cytoscape nodes with ID ${childNodeId}:`, cytoscapeChildNodes);
    console.log(`Graph nodes with ID ${childNodeId}:`, graphChildNodes);
    console.log('========================================\n');

    if (finalState.cytoscapeNodeCount !== initialState.nodeCount + 1) {
      const errorMsg = `
❌ NODE COUNT MISMATCH!
  Initial: ${initialState.nodeCount}
  Final: ${finalState.cytoscapeNodeCount}
  Expected: ${initialState.nodeCount + 1}

  Initial IDs: ${JSON.stringify(initialIds)}
  Final Cytoscape IDs: ${JSON.stringify(finalCyIds)}
  Graph IDs: ${JSON.stringify(finalState.graphNodeIds)}
`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }

    expect(finalState.cytoscapeNodeCount).toBe(initialState.nodeCount + 1);

    console.log('✅ Test complete!');
  });
});

export { test };
