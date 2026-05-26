import type { Page } from '@playwright/test';
import type { GraphDelta } from '@/pure/graph';
import type { ProjectedGraph } from '@vt/graph-state/contract';
import { waitForCytoscapeReady } from './graph-delta-actions';

interface MockSetupWindow extends Window {
  _undoRedoTracker?: {
    undoCalls: number;
    redoCalls: number;
  };
  terminalStoreAPI?: unknown;
}

function installMockElectronAPI(): void {
  const createMockSettings = () => ({
    terminalSpawnPathRelativeToWatchedDirectory: '../',
    agents: [
      { name: 'Claude', command: './claude.sh' },
      { name: 'Gemini', command: 'gemini' }
    ],
    INJECT_ENV_VARS: {
      AGENT_PROMPT: '',
      AGENT_PROMPT_CORE: '',
      AGENT_PROMPT_LIGHTWEIGHT: ''
    },
    agentPermissionModeChosen: true,
    shiftEnterSendsOptionEnter: true
  });

  const createEmptyClaudeUsageWindow = () => ({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    messageCount: 0,
    usedPercent: null,
    resetsAt: null
  });

  const createUnavailableUsageData = () => ({
    claude: {
      available: false,
      isRefreshing: false,
      planType: null,
      currentSession: createEmptyClaudeUsageWindow(),
      currentWeek: createEmptyClaudeUsageWindow(),
      currentWeekSonnet: createEmptyClaudeUsageWindow()
    },
    codex: {
      available: false
    }
  });

  const trackUndo = (): void => {
    const tracker = (window as MockSetupWindow)._undoRedoTracker;
    if (tracker) {
      tracker.undoCalls++;
      console.log(`[Mock] performUndo called (total: ${tracker.undoCalls})`);
    }
  };

  const trackRedo = (): void => {
    const tracker = (window as MockSetupWindow)._undoRedoTracker;
    if (tracker) {
      tracker.redoCalls++;
      console.log(`[Mock] performRedo called (total: ${tracker.redoCalls})`);
    }
  };

  const updateMockGraphState = (delta: GraphDelta): void => {
    delta.forEach((nodeDelta) => {
      if (nodeDelta.type === 'UpsertNode') {
        const node = nodeDelta.nodeToUpsert;
        mockElectronAPI.graph._graphState.nodes[node.absoluteFilePathIsID] = node;
      } else if (nodeDelta.type === 'DeleteNode') {
        delete mockElectronAPI.graph._graphState.nodes[nodeDelta.nodeId];
      }
    });
  };

  const emitMockGraphUpdates = async (delta: GraphDelta): Promise<{ success: true }> => {
    updateMockGraphState(delta);

    const { projectDelta } = await import('/src/shell/edge/UI-edge/graph/integration-tests/projectGraphDelta.ts');
    const projectedGraph: ProjectedGraph = projectDelta(delta);
    mockElectronAPI.graph._projectedGraph = projectedGraph;

    setTimeout(() => {
      mockElectronAPI.graph._projectedGraphCallback?.(projectedGraph);
    }, 10);

    return { success: true };
  };

  const writeMarkdownFile = async (
    nodeId: string,
    body: string,
    _editorId: string
  ): Promise<{ ok: true; absolutePath: string; preservedSuffix: null }> => {
    const existingNode = mockElectronAPI.graph._graphState.nodes[nodeId];
    if (existingNode) {
      mockElectronAPI.graph._graphState.nodes[nodeId] = {
        ...existingNode,
        contentWithoutYamlOrLinks: body
      };
    }

    return { ok: true, absolutePath: nodeId, preservedSuffix: null };
  };

  const createEmptyProjectedGraph = (): ProjectedGraph => ({
    nodes: [],
    edges: [],
    rootPath: '',
    revision: 0,
    forests: [],
    arboricity: 0,
    recentNodeIds: []
  });

  const mockElectronAPI = {
    main: {
      applyGraphDeltaToDBAndMem: async () => ({ success: true }),
      applyGraphDeltaToDBThroughMem: emitMockGraphUpdates,
      getGraph: async () => mockElectronAPI.graph._graphState,
      getProjectedGraph: async () => mockElectronAPI.graph._projectedGraph,
      getNode: async (nodeId: string) => mockElectronAPI.graph._graphState.nodes[nodeId],
      loadSettings: async () => createMockSettings(),
      saveSettings: async () => ({ success: true }),
      writeMarkdownFile,
      saveNodePositions: async () => ({ success: true }),
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
      getStartupVaultHint: async () => ({ kind: 'open-folder' as const, path: '/mock/watched/directory' }),
      openVault: async (dir: string) => {
        const projectedGraph = mockElectronAPI.graph._projectedGraph ?? createEmptyProjectedGraph();
        setTimeout(() => {
          mockElectronAPI.graph._projectedGraphCallback?.(projectedGraph);
        }, 10);

        return {
          sessionId: 'mock-session',
          writeFolder: dir,
          vaultState: {
            projectRoot: dir,
            readPaths: [dir],
            writeFolder: dir,
          },
          initialProjectedGraph: projectedGraph,
          folderState: [],
          activeView: {
            viewId: 'main',
            name: 'Main',
          },
        };
      },
      getBackendPort: async () => null,
      setMcpIntegration: async () => {},
      getMetrics: async () => ({ sessions: [] }),
      getUsageData: async () => createUnavailableUsageData(),
      refreshClaudeUsageHeadless: async () => createUnavailableUsageData().claude,
      performUndo: async () => {
        trackUndo();
        return true;
      },
      performRedo: async () => {
        trackRedo();
        return true;
      },
      markFrontendReady: async () => {},
      views: {
        list: async () => [{ viewId: 'main', name: 'Main', isActive: true }],
        activate: async () => ({ success: true }),
        clone: async (_srcViewId: string, name: string) => ({ viewId: `view-${name}`, name }),
        delete: async () => ({ success: true }),
      },
      getAppSupportPath: async (): Promise<string> => '/Users/testuser/Library/Application Support/Voicetree',
      getVaultPaths: async (): Promise<readonly string[]> => ['/mock/watched/directory'],
      getWriteFolder: async () => ({
        _tag: 'Some' as const,
        value: '/mock/watched/directory'
      }),
      setWriteFolder: async () => ({ success: true }),
      getShowAllPaths: async (): Promise<readonly string[]> => [],
      toggleShowAll: async () => ({ success: true, showAll: false }),
      addReadOnLinkPath: async () => ({ success: true }),
      removeReadOnLinkPath: async () => ({ success: true }),
      readImageAsDataUrl: async (_filePath: string): Promise<string> => {
        return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkAQMAAABKLAcXAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURUqQ2f///4FAZ9QAAAABYktHRAH/Ai3eAAAAB3RJTUUH6gESAAsWq1tIegAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0wMS0xOFQwMDoxMToyMiswMDowMKbMSowAAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMDEtMThUMDA6MTE6MjIrMDA6MDDXkfIwAAAAKHRFWHRkYXRlOnRpbWVzdGFtcAAyMDI2LTAxLTE4VDAwOjExOjIyKzAwOjAwgITT7wAAABRJREFUOMtjYBgFo2AUjIJRQE8AAAV4AAEpcbn8AAAAAElFTkSuQmCC';
      },
      applyGraphDeltaToDBThroughMemUIAndEditorExposed: emitMockGraphUpdates,
      applyGraphDeltaToDBThroughMemAndUIExposed: emitMockGraphUpdates,
      updateTerminalIsDone: async () => {},
      updateTerminalPinned: async () => {},
      updateTerminalActivityState: async () => {},
      removeTerminalFromRegistry: async () => {},
      closeAgent: async () => ({closed: false} as const),
      spawnTerminalWithContextNode: async () => ({ terminalId: 'mock-terminal' }),
      loadProjects: async () => [{
        id: 'mock-project-1',
        path: '/mock/watched/directory',
        name: 'Mock Test Project',
        type: 'folder' as const,
        lastOpened: Date.now(),
        voicetreeInitialized: true,
      }],
      saveProject: async () => {},
      removeProject: async () => {},
      getDefaultSearchDirectories: async () => [],
      scanForProjects: async () => [],
      initializeProject: async () => '/mock/watched/directory/voicetree',
      showFolderPicker: async () => ({ success: false }),
    },
    onWatchingStarted: () => {},
    onFileWatchingStopped: () => {},
    onVaultSwitching: () => () => {},
    onVaultReady: () => () => {},
    onVaultLost: () => () => {},
    onViewSwitched: () => () => {},
    removeAllListeners: () => {},
    terminal: {
      attach: async () => 'mock-handle',
      onData: () => () => {},
      onStatus: () => () => {},
      write: async () => true,
      resize: async () => true,
      detach: async () => true,
    },
    events: {
      on: () => () => {},
      onConnectionState: () => () => {},
      resnapshot: async () => {},
    },
    positions: {
      save: async () => ({ success: true }),
      load: async () => ({ success: false, positions: {} })
    },
    onBackendLog: () => {},
    graph: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _graphState: { nodes: {}, edges: [] } as any,
      _projectedGraph: createEmptyProjectedGraph(),
      applyGraphDelta: async () => ({ success: true }),
      getState: async () => mockElectronAPI.graph._graphState,
      getCurrentProjectedGraph: async () => mockElectronAPI.graph._projectedGraph,
      onProjectedGraphUpdate: (callback: (graph: ProjectedGraph) => void) => {
        console.log('[Mock] onProjectedGraphUpdate callback registered');
        mockElectronAPI.graph._projectedGraphCallback = callback;
        return () => {
          console.log('[Mock] onProjectedGraphUpdate cleanup called');
        };
      },
      onGraphClear: () => () => {},
      _projectedGraphCallback: undefined as ((graph: ProjectedGraph) => void) | undefined,
    },
    invoke: async () => {},
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _triggerIpc: (channel: string, ...args: any[]) => {
      const listeners = mockElectronAPI._ipcListeners[channel] || [];
      listeners.forEach(cb => cb(null, ...args));
    }
  };

  (window as unknown as { electronAPI: typeof mockElectronAPI }).electronAPI = mockElectronAPI;
}

export async function setupMockElectronAPI(page: Page): Promise<void> {
  await page.addInitScript(installMockElectronAPI);
}

export async function selectMockProject(page: Page): Promise<void> {
  const projectButton = page.locator('button:has-text("Mock Test Project")');

  await projectButton.waitFor({ state: 'visible', timeout: 5000 });
  await projectButton.click();

  console.log('[Test] Mock project selected, transitioning to graph view');
}

export async function setupTestAndNavigateToGraph(
  page: Page,
  options: { timeout?: number } = {}
): Promise<void> {
  const timeout = options.timeout ?? 10000;

  await setupMockElectronAPI(page);
  await page.goto('/');
  await page.waitForSelector('#root', { timeout: 5000 });
  await selectMockProject(page);
  await waitForCytoscapeReady(page, timeout);

  console.log('[Test] Setup complete, graph view ready');
}

export async function exposeTerminalStoreAPI(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const terminalStore = await import('/src/shell/edge/UI-edge/state/stores/TerminalStore.ts' as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const types = await import('/src/shell/edge/UI-edge/floating-windows/anchoring/types.ts' as any);

    (window as unknown as {
      terminalStoreAPI: {
        addTerminal: (data: unknown) => void;
        createTerminalData: (params: { attachedToNodeId: string; terminalCount: number; title: string }) => unknown;
        getTerminalId: (data: unknown) => string;
        getShadowNodeId: (id: string) => string;
        getActiveTerminalId: () => string | null;
      };
    }).terminalStoreAPI = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      addTerminal: (data: unknown) => terminalStore.addTerminal(data as any),
      createTerminalData: types.createTerminalData,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getTerminalId: (data: unknown) => types.getTerminalId(data as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getShadowNodeId: (id: string) => types.getShadowNodeId(id as any),
      getActiveTerminalId: () => terminalStore.getActiveTerminalId()
    };
    console.log('[Mock] TerminalStore API exposed for browser tests');
  });
}

export async function waitForTerminalStoreAPI(page: Page, timeout = 5000): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as MockSetupWindow).terminalStoreAPI !== undefined,
    { timeout }
  );
}
