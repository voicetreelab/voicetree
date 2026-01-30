/**
 * Test: Child Node Wikilink Sync to Parent Editor
 *
 * Tests the 4-layer state sync (EDITOR <-> MEM <-> GRAPH UI <-> FS):
 * 1. Parent editor is open
 * 2. Create child node from UI (GRAPH UI CHANGE path)
 * 3. Parent editor should immediately show wikilink to child
 * 4. Typing in parent editor should preserve the wikilink
 *
 * Screenshots are taken at each step for visual verification.
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
  // Create temp userData directory with embedded vault + config
  // The config auto-loads the vault during app initialization
  // IMPORTANT: Files must be in {watchedFolder}/voicetree/ due to default vaultSuffix
  electronApp: async ({}, use, testInfo) => {
    // Create temp userData directory
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-wikilink-sync-'));

    // Create the watched folder (what config points to)
    const watchedFolder = path.join(tempUserDataPath, 'test-vault');
    await fs.mkdir(watchedFolder, { recursive: true });

    // Create the actual vault path with default suffix 'voicetree'
    // The app looks for .md files in {watchedFolder}/voicetree/
    const vaultPath = path.join(watchedFolder, 'voicetree');
    await fs.mkdir(vaultPath, { recursive: true });

    // Create a parent node with some content
    const parentContent = '# Parent Node\n\nThis is the parent node content.\n\nSome more text here.';
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
    });

    await window.waitForLoadState('domcontentloaded', { timeout: 60000 });
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 20000 });
    await window.waitForTimeout(500); // Give extra time for auto-load to complete

    await use(window);
  }
});

test.describe('Child Node Wikilink Sync', () => {
  test('parent editor should show wikilink when child is created, and preserve it on edit', async ({ appWindow, testVaultPath }) => {
    test.setTimeout(120000);
    console.log('=== Testing child wikilink sync to parent editor ===');
    console.log('[Test] Vault path:', testVaultPath);

    // Create screenshots directory
    const screenshotsDir = path.join(PROJECT_ROOT, 'e2e-tests/screenshots/wikilink-sync');
    await fs.mkdir(screenshotsDir, { recursive: true });

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

    // Verify parent node exists
    const initialState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return {
        nodeCount: cy.nodes().length,
        nodes: cy.nodes().map((n: NodeSingular) => ({ id: n.id(), label: n.data('label') }))
      };
    });

    console.log('[Test] Initial state:', JSON.stringify(initialState, null, 2));
    // Node IDs are relative to watchedFolder, not vaultPath
    // Since file is at {watchedFolder}/voicetree/parent.md, node ID is voicetree/parent.md
    expect(initialState.nodes.some(n => n.id === 'voicetree/parent.md')).toBe(true);

    // Screenshot 1: Initial graph state
    await appWindow.screenshot({ path: path.join(screenshotsDir, '1-initial-graph.png') });
    console.log('[Test] Screenshot 1: Initial graph');

    // Open parent editor by clicking the node
    await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById('voicetree/parent.md');
      if (node.length === 0) throw new Error('Parent node not found');
      node.trigger('tap');
    });

    // Wait for editor to open
    const editorWindowId = 'window-voicetree/parent.md-editor';
    const escapedEditorWindowId = editorWindowId.replace(/\./g, '\\.').replace(/\//g, '\\/');

    await expect.poll(async () => {
      return appWindow.evaluate((winId) => {
        return document.getElementById(winId) !== null;
      }, editorWindowId);
    }, { message: 'Waiting for editor', timeout: 5000 }).toBe(true);

    await appWindow.waitForSelector(`#${escapedEditorWindowId} .cm-editor`, { timeout: 5000 });
    console.log('[Test] Parent editor opened');

    // Screenshot 2: Parent editor open (before creating child)
    await appWindow.screenshot({ path: path.join(screenshotsDir, '2-parent-editor-before-child.png') });
    console.log('[Test] Screenshot 2: Parent editor before child');

    // Get editor content before creating child
    const contentBeforeChild = await appWindow.evaluate((winId) => {
      const escapedWinId = CSS.escape(winId);
      const editorElement = document.querySelector(`#${escapedWinId} .cm-content`) as CodeMirrorElement | null;
      if (!editorElement) return null;
      const cmView = editorElement.cmView?.view;
      if (!cmView) return null;
      return cmView.state.doc.toString();
    }, editorWindowId);

    console.log('[Test] Editor content before child:', contentBeforeChild);
    expect(contentBeforeChild).not.toContain('[['); // No wikilinks yet

    // Create child node (simulating GRAPH UI CHANGE)
    console.log('[Test] Creating child node...');
    const childNodeId = await appWindow.evaluate(async () => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');

      const currentGraph = await api.main.getGraph();
      if (!currentGraph) throw new Error('No graph state');

      const parentNode = currentGraph.nodes['voicetree/parent.md'];
      if (!parentNode) throw new Error('Parent node not found in graph');

      // Create child node
      const childId = 'voicetree/parent.md_0.md';
      const newNode = {
        relativeFilePathIsID: childId,
        outgoingEdges: [] as const,
        contentWithoutYamlOrLinks: '# Child Node\n\nThis is the child.',
        nodeUIMetadata: {
          color: { _tag: 'None' } as const,
          position: { _tag: 'None' } as const,
          additionalYAMLProps: new Map()
        }
      };

      // Create updated parent with edge to child (adds wikilink)
      const updatedParent = {
        ...parentNode,
        outgoingEdges: [...parentNode.outgoingEdges, { targetId: childId, label: '' }]
      };

      const graphDelta = [
        { type: 'UpsertNode' as const, nodeToUpsert: newNode, previousNode: { _tag: 'None' } as const },
        { type: 'UpsertNode' as const, nodeToUpsert: updatedParent, previousNode: { _tag: 'Some', value: parentNode } as const }
      ];

      // This should trigger GRAPH UI CHANGE path:
      // 1. updateFloatingEditors (update parent editor with wikilink)
      // 2. applyGraphDeltaToDBThroughMem (write to FS)
      await api.main.applyGraphDeltaToDBThroughMemUIAndEditorExposed(graphDelta);

      return childId;
    });

    console.log('[Test] Child node created:', childNodeId);

    // Wait for UI to update
    await appWindow.waitForTimeout(500);

    // Screenshot 3: After creating child (editor should show wikilink)
    await appWindow.screenshot({ path: path.join(screenshotsDir, '3-parent-editor-after-child.png') });
    console.log('[Test] Screenshot 3: Parent editor after child created');

    // CRITICAL: Check if editor now has the wikilink
    const contentAfterChild = await appWindow.evaluate((winId) => {
      const escapedWinId = CSS.escape(winId);
      const editorElement = document.querySelector(`#${escapedWinId} .cm-content`) as CodeMirrorElement | null;
      if (!editorElement) return null;
      const cmView = editorElement.cmView?.view;
      if (!cmView) return null;
      return cmView.state.doc.toString();
    }, editorWindowId);

    console.log('[Test] Editor content after child:', contentAfterChild);

    // THE KEY ASSERTION: Editor should now contain the wikilink to child
    expect(contentAfterChild).toContain('[[voicetree/parent.md_0.md]]');
    console.log('[Test] PASS: Editor shows wikilink to child!');

    // Screenshot 4: Close-up of editor content
    const editorElement = await appWindow.$(`#${escapedEditorWindowId}`);
    if (editorElement) {
      await editorElement.screenshot({ path: path.join(screenshotsDir, '4-editor-with-wikilink.png') });
      console.log('[Test] Screenshot 4: Editor close-up with wikilink');
    }

    // Now test that editing preserves the wikilink
    console.log('[Test] Adding text to editor...');
    await appWindow.evaluate((winId) => {
      const escapedWinId = CSS.escape(winId);
      const editorElement = document.querySelector(`#${escapedWinId} .cm-content`) as CodeMirrorElement | null;
      if (!editorElement) throw new Error('Editor not found');
      const cmView = editorElement.cmView?.view;
      if (!cmView) throw new Error('CodeMirror view not found');

      // Add text at the end (simulating user typing)
      const doc = cmView.state.doc;
      cmView.dispatch({
        changes: { from: doc.length, insert: '\n\nUser added this text.' },
        userEvent: 'input' // Mark as user input to trigger autosave
      });
    }, editorWindowId);

    // Wait for autosave (300ms default + buffer)
    await appWindow.waitForTimeout(800);

    // Screenshot 5: After editing
    await appWindow.screenshot({ path: path.join(screenshotsDir, '5-after-editing.png') });
    console.log('[Test] Screenshot 5: After user edit');

    // Verify wikilink is still present in editor
    const contentAfterEdit = await appWindow.evaluate((winId) => {
      const escapedWinId = CSS.escape(winId);
      const editorElement = document.querySelector(`#${escapedWinId} .cm-content`) as CodeMirrorElement | null;
      if (!editorElement) return null;
      const cmView = editorElement.cmView?.view;
      if (!cmView) return null;
      return cmView.state.doc.toString();
    }, editorWindowId);

    console.log('[Test] Editor content after edit:', contentAfterEdit);
    expect(contentAfterEdit).toContain('[[voicetree/parent.md_0.md]]');
    expect(contentAfterEdit).toContain('User added this text.');
    console.log('[Test] PASS: Wikilink preserved after edit!');

    // Verify file on disk also has the wikilink
    const fileContent = await fs.readFile(path.join(testVaultPath, 'parent.md'), 'utf-8');
    console.log('[Test] File content on disk:', fileContent);
    expect(fileContent).toContain('[[voicetree/parent.md_0.md]]');
    expect(fileContent).toContain('User added this text.');
    console.log('[Test] PASS: File on disk has wikilink and user edit!');

    // Verify child file was created
    // childNodeId is voicetree/parent.md_0.md, but testVaultPath already includes voicetree/
    // So we need to strip the voicetree/ prefix
    const childFilename = childNodeId.replace(/^voicetree\//, '');
    const childFileContent = await fs.readFile(path.join(testVaultPath, childFilename), 'utf-8');
    expect(childFileContent).toContain('# Child Node');
    console.log('[Test] PASS: Child file created on disk!');

    // Screenshot 6: Final state
    await appWindow.screenshot({ path: path.join(screenshotsDir, '6-final-state.png') });
    console.log('[Test] Screenshot 6: Final state');

    console.log('=== Test completed successfully ===');
    console.log(`Screenshots saved to: ${screenshotsDir}`);
  });
});

export { test };
