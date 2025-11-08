/**
 * Test utilities for working with GraphDelta and mocked Electron API in browser tests
 */
import type { Page } from '@playwright/test';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { GraphDelta } from '@/functional_graph/pure/types';

export interface ExtendedWindow extends Window {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: {
    graph?: {
      _updateCallback?: (delta: GraphDelta) => void;
    };
  };
}

/**
 * Sets up a mock Electron API in the browser before the app loads.
 * This mock includes all necessary file watching, graph, terminal, and position APIs.
 *
 * IMPORTANT: Call this BEFORE navigating to the app page using page.addInitScript
 */
export async function setupMockElectronAPI(page: Page): Promise<void> {
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        _graphState: { nodes: {}, edges: [] } as any,
        applyGraphDelta: async () => ({ success: true }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getState: async () => mockElectronAPI.graph._graphState,
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

    (window as unknown as { electronAPI: typeof mockElectronAPI }).electronAPI = mockElectronAPI;
  });
}

/**
 * Creates a sample GraphDelta with test nodes.
 * Returns an array of UpsertNode operations that can be sent to the graph.
 */
export function createTestGraphDelta(): GraphDelta {
  return [
    {
      type: 'UpsertNode' as const,
      nodeToUpsert: {
        relativeFilePathIsID: 'test-node-1.md',
        content: '# Introduction\\nThis is the introduction node.',
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
        content: '# Architecture\\nArchitecture documentation.',
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
        content: '# Core Principles\\nCore principles guide.',
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
        content: '# API Design\\nAPI design patterns.',
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
        content: '# Testing Guide\\nHow to test the system.',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: { _tag: 'None' } as const,
          position: { _tag: 'Some', value: { x: 900, y: 300 } } as const
        }
      }
    }
  ];
}

/**
 * Triggers a graph update by calling the electronAPI.graph._updateCallback
 * that was registered by VoiceTreeGraphView when it subscribed to graph updates.
 *
 * This simulates how the real app receives graph updates from the backend.
 * Also updates the mock graph state so that getState() returns the updated state.
 *
 * @param page - The Playwright page instance
 * @param graphDelta - The GraphDelta to send (use createTestGraphDelta() for a default set)
 */
export async function sendGraphDelta(page: Page, graphDelta: GraphDelta): Promise<void> {
  await page.evaluate((delta) => {
    const electronAPI = (window as unknown as ExtendedWindow).electronAPI;
    if (!electronAPI) throw new Error('electronAPI not available');

    // Access the internal callback that was registered via onGraphUpdate
    const mockGraphAPI = electronAPI.graph as {
      _updateCallback?: (delta: GraphDelta) => void;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _graphState: { nodes: Record<string, any>; edges: any[] };
    };

    // Update mock graph state based on delta
    delta.forEach((nodeDelta) => {
      if (nodeDelta.type === 'UpsertNode') {
        const node = nodeDelta.nodeToUpsert;
        mockGraphAPI._graphState.nodes[node.relativeFilePathIsID] = node;
      } else if (nodeDelta.type === 'DeleteNode') {
        delete mockGraphAPI._graphState.nodes[nodeDelta.nodeId];
      }
    });

    if (mockGraphAPI._updateCallback) {
      mockGraphAPI._updateCallback(delta);
      console.log('[Test] Triggered graph update via electronAPI callback');
    } else {
      console.error('[Test] No graph update callback registered!');
    }
  }, graphDelta);
}

/**
 * Waits for the Cytoscape instance to be initialized and ready.
 *
 * @param page - The Playwright page instance
 * @param timeout - Maximum time to wait in milliseconds (default: 10000)
 */
export async function waitForCytoscapeReady(page: Page, timeout = 10000): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as ExtendedWindow).cytoscapeInstance,
    { timeout }
  );
}

/**
 * Gets the current node count from the Cytoscape graph.
 *
 * @param page - The Playwright page instance
 * @returns The number of nodes in the graph
 */
export async function getNodeCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    return cy ? cy.nodes().length : 0;
  });
}
