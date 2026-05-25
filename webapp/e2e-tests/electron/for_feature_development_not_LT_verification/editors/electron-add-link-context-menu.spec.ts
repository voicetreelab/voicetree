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

import { expect } from '@playwright/test';
import * as path from 'path';
import type { NodeSingular } from 'cytoscape';
import { PROJECT_ROOT, test } from './electron-add-link-context-menu/fixtures';
import type { CodeMirrorElement, ExtendedWindow } from './electron-add-link-context-menu/fixtures';

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
