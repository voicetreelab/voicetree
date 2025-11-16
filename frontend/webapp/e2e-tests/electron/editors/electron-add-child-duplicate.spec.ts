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
import type { ElectronAPI } from '@/utils/types/electron';
import * as fs from 'fs/promises';
import * as os from 'os';

// Type definitions
interface ExtendedWindow extends Window {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

// Extend test with Electron app
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  testVaultPath: string;
}>({
  testVaultPath: async ({}, use) => {
    // Create a temporary directory for this test
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-test-'));

    // Create a simple parent node
    const parentContent = '# Parent GraphNode\n\nThis is the parent.';
    await fs.writeFile(path.join(tmpDir, 'parent.md'), parentContent, 'utf-8');

    console.log('[Test] Created test vault at:', tmpDir);

    await use(tmpDir);

    // Cleanup
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
      console.log('[Test] Cleaned up test vault');
    } catch (error) {
      console.error('[Test] Failed to cleanup test vault:', error);
    }
  },

  electronApp: async ({ testVaultPath }, use) => {
    const PROJECT_ROOT = path.resolve(process.cwd());

    // Create a temporary userData directory for this test
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-add-child-test-'));

    // Write the config file to auto-load the test vault
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: testVaultPath }, null, 2), 'utf8');
    console.log('[Test] Created config file to auto-load:', testVaultPath);

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
      },
      timeout: 5000
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

    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });

    // Wait for auto-load to complete (vault auto-loads via config file)
    await window.waitForTimeout(1000);

    await use(window);
  }
});

test.describe('Add Child GraphNode - Duplicate Bug Test', () => {
  test('should only create ONE node when adding child via context menu', async ({ appWindow, testVaultPath }) => {
    test.setTimeout(15000);
    console.log('=== Testing add child node duplicate bug ===');

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

    // Find the parent node
    const parentNodeExists = initialState.nodes.some(n => n.id === 'parent');
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
    await appWindow.evaluate(async () => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');

      // Get current graph state
      const currentGraph = await api.main.getGraph();
      if (!currentGraph) throw new Error('No graph state');

      // Get parent node
      const parentNode = currentGraph.nodes['parent'];
      if (!parentNode) throw new Error('Parent node not found');

      // Create child node (replicating fromUICreateChildToUpsertNode logic)
      const childId = parentNode.relativeFilePathIsID + '_' + parentNode.outgoingEdges.length;
      const newNode = {
        relativeFilePathIsID: childId,
        outgoingEdges: [],
        content: '# New GraphNode',
        nodeUIMetadata: {
          title: 'New GraphNode',
          color: { _tag: 'None' } as const,
          position: { _tag: 'None' } as const // Will be positioned by layout
        }
      };

      // Create updated parent with edge to child
      const updatedParent = {
        ...parentNode,
        outgoingEdges: [...parentNode.outgoingEdges, childId]
      };

      // Create GraphDelta
      const graphDelta = [
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: newNode
        },
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: updatedParent
        }
      ];

      // Send to backend (which will update UI-edge and write to file system)
      await api.main.applyGraphDeltaToDBAndMem(graphDelta);
    });

    console.log('[Test] Waiting 2 seconds for file system events to propagate...');

    // Wait for:
    // 1. Optimistic UI-edge update (immediate)
    // 2. File write to complete
    // 3. File watcher to detect and process the new file
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
        content: node.content.substring(0, 50),
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
    const cytoscapeChildNodes = finalCyIds.filter((id: string) => id.startsWith('parent_'));
    console.log('[Test] Cytoscape nodes matching parent_*:', cytoscapeChildNodes);
    console.log('[Test] DUPLICATE COUNT IN CYTOSCAPE:', cytoscapeChildNodes.length);

    // Check for duplicates in Graph
    const graphChildNodes = finalState.graphNodeIds.filter((id: string) => id.startsWith('parent_'));
    console.log('[Test] Graph nodes matching parent_*:', graphChildNodes);
    console.log('[Test] COUNT IN GRAPH:', graphChildNodes.length);

    // Verify file was created on disk
    const files = await fs.readdir(testVaultPath);
    console.log('[Test] Files in vault:', files);

    expect(files).toContain('parent_0.md');

    // ASSERTION: Should only have ONE child node (parent_0) in CYTOSCAPE
    console.log('\n[Test] CHECKING FOR DUPLICATES IN CYTOSCAPE:');
    console.log(`  Expected: 1 child node with ID 'parent_0'`);
    console.log(`  Actual: ${cytoscapeChildNodes.length} child nodes: ${JSON.stringify(cytoscapeChildNodes)}`);

    if (cytoscapeChildNodes.length !== 1) {
      console.error(`❌ BUG FOUND: Expected 1 parent_* node in Cytoscape, found ${cytoscapeChildNodes.length}`);
      console.error(`  This suggests ${cytoscapeChildNodes.length > 1 ? 'DUPLICATE nodes' : 'MISSING node'}`);
    }

    expect(cytoscapeChildNodes.length).toBe(1);
    expect(cytoscapeChildNodes[0]).toBe('parent_0');

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
    console.log('Cytoscape parent_* nodes:', cytoscapeChildNodes);
    console.log('Graph parent_* nodes:', graphChildNodes);
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
