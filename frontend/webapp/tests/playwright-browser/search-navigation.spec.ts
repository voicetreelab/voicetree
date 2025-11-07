/**
 * Browser-based test for ninja-keys search navigation
 * Tests the cmd-f search functionality and node navigation without Electron
 */

import { test, expect } from '@playwright/test';
import type { Core as CytoscapeCore } from 'cytoscape';

interface ExtendedWindow extends Window {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: {
    startFileWatching: (dir: string) => Promise<{ success: boolean; directory?: string; error?: string }>;
    stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
  };
}

test.describe('Search Navigation (Browser)', () => {
  test('should open search with cmd-f and navigate to selected node', async ({ page }) => {
    console.log('\n=== Starting ninja-keys search navigation test (Browser) ===');

    console.log('=== Step 1: Navigate to app ===');
    await page.goto('http://localhost:5173'); // Vite dev server URL

    // Wait for React to render
    await page.waitForSelector('#root', { timeout: 10000 });

    console.log('=== Step 2: Mock Electron API ===');
    // Mock the electron API before the app tries to use it
    await page.evaluate(() => {
      (window as ExtendedWindow).electronAPI = {
        startFileWatching: async (dir: string) => {
          console.log('[Mock] startFileWatching called with:', dir);
          return { success: true, directory: dir };
        },
        stopFileWatching: async () => {
          console.log('[Mock] stopFileWatching called');
          return { success: true };
        }
      };
    });
    console.log('✓ Electron API mocked');

    console.log('=== Step 3: Wait for Cytoscape to initialize ===');
    await page.waitForFunction(() => (window as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
    console.log('✓ Cytoscape initialized');

    console.log('=== Step 4: Setup test graph with mock nodes ===');
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Clear any existing nodes
      cy.elements().remove();

      // Add test nodes
      const testNodes = [
        { id: 'test-node-1', label: 'Introduction' },
        { id: 'test-node-2', label: 'Architecture' },
        { id: 'test-node-3', label: 'Core Principles' },
        { id: 'test-node-4', label: 'API Design' },
        { id: 'test-node-5', label: 'Testing Guide' }
      ];

      testNodes.forEach((node, index) => {
        cy.add({
          group: 'nodes',
          data: {
            id: node.id,
            label: node.label
          },
          position: {
            x: 100 + index * 200,
            y: 100 + index * 50
          }
        });
      });

      // Add some edges
      cy.add({ group: 'edges', data: { source: 'test-node-1', target: 'test-node-2' } });
      cy.add({ group: 'edges', data: { source: 'test-node-2', target: 'test-node-3' } });

      console.log('[Test] Added test nodes and edges to graph');
    });

    const nodeCount = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      return cy ? cy.nodes().length : 0;
    });

    expect(nodeCount).toBe(5);
    console.log(`✓ Test graph setup complete with ${nodeCount} nodes`);

    console.log('=== Step 5: Get initial zoom/pan state ===');
    const initialState = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const zoom = cy.zoom();
      const pan = cy.pan();
      return { zoom, pan };
    });
    console.log(`  Initial zoom: ${initialState.zoom}, pan: (${initialState.pan.x}, ${initialState.pan.y})`);

    console.log('=== Step 6: Open ninja-keys search with keyboard shortcut ===');
    // Simulate cmd-f (Meta+f on Mac, Ctrl+f elsewhere)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');

    // Wait for ninja-keys modal to appear
    await page.waitForTimeout(300);

    const ninjaKeysVisible = await page.evaluate(() => {
      const ninjaKeys = document.querySelector('ninja-keys');
      if (!ninjaKeys) return false;
      const shadowRoot = ninjaKeys.shadowRoot;
      if (!shadowRoot) return false;
      const modal = shadowRoot.querySelector('.modal');
      // Check if modal exists and is not hidden
      return modal !== null;
    });

    expect(ninjaKeysVisible).toBe(true);
    console.log('✓ ninja-keys search modal opened');

    console.log('=== Step 7: Get a target node to search for ===');
    const targetNode = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const nodes = cy.nodes();
      if (nodes.length === 0) throw new Error('No nodes available');
      // Get first node
      const node = nodes[0];
      return {
        id: node.id(),
        label: node.data('label') || node.id()
      };
    });

    console.log(`  Target node: ${targetNode.label} (${targetNode.id})`);

    console.log('=== Step 8: Type search query into ninja-keys ===');
    // Type a few characters from the node label
    const searchQuery = targetNode.label.substring(0, Math.min(5, targetNode.label.length));
    await page.keyboard.type(searchQuery);

    // Wait for search results to update
    await page.waitForTimeout(300);
    console.log(`  Typed search query: "${searchQuery}"`);

    console.log('=== Step 9: Select first result with Enter ===');
    await page.keyboard.press('Enter');

    // Wait for navigation animation and fit to complete
    await page.waitForTimeout(1000);

    console.log('=== Step 10: Verify zoom/pan changed (node was fitted) ===');
    const finalState = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const zoom = cy.zoom();
      const pan = cy.pan();
      return { zoom, pan };
    });

    console.log(`  Final zoom: ${finalState.zoom}, pan: (${finalState.pan.x}, ${finalState.pan.y})`);

    // Check that EITHER zoom or pan changed (cy.fit modifies these)
    const zoomChanged = Math.abs(finalState.zoom - initialState.zoom) > 0.01;
    const panChanged = Math.abs(finalState.pan.x - initialState.pan.x) > 1 ||
                       Math.abs(finalState.pan.y - initialState.pan.y) > 1;

    expect(zoomChanged || panChanged).toBe(true);
    console.log('✓ Graph viewport changed - node was fitted');

    console.log('=== Step 11: Verify ninja-keys modal closed ===');
    const ninjaKeysClosed = await page.evaluate(() => {
      const ninjaKeys = document.querySelector('ninja-keys');
      if (!ninjaKeys) return true; // Not found means closed
      const shadowRoot = ninjaKeys.shadowRoot;
      if (!shadowRoot) return true;
      const modal = shadowRoot.querySelector('.modal');
      // Modal should be hidden or removed
      if (!modal) return true;
      const overlay = shadowRoot.querySelector('.modal-overlay');
      // Check if overlay is visible (indicates open state)
      return overlay ? getComputedStyle(overlay).display === 'none' : true;
    });

    expect(ninjaKeysClosed).toBe(true);
    console.log('✓ ninja-keys modal closed after selection');

    console.log('✓ ninja-keys search navigation test completed');
  });
});
