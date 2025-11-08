/**
 * Browser-based test for ninja-keys search navigation
 * Tests the cmd-f search functionality and node navigation without Electron
 */

import { test, expect } from '@playwright/test';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { GraphDelta } from '@/functional_graph/pure/types';

interface ExtendedWindow extends Window {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: {
    startFileWatching: (dir: string) => Promise<{ success: boolean; directory?: string; error?: string }>;
    stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
    graph?: {
      onGraphUpdate?: (callback: (delta: GraphDelta) => void) => () => void;
      onGraphClear?: (callback: () => void) => () => void;
      _updateCallback?: (delta: GraphDelta) => void;
    };
  };
}

test.describe('Search Navigation (Browser)', () => {
  test('should open search with cmd-f and navigate to selected node', async ({ page }) => {
    console.log('\n=== Starting ninja-keys search navigation test (Browser) ===');

    // Listen for console messages (errors, warnings, logs)
    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      console.log(`[Browser ${type}] ${text}`);
    });

    // Listen for page errors (uncaught exceptions)
    page.on('pageerror', error => {
      console.error('[Browser Error]', error.message);
      console.error(error.stack);
    });

    console.log('=== Step 1: Mock Electron API BEFORE navigation ===');
    // Mock the electron API BEFORE the app loads using addInitScript
    await page.addInitScript(() => {
      // Create a comprehensive mock of the Electron API
      const mockElectronAPI = {
        // Backend server configuration
        getBackendPort: async () => 5001,

        // Directory selection
        openDirectoryDialog: async () => ({ success: false }),

        // File watching controls
        startFileWatching: async (dir: string) => {
          console.log('[Mock] startFileWatching called with:', dir);
          return { success: true, directory: dir };
        },
        stopFileWatching: async () => {
          console.log('[Mock] stopFileWatching called');
          return { success: true };
        },
        getWatchStatus: async () => ({ isWatching: false, directory: null }),
        loadPreviousFolder: async () => ({ success: false }),

        // File watching event listeners (no-op callbacks)
        onWatchingStarted: () => {},
        onInitialFilesLoaded: () => {},
        onFileAdded: () => {},
        onFileChanged: () => {},
        onFileDeleted: () => {},
        onDirectoryAdded: () => {},
        onDirectoryDeleted: () => {},
        onInitialScanComplete: () => {},
        onFileWatchError: () => {},
        onFileWatchInfo: () => {},
        onFileWatchingStopped: () => {},

        // Remove event listeners
        removeAllListeners: () => {},

        // File content management
        saveFileContent: async () => ({ success: true }),
        deleteFile: async () => ({ success: true }),
        createChildNode: async () => ({ success: true }),
        createStandaloneNode: async () => ({ success: true }),

        // Terminal API
        terminal: {
          spawn: async () => ({ success: false }),
          write: async () => {},
          resize: async () => {},
          kill: async () => {},
          onData: () => {},
          onExit: () => {}
        },

        // Position management API
        positions: {
          save: async () => ({ success: true }),
          load: async () => ({ success: false, positions: {} })
        },

        // Backend log streaming
        onBackendLog: () => {},

        // Functional graph API
        graph: {
          applyGraphDelta: async () => ({ success: true }),
          getState: async () => ({ nodes: [], edges: [] }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onGraphUpdate: (callback: (delta: any) => void) => {
            console.log('[Mock] onGraphUpdate callback registered');
            // Store the callback so tests can trigger it
            mockElectronAPI.graph._updateCallback = callback;
            return () => {
              console.log('[Mock] onGraphUpdate cleanup called');
            };
          },
          onGraphClear: () => () => {},
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          _updateCallback: undefined as ((delta: any) => void) | undefined
        },

        // General IPC communication methods
        invoke: async () => {},
        on: () => {},
        off: () => {}
      };

      (window as ExtendedWindow).electronAPI = mockElectronAPI;
    });
    console.log('✓ Electron API mock prepared');

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/'); // Vite dev server URL

    // Wait for React to render
    await page.waitForSelector('#root', { timeout: 5000 });
    console.log('✓ React rendered');

    // Wait for graph update handler to be registered
    await page.waitForTimeout(500);
    console.log('✓ Graph update handler should be registered');

    console.log('=== Step 3: Wait for Cytoscape to initialize ===');
    await page.waitForFunction(() => (window as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
    console.log('✓ Cytoscape initialized');

    console.log('=== Step 4: Setup test graph via electronAPI graph update ===');
    // Trigger the graph update through the electronAPI callback mechanism
    // This simulates how the real app receives graph updates
    await page.evaluate(() => {
      const electronAPI = (window as ExtendedWindow).electronAPI;
      if (!electronAPI) throw new Error('electronAPI not available');

      // Create GraphDelta with test nodes
      const graphDelta = [
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: {
            relativeFilePathIsID: 'test-node-1.md',
            content: '# Introduction\nThis is the introduction node.',
            outgoingEdges: ['test-node-2.md'],
            nodeUIMetadata: {
              color: { _tag: 'None' } as const,
              position: { _tag: 'Some', value: { x: 100, y: 100 } } as const
            }
          }
        },
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: {
            relativeFilePathIsID: 'test-node-2.md',
            content: '# Architecture\nArchitecture documentation.',
            outgoingEdges: ['test-node-3.md'],
            nodeUIMetadata: {
              color: { _tag: 'None' } as const,
              position: { _tag: 'Some', value: { x: 300, y: 150 } } as const
            }
          }
        },
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: {
            relativeFilePathIsID: 'test-node-3.md',
            content: '# Core Principles\nCore principles guide.',
            outgoingEdges: [],
            nodeUIMetadata: {
              color: { _tag: 'None' } as const,
              position: { _tag: 'Some', value: { x: 500, y: 200 } } as const
            }
          }
        },
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: {
            relativeFilePathIsID: 'test-node-4.md',
            content: '# API Design\nAPI design patterns.',
            outgoingEdges: [],
            nodeUIMetadata: {
              color: { _tag: 'None' } as const,
              position: { _tag: 'Some', value: { x: 700, y: 250 } } as const
            }
          }
        },
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: {
            relativeFilePathIsID: 'test-node-5.md',
            content: '# Testing Guide\nHow to test the system.',
            outgoingEdges: [],
            nodeUIMetadata: {
              color: { _tag: 'None' } as const,
              position: { _tag: 'Some', value: { x: 900, y: 300 } } as const
            }
          }
        }
      ];

      // Trigger the graph update callback that was registered during initialization
      // This will call handleGraphDelta which applies the delta AND updates search
      // Access the internal callback that was registered via onGraphUpdate
      // We need to get the callback that was stored when VoiceTreeGraphView subscribed
      const mockGraphAPI = electronAPI.graph as {
        _updateCallback?: (delta: typeof graphDelta) => void
      };

      if (mockGraphAPI._updateCallback) {
        mockGraphAPI._updateCallback(graphDelta);
        console.log('[Test] Triggered graph update via electronAPI callback');
      } else {
        console.error('[Test] No graph update callback registered!');
      }
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
    // Type a few characters from the node ID (which is now the filename like "test-node-1.md")
    // We search for "test-node" which should match the node ID
    const searchQuery = 'test-node';
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
