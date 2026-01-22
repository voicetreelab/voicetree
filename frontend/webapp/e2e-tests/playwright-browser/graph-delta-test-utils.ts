/**
 * Test utilities for working with GraphDelta and mocked Electron API in browser e2e-tests
 */
import type { Page } from '@playwright/test';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { GraphDelta } from '@/pure/graph';

export interface ExtendedWindow extends Window {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: {
    graph?: {
      _updateCallback?: (delta: GraphDelta) => void;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _triggerIpc?: (channel: string, ...args: any[]) => void;
  };
  terminalStoreAPI?: {
    addTerminal: (data: unknown) => void;
    createTerminalData: (params: { attachedToNodeId: string; terminalCount: number; title: string }) => unknown;
    getTerminalId: (data: unknown) => string;
    getShadowNodeId: (id: string) => string;
  };
  voiceTreeGraphView?: {
    navigationService?: {
      setLastCreatedNodeId: (id: string) => void;
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
      // Main API (RPC-based, matches mainAPI from functional/shell/main/api.ts)
      main: {
        // Graph operations
        applyGraphDeltaToDBAndMem: async () => ({ success: true }),
        applyGraphDeltaToDBThroughMem: async (delta: GraphDelta) => {
          // Simulate what the real implementation does: write to DB, then trigger graph update via file watcher
          // Update mock graph state
          delta.forEach((nodeDelta) => {
            if (nodeDelta.type === 'UpsertNode') {
              const node = nodeDelta.nodeToUpsert;
              mockElectronAPI.graph._graphState.nodes[node.absoluteFilePathIsID] = node;
            } else if (nodeDelta.type === 'DeleteNode') {
              delete mockElectronAPI.graph._graphState.nodes[nodeDelta.nodeId];
            }
          });

          // Trigger graph update callback (simulating file watcher event)
          if (mockElectronAPI.graph._updateCallback) {
            // Use setTimeout to simulate async file system operation
            setTimeout(() => {
              mockElectronAPI.graph._updateCallback?.(delta);
            }, 10);
          }
          return { success: true };
        },
        getGraph: async () => {
          // Return the current graph state that's updated by sendGraphDelta
          return mockElectronAPI.graph._graphState;
        },
        getNode: async (nodeId: string) => {
          // Return a specific node from the graph state
          return mockElectronAPI.graph._graphState.nodes[nodeId];
        },

        // Settings operations
        loadSettings: async () => ({
          terminalSpawnPathRelativeToWatchedDirectory: '../',
          agents: [
            { name: 'Claude', command: './claude.sh' }, //todo, old
            { name: 'Gemini', command: 'gemini' }
          ],
          shiftEnterSendsOptionEnter: true
        }),
        saveSettings: async () => ({ success: true }),

        // Node position saving
        saveNodePositions: async () => ({ success: true }),

        // File watching controls
        startFileWatching: async (dir: string) => {
          console.log('[Mock] startFileWatching called with:', dir);
          return { success: true, directory: dir };
        },
        stopFileWatching: async () => {
          console.log('[Mock] stopFileWatching called');
          return { success: true };
        },
        getWatchStatus: async () => ({ isWatching: true, directory: '/mock/watched/directory' }),
        loadPreviousFolder: async () => ({ success: false }),

        // Backend server configuration
        getBackendPort: async () => 5001,

        // Agent metrics
        getMetrics: async () => ({ sessions: [] }),

        // Frontend ready signal (no-op for tests)
        markFrontendReady: async () => {},

        // Vault path methods (required for VaultPathSelector and node creation)
        getVaultPaths: async (): Promise<readonly string[]> => ['/mock/watched/directory'],
        getWritePath: async () => ({
          _tag: 'Some' as const,
          value: '/mock/watched/directory'
        }),
        setWritePath: async () => ({ success: true }),
        getShowAllPaths: async (): Promise<readonly string[]> => [],
        toggleShowAll: async () => ({ success: true, showAll: false }),
        addReadOnLinkPath: async () => ({ success: true }),
        removeReadOnLinkPath: async () => ({ success: true }),

        // Image loading - returns a placeholder test image (100x100 blue square)
        readImageAsDataUrl: async (_filePath: string): Promise<string> => {
          // 100x100 light blue (#4A90D9) PNG as base64 (placeholder for tests)
          return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkAQMAAABKLAcXAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURUqQ2f///4FAZ9QAAAABYktHRAH/Ai3eAAAAB3RJTUUH6gESAAsWq1tIegAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0wMS0xOFQwMDoxMToyMiswMDowMKbMSowAAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMDEtMThUMDA6MTE6MjIrMDA6MDDXkfIwAAAAKHRFWHRkYXRlOnRpbWVzdGFtcAAyMDI2LTAxLTE4VDAwOjExOjIyKzAwOjAwgITT7wAAABRJREFUOMtjYBgFo2AUjIJRQE8AAAV4AAEpcbn8AAAAAElFTkSuQmCC';
        },

        // UI-edge graph delta operations (used by handleUIActions.ts)
        applyGraphDeltaToDBThroughMemUIAndEditorExposed: async (delta: GraphDelta) => {
          // Simulate what the real implementation does: write to DB, then trigger graph update via file watcher
          // Update mock graph state
          delta.forEach((nodeDelta) => {
            if (nodeDelta.type === 'UpsertNode') {
              const node = nodeDelta.nodeToUpsert;
              mockElectronAPI.graph._graphState.nodes[node.absoluteFilePathIsID] = node;
            } else if (nodeDelta.type === 'DeleteNode') {
              delete mockElectronAPI.graph._graphState.nodes[nodeDelta.nodeId];
            }
          });

          // Trigger graph update callback (simulating file watcher event)
          if (mockElectronAPI.graph._updateCallback) {
            // Use setTimeout to simulate async file system operation
            setTimeout(() => {
              mockElectronAPI.graph._updateCallback?.(delta);
            }, 10);
          }
          return { success: true };
        },

        // Another UI-edge method (used by modifyNodeContentFromFloatingEditor.ts)
        applyGraphDeltaToDBThroughMemAndUIExposed: async (delta: GraphDelta) => {
          // Same as above - update mock graph state and trigger callback
          delta.forEach((nodeDelta) => {
            if (nodeDelta.type === 'UpsertNode') {
              const node = nodeDelta.nodeToUpsert;
              mockElectronAPI.graph._graphState.nodes[node.absoluteFilePathIsID] = node;
            } else if (nodeDelta.type === 'DeleteNode') {
              delete mockElectronAPI.graph._graphState.nodes[nodeDelta.nodeId];
            }
          });

          if (mockElectronAPI.graph._updateCallback) {
            setTimeout(() => {
              mockElectronAPI.graph._updateCallback?.(delta);
            }, 10);
          }
          return { success: true };
        },

        // Terminal state mutations (renderer -> main for MCP and tests)
        updateTerminalIsDone: async () => {},
        updateTerminalPinned: async () => {},
        updateTerminalActivityState: async () => {},
        removeTerminalFromRegistry: async () => {},

      },

      // File watching event listeners (no-op callbacks)
      onWatchingStarted: () => {},
      onFileWatchingStopped: () => {},

      // Remove event listeners
      removeAllListeners: () => {},

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
         
        getState: async () => mockElectronAPI.graph._graphState,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onGraphUpdate: (callback: (delta: any) => void) => {
          console.log('[Mock] onGraphUpdate callback registered');
          // Store the callback so e2e-tests can trigger it
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
      // Store callbacks for IPC events (e.g., 'ui:call')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _ipcListeners: {} as Record<string, ((event: unknown, ...args: any[]) => void)[]>,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      on: (channel: string, callback: (event: unknown, ...args: any[]) => void) => {
        if (!mockElectronAPI._ipcListeners[channel]) {
          mockElectronAPI._ipcListeners[channel] = [];
        }
        mockElectronAPI._ipcListeners[channel].push(callback);
        console.log(`[Mock] IPC listener registered for channel: ${channel}`);
        return () => {
          const idx = mockElectronAPI._ipcListeners[channel]?.indexOf(callback);
          if (idx !== undefined && idx >= 0) {
            mockElectronAPI._ipcListeners[channel].splice(idx, 1);
          }
        };
      },
      off: () => {},
      // Helper to trigger IPC events for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _triggerIpc: (channel: string, ...args: any[]) => {
        const listeners = mockElectronAPI._ipcListeners[channel] || [];
        listeners.forEach(cb => cb(null, ...args));
      }
    };

    (window as unknown as { electronAPI: typeof mockElectronAPI }).electronAPI = mockElectronAPI;
  });
}

/**
 * Expose TerminalStore API to window after page has loaded
 * Must be called AFTER page.goto() and AFTER app modules have loaded
 */
export async function exposeTerminalStoreAPI(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // Import the actual modules now that Vite has loaded them
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const terminalStore = await import('/src/shell/edge/UI-edge/state/TerminalStore.ts' as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const types = await import('/src/shell/edge/UI-edge/floating-windows/types.ts' as any);

    (window as unknown as {
      terminalStoreAPI: {
        addTerminal: (data: unknown) => void;
        createTerminalData: (params: { attachedToNodeId: string; terminalCount: number; title: string }) => unknown;
        getTerminalId: (data: unknown) => string;
        getShadowNodeId: (id: string) => string;
      };
       
    }).terminalStoreAPI = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      addTerminal: (data: unknown) => terminalStore.addTerminal(data as any),
      createTerminalData: types.createTerminalData,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getTerminalId: (data: unknown) => types.getTerminalId(data as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getShadowNodeId: (id: string) => types.getShadowNodeId(id as any)
    };
    console.log('[Mock] TerminalStore API exposed for browser tests');
  });
}

/**
 * Waits for the terminalStoreAPI to be available on the window object.
 * The API is exposed asynchronously after page loads.
 */
export async function waitForTerminalStoreAPI(page: Page, timeout = 5000): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as ExtendedWindow).terminalStoreAPI !== undefined,
    { timeout }
  );
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
        absoluteFilePathIsID: 'test-node-1.md',
        contentWithoutYamlOrLinks: '# Introduction\nThis is the introduction node.',
        outgoingEdges: [{ targetId: 'test-node-2.md', label: '' }],
        nodeUIMetadata: {
          color: { _tag: 'None' } as const,
          position: { _tag: 'Some', value: { x: 100, y: 100 } } as const,
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      },
      previousNode: { _tag: 'None' } as const
    },
    {
      type: 'UpsertNode' as const,
      nodeToUpsert: {
        absoluteFilePathIsID: 'test-node-2.md',
        contentWithoutYamlOrLinks: '# Architecture\nArchitecture documentation.',
        outgoingEdges: [{ targetId: 'test-node-3.md', label: '' }],
        nodeUIMetadata: {
          color: { _tag: 'None' } as const,
          position: { _tag: 'Some', value: { x: 300, y: 150 } } as const,
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      },
      previousNode: { _tag: 'None' } as const
    },
    {
      type: 'UpsertNode' as const,
      nodeToUpsert: {
        absoluteFilePathIsID: 'test-node-3.md',
        contentWithoutYamlOrLinks: '# Core Principles\nCore principles guide.',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: { _tag: 'None' } as const,
          position: { _tag: 'Some', value: { x: 500, y: 200 } } as const,
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      },
      previousNode: { _tag: 'None' } as const
    },
    {
      type: 'UpsertNode' as const,
      nodeToUpsert: {
        absoluteFilePathIsID: 'test-node-4.md',
        contentWithoutYamlOrLinks: '# API Design\nAPI design patterns.',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: { _tag: 'None' } as const,
          position: { _tag: 'Some', value: { x: 700, y: 250 } } as const,
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      },
      previousNode: { _tag: 'None' } as const
    },
    {
      type: 'UpsertNode' as const,
      nodeToUpsert: {
        absoluteFilePathIsID: 'test-node-5.md',
        contentWithoutYamlOrLinks: '# Testing Guide\nHow to test the system.',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: { _tag: 'None' } as const,
          position: { _tag: 'Some', value: { x: 900, y: 300 } } as const,
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      },
      previousNode: { _tag: 'None' } as const
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
  // Pre-process delta to convert Maps to arrays for serialization
  // Maps don't serialize properly through Playwright's evaluate
  const serializableDelta = graphDelta.map((action) => {
    if (action.type === 'UpsertNode' && action.nodeToUpsert.nodeUIMetadata.additionalYAMLProps instanceof Map) {
      return {
        ...action,
        nodeToUpsert: {
          ...action.nodeToUpsert,
          nodeUIMetadata: {
            ...action.nodeToUpsert.nodeUIMetadata,
            // Convert Map to array of entries for serialization
            additionalYAMLProps: Array.from(action.nodeToUpsert.nodeUIMetadata.additionalYAMLProps.entries())
          }
        }
      };
    }
    return action;
  });

  await page.evaluate((delta) => {
    // Reconstruct Maps from serialized arrays inside browser context
    const reconstructedDelta = delta.map((action) => {
      if (action.type === 'UpsertNode' && Array.isArray(action.nodeToUpsert.nodeUIMetadata.additionalYAMLProps)) {
        return {
          ...action,
          nodeToUpsert: {
            ...action.nodeToUpsert,
            nodeUIMetadata: {
              ...action.nodeToUpsert.nodeUIMetadata,
              additionalYAMLProps: new Map(action.nodeToUpsert.nodeUIMetadata.additionalYAMLProps)
            }
          }
        };
      }
      return action;
    }) as GraphDelta;

    const electronAPI = (window as unknown as ExtendedWindow).electronAPI;
    if (!electronAPI) throw new Error('electronAPI not available');

    // Access the internal callback that was registered via onGraphUpdate
    const mockGraphAPI = electronAPI.graph as {
      _updateCallback?: (delta: GraphDelta) => void;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _graphState: { nodes: Record<string, any>; edges: any[] };
    };

    // Update mock graph state based on delta
    reconstructedDelta.forEach((nodeDelta) => {
      if (nodeDelta.type === 'UpsertNode') {
        const node = nodeDelta.nodeToUpsert;
        mockGraphAPI._graphState.nodes[node.absoluteFilePathIsID] = node;
      } else if (nodeDelta.type === 'DeleteNode') {
        delete mockGraphAPI._graphState.nodes[nodeDelta.nodeId];
      }
    });

    if (mockGraphAPI._updateCallback) {
      mockGraphAPI._updateCallback(reconstructedDelta);
      console.log('[Test] Triggered graph update via electronAPI callback');
    } else {
      console.error('[Test] No graph update callback registered!');
    }

    // Also trigger ui:call for updateFloatingEditorsFromExternal
    // This simulates what main process does after external FS events
    const triggerIpc = (electronAPI as unknown as { _triggerIpc?: (channel: string, ...args: unknown[]) => void })._triggerIpc;
    if (triggerIpc) {
      triggerIpc('ui:call', 'updateFloatingEditorsFromExternal', [reconstructedDelta]);
      console.log('[Test] Triggered ui:call for updateFloatingEditorsFromExternal');
    }
  }, serializableDelta);
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
