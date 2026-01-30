/**
 * Test: Add Link Context Menu in CodeMirror Editor
 *
 * Purpose: Verify the right-click context menu "Add Link" feature in the markdown editor:
 * 1. Right-clicking in the editor shows a context menu
 * 2. The context menu contains "Add Link" option
 * 3. Clicking "Add Link" inserts [[]] at cursor and opens wikilink autocomplete
 * 4. Typing filters the autocomplete suggestions
 * 5. Selecting a node from autocomplete inserts the wikilink
 * 6. The wikilink creates an edge in the Cytoscape graph
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
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-add-link-context-menu-'));

    // Create the watched folder (what config points to)
    const watchedFolder = path.join(tempUserDataPath, 'test-vault');
    await fs.mkdir(watchedFolder, { recursive: true });

    // Create the actual vault path with default suffix 'voicetree'
    const vaultPath = path.join(watchedFolder, 'voicetree');
    await fs.mkdir(vaultPath, { recursive: true });

    // Create the main test node (source node for the link)
    const sourceContent = `---
position:
  x: 100
  y: 100
---
# Source Node

This is the source node where we will add a link.

Some content here.
`;
    await fs.writeFile(path.join(vaultPath, 'source-node.md'), sourceContent, 'utf-8');

    // Create a target node that we will link to
    const targetContent = `---
position:
  x: 300
  y: 100
---
# Target Node

This is the target node we will link to.
`;
    await fs.writeFile(path.join(vaultPath, 'target-node.md'), targetContent, 'utf-8');

    // Create another node to verify autocomplete filtering
    const anotherContent = `---
position:
  x: 200
  y: 200
---
# Another Node

This is another node in the graph.
`;
    await fs.writeFile(path.join(vaultPath, 'another-node.md'), anotherContent, 'utf-8');

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
    // The vault has 3 files, so wait for at least 1 node to load
    await window.waitForFunction(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return false;
      return cy.nodes().length >= 1;
    }, { timeout: 15000 });

    await window.waitForTimeout(500);

    await use(window);
  }
});

test.describe('Add Link Context Menu', () => {
  test('should show context menu with Add Link option on right-click', async ({ appWindow }) => {
    test.setTimeout(120000);
    console.log('=== Testing Add Link context menu visibility ===');

    // Get initial graph state
    const initialState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return {
        nodeCount: cy.nodes().length,
        nodes: cy.nodes().map((n: NodeSingular) => ({ id: n.id(), label: n.data('label') }))
      };
    });

    console.log('[Test] Initial state:', JSON.stringify(initialState, null, 2));
    expect(initialState.nodeCount).toBe(3);

    // Find the source node
    const sourceNodeId = initialState.nodes.find(n =>
      n.label === 'Source Node' || n.id.includes('source-node.md')
    )?.id;
    if (!sourceNodeId) {
      throw new Error(`Could not find source node. Available: ${JSON.stringify(initialState.nodes)}`);
    }
    console.log('[Test] Source node ID:', sourceNodeId);

    // Open the source node editor by tapping the node
    await appWindow.evaluate((nodeId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById(nodeId);
      if (node.length === 0) throw new Error('Source node not found');
      node.trigger('tap');
    }, sourceNodeId);

    // Wait for editor to open
    const editorWindowId = `window-${sourceNodeId}-editor`;
    const escapedEditorWindowId = editorWindowId.replace(/\./g, '\\.').replace(/\//g, '\\/');

    await expect.poll(async () => {
      return appWindow.evaluate((winId) => {
        return document.getElementById(winId) !== null;
      }, editorWindowId);
    }, { message: 'Waiting for editor', timeout: 5000 }).toBe(true);

    await appWindow.waitForSelector(`#${escapedEditorWindowId} .cm-editor`, { timeout: 5000 });
    console.log('[Test] Editor opened');

    // Get the editor's bounding box to calculate where to right-click
    const editorBounds = await appWindow.evaluate((winId) => {
      const escapedWinId = CSS.escape(winId);
      const cmContent = document.querySelector(`#${escapedWinId} .cm-content`) as HTMLElement | null;
      if (!cmContent) return null;
      const rect = cmContent.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }, editorWindowId);

    expect(editorBounds).not.toBeNull();
    console.log('[Test] Editor bounds:', editorBounds);

    // Click inside the editor first to focus it
    await appWindow.mouse.click(editorBounds!.x + 50, editorBounds!.y + 50);
    await appWindow.waitForTimeout(100);

    // Right-click inside the editor to trigger context menu
    await appWindow.mouse.click(
      editorBounds!.x + 50,
      editorBounds!.y + 50,
      { button: 'right' }
    );
    await appWindow.waitForTimeout(300);

    // Verify context menu appears with "Add Link" option
    // The ctxmenu library creates menu elements in the body
    const menuVisible = await appWindow.evaluate(() => {
      // ctxmenu creates a menu with class "ctxmenu"
      const menu = document.querySelector('.ctxmenu');
      if (!menu) {
        console.log('[Test] No .ctxmenu element found');
        return false;
      }
      // Check if it contains "Add Link"
      const hasAddLink = menu.textContent?.includes('Add Link');
      console.log('[Test] Menu text:', menu.textContent);
      return hasAddLink;
    });

    expect(menuVisible).toBe(true);
    console.log('[Test] Context menu with Add Link is visible');

    // Take screenshot of context menu
    await appWindow.screenshot({
      path: path.join(PROJECT_ROOT, 'e2e-tests/screenshots/add-link-context-menu.png')
    });
  });

  test('clicking Add Link should insert [[]] and open autocomplete', async ({ appWindow }) => {
    test.setTimeout(120000);
    console.log('=== Testing Add Link inserts wikilink and opens autocomplete ===');

    // Get initial state
    const initialState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return {
        nodes: cy.nodes().map((n: NodeSingular) => ({ id: n.id(), label: n.data('label') }))
      };
    });

    // Find the source node
    const sourceNodeId = initialState.nodes.find(n =>
      n.label === 'Source Node' || n.id.includes('source-node.md')
    )?.id;
    if (!sourceNodeId) {
      throw new Error(`Could not find source node. Available: ${JSON.stringify(initialState.nodes)}`);
    }

    // Open the source node editor
    await appWindow.evaluate((nodeId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById(nodeId);
      if (node.length === 0) throw new Error('Source node not found');
      node.trigger('tap');
    }, sourceNodeId);

    // Wait for editor
    const editorWindowId = `window-${sourceNodeId}-editor`;
    const escapedEditorWindowId = editorWindowId.replace(/\./g, '\\.').replace(/\//g, '\\/');

    await expect.poll(async () => {
      return appWindow.evaluate((winId) => {
        return document.getElementById(winId) !== null;
      }, editorWindowId);
    }, { message: 'Waiting for editor', timeout: 5000 }).toBe(true);

    await appWindow.waitForSelector(`#${escapedEditorWindowId} .cm-editor`, { timeout: 5000 });
    console.log('[Test] Editor opened');

    // Get content before adding link
    const contentBefore = await appWindow.evaluate((winId) => {
      const escapedWinId = CSS.escape(winId);
      const editorElement = document.querySelector(`#${escapedWinId} .cm-content`) as CodeMirrorElement | null;
      if (!editorElement) return null;
      const cmView = editorElement.cmView?.view;
      if (!cmView) return null;
      return cmView.state.doc.toString();
    }, editorWindowId);

    console.log('[Test] Content before:', contentBefore);
    expect(contentBefore).not.toContain('[[]]');

    // Get editor bounds and right-click
    const editorBounds = await appWindow.evaluate((winId) => {
      const escapedWinId = CSS.escape(winId);
      const cmContent = document.querySelector(`#${escapedWinId} .cm-content`) as HTMLElement | null;
      if (!cmContent) return null;
      const rect = cmContent.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }, editorWindowId);

    expect(editorBounds).not.toBeNull();

    // Click to focus, then right-click
    await appWindow.mouse.click(editorBounds!.x + 50, editorBounds!.y + 50);
    await appWindow.waitForTimeout(100);

    await appWindow.mouse.click(
      editorBounds!.x + 50,
      editorBounds!.y + 50,
      { button: 'right' }
    );
    await appWindow.waitForTimeout(300);

    // Click the "Add Link" menu item using Playwright locator (matches real user behavior)
    const addLinkMenuItem = appWindow.locator('.ctxmenu li').filter({ hasText: 'Add Link' });
    await expect(addLinkMenuItem).toBeVisible({ timeout: 2000 });
    await addLinkMenuItem.click();

    await appWindow.waitForTimeout(500);

    // Verify [[ ]] was inserted
    const contentAfter = await appWindow.evaluate((winId) => {
      const escapedWinId = CSS.escape(winId);
      const editorElement = document.querySelector(`#${escapedWinId} .cm-content`) as CodeMirrorElement | null;
      if (!editorElement) return null;
      const cmView = editorElement.cmView?.view;
      if (!cmView) return null;
      return cmView.state.doc.toString();
    }, editorWindowId);

    console.log('[Test] Content after Add Link:', contentAfter);
    expect(contentAfter).toContain('[[]]');
    console.log('[Test] [[]] was inserted');

    // Verify autocomplete picker is visible
    const autocompleteVisible = await appWindow.evaluate(() => {
      const autocomplete = document.querySelector('.cm-tooltip-autocomplete');
      if (!autocomplete) {
        console.log('[Test] No .cm-tooltip-autocomplete found');
        return false;
      }
      const style = window.getComputedStyle(autocomplete);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });

    expect(autocompleteVisible).toBe(true);
    console.log('[Test] Autocomplete picker is visible');

    // Take screenshot showing autocomplete
    await appWindow.screenshot({
      path: path.join(PROJECT_ROOT, 'e2e-tests/screenshots/add-link-autocomplete-open.png')
    });
  });

  test('full flow: Add Link -> filter -> select -> edge created', async ({ appWindow }) => {
    test.setTimeout(120000);
    console.log('=== Testing full Add Link flow with edge creation ===');

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

    // Find node IDs
    const sourceNodeId = initialState.nodes.find(n =>
      n.label === 'Source Node' || n.id.includes('source-node.md')
    )?.id;
    const targetNodeId = initialState.nodes.find(n =>
      n.label === 'Target Node' || n.id.includes('target-node.md')
    )?.id;

    if (!sourceNodeId || !targetNodeId) {
      throw new Error(`Could not find nodes. Available: ${JSON.stringify(initialState.nodes)}`);
    }
    console.log('[Test] Source node ID:', sourceNodeId);
    console.log('[Test] Target node ID:', targetNodeId);

    // Open the source node editor
    await appWindow.evaluate((nodeId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById(nodeId);
      if (node.length === 0) throw new Error('Source node not found');
      node.trigger('tap');
    }, sourceNodeId);

    // Wait for editor
    const editorWindowId = `window-${sourceNodeId}-editor`;
    const escapedEditorWindowId = editorWindowId.replace(/\./g, '\\.').replace(/\//g, '\\/');

    await expect.poll(async () => {
      return appWindow.evaluate((winId) => {
        return document.getElementById(winId) !== null;
      }, editorWindowId);
    }, { message: 'Waiting for editor', timeout: 5000 }).toBe(true);

    await appWindow.waitForSelector(`#${escapedEditorWindowId} .cm-editor`, { timeout: 5000 });
    console.log('[Test] Editor opened');

    // Get editor bounds
    const editorBounds = await appWindow.evaluate((winId) => {
      const escapedWinId = CSS.escape(winId);
      const cmContent = document.querySelector(`#${escapedWinId} .cm-content`) as HTMLElement | null;
      if (!cmContent) return null;
      const rect = cmContent.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }, editorWindowId);

    expect(editorBounds).not.toBeNull();

    // Click to focus, then right-click to open context menu
    await appWindow.mouse.click(editorBounds!.x + 50, editorBounds!.y + 50);
    await appWindow.waitForTimeout(100);

    await appWindow.mouse.click(
      editorBounds!.x + 50,
      editorBounds!.y + 50,
      { button: 'right' }
    );
    await appWindow.waitForTimeout(300);

    // Click "Add Link" menu item using Playwright locator (matches real user behavior)
    const addLinkMenuItem = appWindow.locator('.ctxmenu li').filter({ hasText: 'Add Link' });
    await expect(addLinkMenuItem).toBeVisible({ timeout: 2000 });
    await addLinkMenuItem.click();

    await appWindow.waitForTimeout(500);

    // Verify autocomplete is open
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        return document.querySelector('.cm-tooltip-autocomplete') !== null;
      });
    }, { message: 'Waiting for autocomplete', timeout: 3000 }).toBe(true);

    // Type "Target" to filter the autocomplete to show the target node
    await appWindow.keyboard.type('Target');

    // Wait for autocomplete to filter and show Target Node option
    const autocompleteTooltip = appWindow.locator('.cm-tooltip-autocomplete');
    await expect(autocompleteTooltip).toContainText('Target Node', { timeout: 3000 });
    console.log('[Test] Target Node appears in autocomplete');

    // Take screenshot before selection
    await appWindow.screenshot({
      path: path.join(PROJECT_ROOT, 'e2e-tests/screenshots/add-link-filtered-autocomplete.png')
    });

    // Select the first (or only) option by pressing Enter
    await appWindow.keyboard.press('Enter');
    await appWindow.waitForTimeout(500);

    // Verify the wikilink was completed
    const contentAfterSelection = await appWindow.evaluate((winId) => {
      const escapedWinId = CSS.escape(winId);
      const editorElement = document.querySelector(`#${escapedWinId} .cm-content`) as CodeMirrorElement | null;
      if (!editorElement) return null;
      const cmView = editorElement.cmView?.view;
      if (!cmView) return null;
      return cmView.state.doc.toString();
    }, editorWindowId);

    console.log('[Test] Content after selection:', contentAfterSelection);
    // The wikilink should contain the target node reference (inserted as relative path)
    expect(contentAfterSelection).toContain('[[');
    expect(contentAfterSelection).toContain('target-node.md');
    expect(contentAfterSelection).toContain(']]');

    // Wait for autosave and graph update
    await appWindow.waitForTimeout(1500);

    // Verify edge was created in Cytoscape graph
    // Filter out shadow node edges (created by editors) - they have 'shadowNode' in the target ID
    const finalState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const allEdges = cy.edges().map(e => ({
        source: e.source().id(),
        target: e.target().id()
      }));
      // Filter to only real edges (not shadow node edges)
      const realEdges = allEdges.filter(e => !e.target.includes('shadowNode'));
      return {
        totalEdgeCount: allEdges.length,
        realEdgeCount: realEdges.length,
        realEdges
      };
    });

    console.log('[Test] Total edge count (including shadow):', finalState.totalEdgeCount);
    console.log('[Test] Real edge count:', finalState.realEdgeCount);
    console.log('[Test] Real edges:', JSON.stringify(finalState.realEdges, null, 2));

    expect(finalState.realEdgeCount).toBe(1);
    expect(finalState.realEdges[0].source).toBe(sourceNodeId);
    expect(finalState.realEdges[0].target).toBe(targetNodeId);

    console.log('[Test] Edge successfully created from source to target');

    // Take final screenshot showing the graph with edge
    await appWindow.screenshot({
      path: path.join(PROJECT_ROOT, 'e2e-tests/screenshots/add-link-edge-created.png')
    });
  });
});

export { test };
