/**
 * Test: Empty/Malformed Wikilink Bug
 *
 * BUG REPRODUCTION:
 * When editing a node that contains empty or malformed wikilinks like:
 * - [[]]     (empty)
 * - [[.]]    (just a dot)
 * - [[ ]]    (whitespace only)
 *
 * The system creates spurious nodes for completely unrelated files.
 * This appears to be because the wikilink content is fuzzy matching
 * everything when it should match nothing.
 *
 * Expected: Empty/malformed wikilinks should NOT create any edges or nodes
 * Actual: Random unrelated files (e.g. image files) are being created as nodes
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore, NodeSingular } from 'cytoscape';
import type { EditorView } from '@codemirror/view';
import type { ElectronAPI } from '@/shell/electron';

const PROJECT_ROOT = path.resolve(process.cwd());

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

interface CodeMirrorElement extends HTMLElement {
  cmView?: { view: EditorView };
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  testVaultPath: string;
}>({
  electronApp: async ({}, use, testInfo) => {
    // Create temp userData directory
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-empty-wikilink-bug-'));

    // Create the watched folder (what config points to)
    const watchedFolder = path.join(tempUserDataPath, 'test-vault');
    await fs.mkdir(watchedFolder, { recursive: true });

    // Create the actual vault path with default suffix 'voicetree'
    const vaultPath = path.join(watchedFolder, 'voicetree');
    await fs.mkdir(vaultPath, { recursive: true });

    // Create a test node with empty/malformed wikilinks
    const testContent = `---
position:
  x: 100
  y: 100
---
# Test Node with Empty Wikilinks

This node has malformed wikilinks that should NOT create edges:

[[]]

hmm
[[.]]
[[ ]]

These empty wikilinks should be ignored.
`;
    await fs.writeFile(path.join(vaultPath, 'test-node.md'), testContent, 'utf-8');

    // Create a valid target node (to ensure valid wikilinks still work)
    const targetContent = `---
position:
  x: 200
  y: 100
---
# Valid Target

This is a valid target node.
`;
    await fs.writeFile(path.join(vaultPath, 'valid-target.md'), targetContent, 'utf-8');

    // Write config to auto-load the vault
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: watchedFolder }, null, 2), 'utf8');
    console.log('[Test] Watched folder:', watchedFolder);
    console.log('[Test] Vault path (with suffix):', vaultPath);

    // Store vaultPath for test access
    (testInfo as unknown as { vaultPath: string }).vaultPath = vaultPath;

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

    // Cleanup temp directory
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
    console.log('[Test] Cleaned up temp directory');
  },

  testVaultPath: async ({}, use, testInfo) => {
    await use((testInfo as unknown as { vaultPath: string }).vaultPath);
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();

    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded', { timeout: 60000 });
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 20000 });

    // Wait for auto-load to complete by polling for cytoscape nodes
    // The vault has 2 files, so wait for at least 1 node to load
    await window.waitForFunction(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return false;
      return cy.nodes().length >= 1;
    }, { timeout: 15000 });

    await window.waitForTimeout(500);

    await use(window);
  }
});

test.describe('Empty/Malformed Wikilink Bug', () => {
  test('empty wikilinks should NOT create spurious nodes or edges', async ({ appWindow, testVaultPath }) => {
    test.setTimeout(120000);
    console.log('=== Testing empty wikilink bug ===');
    console.log('[Test] Vault path:', testVaultPath);

    // Graph is already loaded by appWindow fixture
    // Get initial graph state
    const initialState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return {
        nodeCount: cy.nodes().length,
        edgeCount: cy.edges().length,
        nodes: cy.nodes().map((n: NodeSingular) => ({ id: n.id(), label: n.data('label') })),
        edges: cy.edges().map((e) => ({ source: e.source().id(), target: e.target().id() }))
      };
    });

    console.log('[Test] Initial state:', JSON.stringify(initialState, null, 2));

    // CRITICAL ASSERTION: Initial state should have ONLY our 2 test nodes
    // NOT random image files or other spurious nodes
    expect(initialState.nodeCount).toBe(2);
    // Node IDs may be absolute paths, so check by label or filename pattern
    expect(initialState.nodes.some(n => n.label === 'Test Node with Empty Wikilinks' || n.id.includes('test-node.md'))).toBe(true);
    expect(initialState.nodes.some(n => n.label === 'Valid Target' || n.id.includes('valid-target.md'))).toBe(true);

    // The empty wikilinks ([[]], [[.]], [[ ]]) should NOT have created any edges
    // If they did fuzzy match random files, we'd see edges here
    console.log('[Test] Initial edges:', initialState.edges);
    expect(initialState.edgeCount).toBe(0);

    // Find the test node by label
    const testNodeId = initialState.nodes.find(n => n.label === 'Test Node with Empty Wikilinks' || n.id.includes('test-node.md'))?.id;
    const validTargetId = initialState.nodes.find(n => n.label === 'Valid Target' || n.id.includes('valid-target.md'))?.id;
    if (!testNodeId || !validTargetId) {
      throw new Error(`Could not find test nodes. Available: ${JSON.stringify(initialState.nodes)}`);
    }
    console.log('[Test] Test node ID:', testNodeId);
    console.log('[Test] Valid target ID:', validTargetId);

    // Open the test node editor
    await appWindow.evaluate((nodeId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById(nodeId);
      if (node.length === 0) throw new Error('Test node not found');
      node.trigger('tap');
    }, testNodeId);

    // Wait for editor to open
    const editorWindowId = `window-${testNodeId}-editor`;
    const escapedEditorWindowId = editorWindowId.replace(/\./g, '\\.').replace(/\//g, '\\/');

    await expect.poll(async () => {
      return appWindow.evaluate((winId) => {
        return document.getElementById(winId) !== null;
      }, editorWindowId);
    }, { message: 'Waiting for editor', timeout: 5000 }).toBe(true);

    await appWindow.waitForSelector(`#${escapedEditorWindowId} .cm-editor`, { timeout: 5000 });
    console.log('[Test] Editor opened');

    // Now simulate editing the content - add more text with empty wikilinks
    await appWindow.evaluate((winId) => {
      const escapedWinId = CSS.escape(winId);
      const editorElement = document.querySelector(`#${escapedWinId} .cm-content`) as CodeMirrorElement | null;
      if (!editorElement) throw new Error('Editor not found');
      const cmView = editorElement.cmView?.view;
      if (!cmView) throw new Error('CodeMirror view not found');

      // Add more empty wikilinks at the end
      const doc = cmView.state.doc;
      cmView.dispatch({
        changes: { from: doc.length, insert: '\n\nMore empty wikilinks:\n[[]]  [[.]]  [[ ]]\n' },
        userEvent: 'input'
      });
    }, editorWindowId);

    // Wait for autosave and graph update
    await appWindow.waitForTimeout(1500);

    // Get graph state AFTER editing
    const stateAfterEdit = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return {
        nodeCount: cy.nodes().length,
        edgeCount: cy.edges().length,
        nodes: cy.nodes().map((n: NodeSingular) => ({ id: n.id(), label: n.data('label') })),
        edges: cy.edges().map((e) => ({ source: e.source().id(), target: e.target().id() }))
      };
    });

    console.log('[Test] State AFTER edit:', JSON.stringify(stateAfterEdit, null, 2));

    // CRITICAL BUG ASSERTIONS:
    // Filter out shadow nodes (editor anchors) - these are expected during editing
    const realNodesAfterEdit = stateAfterEdit.nodes.filter(n => !n.id.includes('-shadowNode'));
    console.log('[Test] Real nodes after edit (excluding shadows):', realNodesAfterEdit);

    // If the bug is present, node count will be > 2 (spurious nodes created)
    // If the bug is fixed, node count should still be 2
    expect(realNodesAfterEdit.length).toBe(2);
    expect(stateAfterEdit.edgeCount).toBe(0);

    // Verify no spurious nodes were created (e.g. image files)
    // Exclude shadow nodes and our test nodes
    const spuriousNodes = realNodesAfterEdit.filter(n =>
      !n.id.includes('test-node.md') && !n.id.includes('valid-target.md')
    );
    if (spuriousNodes.length > 0) {
      console.error('[Test] BUG DETECTED! Spurious nodes created:', spuriousNodes);
    }
    expect(spuriousNodes).toHaveLength(0);

    console.log('[Test] PASS: No spurious nodes created from empty wikilinks');
  });

  test('editing with empty wikilinks should not spawn random file nodes', async ({ appWindow }) => {
    test.setTimeout(120000);
    console.log('=== Testing edit-triggered spurious node creation ===');

    // Graph is already loaded by appWindow fixture
    // Capture node state BEFORE any edit
    const stateBefore = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return {
        nodeIds: cy.nodes().map((n: NodeSingular) => n.id()),
        nodes: cy.nodes().map((n: NodeSingular) => ({ id: n.id(), label: n.data('label') }))
      };
    });

    console.log('[Test] Node IDs before edit:', stateBefore.nodeIds);

    // Find the test node by label
    const testNodeId = stateBefore.nodes.find(n => n.label === 'Test Node with Empty Wikilinks' || n.id.includes('test-node.md'))?.id;
    if (!testNodeId) {
      throw new Error(`Could not find test node. Available: ${JSON.stringify(stateBefore.nodes)}`);
    }

    // Open the test node editor
    await appWindow.evaluate((nodeId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById(nodeId);
      if (node.length === 0) throw new Error('Test node not found');
      node.trigger('tap');
    }, testNodeId);

    // Wait for editor
    const editorWindowId = `window-${testNodeId}-editor`;
    await expect.poll(async () => {
      return appWindow.evaluate((winId) => {
        return document.getElementById(winId) !== null;
      }, editorWindowId);
    }, { message: 'Waiting for editor', timeout: 5000 }).toBe(true);

    // Trigger a save by making an edit
    await appWindow.evaluate((winId) => {
      const escapedWinId = CSS.escape(winId);
      const editorElement = document.querySelector(`#${escapedWinId} .cm-content`) as CodeMirrorElement | null;
      if (!editorElement) throw new Error('Editor not found');
      const cmView = editorElement.cmView?.view;
      if (!cmView) throw new Error('CodeMirror view not found');

      // Simple edit - just add a space
      const doc = cmView.state.doc;
      cmView.dispatch({
        changes: { from: doc.length, insert: ' ' },
        userEvent: 'input'
      });
    }, editorWindowId);

    // Wait for save and any graph delta processing
    await appWindow.waitForTimeout(1500);

    // Capture node IDs AFTER edit
    const nodeIdsAfter = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return cy.nodes().map((n: NodeSingular) => n.id());
    });

    console.log('[Test] Node IDs after edit:', nodeIdsAfter);

    // Find any NEW nodes that appeared (excluding shadow nodes which are expected during editing)
    const newNodes = nodeIdsAfter.filter(id =>
      !stateBefore.nodeIds.includes(id) && !id.includes('-shadowNode')
    );
    if (newNodes.length > 0) {
      console.error('[Test] BUG DETECTED! New spurious nodes created during edit:', newNodes);
    }

    // CRITICAL: No new nodes should have been created by the edit (shadow nodes are OK)
    expect(newNodes).toHaveLength(0);

    console.log('[Test] PASS: No spurious nodes spawned during edit');
  });

  test('adding valid wikilink should create edge, empty ones should not', async ({ appWindow }) => {
    test.setTimeout(120000);
    console.log('=== Testing valid vs empty wikilink behavior ===');

    // Graph is already loaded by appWindow fixture
    // Get initial state
    const initialState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return {
        edgeCount: cy.edges().length,
        nodes: cy.nodes().map((n: NodeSingular) => ({ id: n.id(), label: n.data('label') }))
      };
    });

    console.log('[Test] Initial edge count:', initialState.edgeCount);
    expect(initialState.edgeCount).toBe(0);

    // Find the test nodes by label
    const testNodeId = initialState.nodes.find(n => n.label === 'Test Node with Empty Wikilinks' || n.id.includes('test-node.md'))?.id;
    const validTargetId = initialState.nodes.find(n => n.label === 'Valid Target' || n.id.includes('valid-target.md'))?.id;
    if (!testNodeId || !validTargetId) {
      throw new Error(`Could not find test nodes. Available: ${JSON.stringify(initialState.nodes)}`);
    }
    console.log('[Test] Test node ID:', testNodeId);
    console.log('[Test] Valid target ID:', validTargetId);

    // Open the test node editor
    await appWindow.evaluate((nodeId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById(nodeId);
      if (node.length === 0) throw new Error('Test node not found');
      node.trigger('tap');
    }, testNodeId);

    // Wait for editor
    const editorWindowId = `window-${testNodeId}-editor`;
    await expect.poll(async () => {
      return appWindow.evaluate((winId) => {
        return document.getElementById(winId) !== null;
      }, editorWindowId);
    }, { message: 'Waiting for editor', timeout: 5000 }).toBe(true);

    // Add a VALID wikilink along with empty ones
    // Use the actual validTargetId in the wikilink
    await appWindow.evaluate(({ winId, targetId }) => {
      const escapedWinId = CSS.escape(winId);
      const editorElement = document.querySelector(`#${escapedWinId} .cm-content`) as CodeMirrorElement | null;
      if (!editorElement) throw new Error('Editor not found');
      const cmView = editorElement.cmView?.view;
      if (!cmView) throw new Error('CodeMirror view not found');

      const doc = cmView.state.doc;
      // Add both valid and empty wikilinks
      cmView.dispatch({
        changes: {
          from: doc.length,
          insert: `\n\nValid link: [[${targetId}]]\nEmpty links: [[]] [[.]] [[ ]]\n`
        },
        userEvent: 'input'
      });
    }, { winId: editorWindowId, targetId: validTargetId });

    // Wait for save and graph update
    await appWindow.waitForTimeout(1500);

    // Check final state
    const finalState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return {
        nodeCount: cy.nodes().length,
        edgeCount: cy.edges().length,
        nodes: cy.nodes().map((n: NodeSingular) => ({ id: n.id(), label: n.data('label') })),
        edges: cy.edges().map((e) => ({
          source: e.source().id(),
          target: e.target().id()
        }))
      };
    });

    console.log('[Test] Final state:', JSON.stringify(finalState, null, 2));

    // Filter out shadow nodes (editor anchors) - these are expected during editing
    const realNodeCount = finalState.nodes.filter(n => !n.id.includes('-shadowNode')).length;
    console.log('[Test] Real node count (excluding shadows):', realNodeCount);

    // Should have exactly 2 nodes still (no spurious nodes from empty wikilinks)
    expect(realNodeCount).toBe(2);

    // Should have exactly 1 edge (from the valid wikilink)
    expect(finalState.edgeCount).toBe(1);
    expect(finalState.edges[0]).toEqual({
      source: testNodeId,
      target: validTargetId
    });

    console.log('[Test] PASS: Valid wikilink created edge, empty ones were ignored');
  });
});

export { test };
