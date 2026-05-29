import { test as base, type Page } from '@playwright/test';
import type { AvailableFolderItem } from '@/pure/folders/types';

/**
 * Mock folder structure for testing lazy path expansion:
 *
 * /mock/watched/directory/
 *   ├── docs/
 *   │   ├── api/
 *   │   ├── projects/
 *   │   │   ├── auth/
 *   │   │   └── core/
 *   │   └── guides/
 *   ├── src/
 *   └── tests/
 */
export async function setupMockElectronAPIWithNestedFolders(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const mockProjectPaths: string[] = ['/mock/watched/directory'];
    let mockWriteFolderPath = '/mock/watched/directory';
    const createEmptyProjectedGraph = () => ({
      nodes: [],
      edges: [],
      rootPath: '',
      revision: 0,
      forests: [],
      arboricity: 0,
      recentNodeIds: []
    });

    const allFolders: { path: string; modifiedAt: number }[] = [
      { path: '/mock/watched/directory', modifiedAt: Date.now() - 1000 },
      { path: '/mock/watched/directory/docs', modifiedAt: Date.now() - 2000 },
      { path: '/mock/watched/directory/src', modifiedAt: Date.now() - 3000 },
      { path: '/mock/watched/directory/tests', modifiedAt: Date.now() - 4000 },
      { path: '/mock/watched/directory/docs/api', modifiedAt: Date.now() - 5000 },
      { path: '/mock/watched/directory/docs/projects', modifiedAt: Date.now() - 6000 },
      { path: '/mock/watched/directory/docs/guides', modifiedAt: Date.now() - 7000 },
      { path: '/mock/watched/directory/docs/projects/auth', modifiedAt: Date.now() - 8000 },
      { path: '/mock/watched/directory/docs/projects/core', modifiedAt: Date.now() - 9000 },
    ];

    const projectRoot = '/mock/watched/directory';

    const toDisplayPath = (absolutePath: string): string => {
      if (absolutePath === projectRoot) return '.';
      if (absolutePath.startsWith(projectRoot + '/')) {
        return absolutePath.slice(projectRoot.length + 1);
      }
      return absolutePath;
    };

    const parseSearchQuery = (query: string): { basePath: string | null; filterText: string; endsWithSlash: boolean } => {
      let normalized = query.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
      const endsWithSlash = normalized.endsWith('/');
      if (endsWithSlash) {
        normalized = normalized.slice(0, -1);
      }

      if (endsWithSlash) {
        return { basePath: normalized || null, filterText: '', endsWithSlash: true };
      }

      const lastSlashIndex = normalized.lastIndexOf('/');
      if (lastSlashIndex === -1) {
        return { basePath: null, filterText: normalized, endsWithSlash: false };
      }

      return {
        basePath: normalized.slice(0, lastSlashIndex) || null,
        filterText: normalized.slice(lastSlashIndex + 1),
        endsWithSlash: false,
      };
    };

    const getAvailableFoldersForSelector = (searchQuery: string): AvailableFolderItem[] => {
      const parsed = parseSearchQuery(searchQuery);
      let scanRoot = projectRoot;
      let filterText = searchQuery;

      if (parsed.basePath) {
        const targetPath = projectRoot + '/' + parsed.basePath;
        const targetExists = allFolders.some(f => f.path === targetPath);
        if (!targetExists) return [];
        scanRoot = targetPath;
        filterText = parsed.filterText;
      }

      const subfolders = allFolders.filter(f => {
        if (f.path === scanRoot) return true;
        if (!f.path.startsWith(scanRoot + '/')) return false;
        const relativePath = f.path.slice(scanRoot.length + 1);
        return !relativePath.includes('/');
      });

      const loadedPathSet = new Set(mockProjectPaths);
      let filtered = subfolders.filter(f => !loadedPathSet.has(f.path));

      if (filterText.trim() !== '') {
        const lowerFilter = filterText.toLowerCase();
        filtered = filtered.filter(f => {
          const displayPath = toDisplayPath(f.path);
          return displayPath.toLowerCase().includes(lowerFilter);
        });
      }

      filtered.sort((a, b) => b.modifiedAt - a.modifiedAt);

      if (searchQuery.trim() === '') {
        const rootIndex = filtered.findIndex(f => f.path === projectRoot);
        if (rootIndex > 0) {
          const [rootFolder] = filtered.splice(rootIndex, 1);
          filtered.unshift(rootFolder);
        }
        filtered = filtered.slice(0, 5);
      }

      return filtered.map(f => ({
        absolutePath: f.path,
        displayPath: toDisplayPath(f.path),
        modifiedAt: f.modifiedAt,
      })) as unknown as AvailableFolderItem[];
    };

    const broadcastProjectState = (): void => {
      const listeners = mockElectronAPI._ipcListeners['ui:call'] || [];
      listeners.forEach(cb => cb(null, 'syncProjectState', [{
        readPaths: [...mockProjectPaths],
        writeFolderPath: mockWriteFolderPath,
        starredFolders: [],
      }]));
    };

    // Mirror the real openProject → main → syncFolderTree path so that
    // `folderState.tree` is populated and `watchDirectory` resolves to
    // a real path. Without this, the Enter-key handler in
    // FolderTreeSidebar short-circuits because it requires
    // `watchDirectory` to be truthy.
    const broadcastFolderTree = (): void => {
      const listeners = mockElectronAPI._ipcListeners['ui:call'] || [];
      listeners.forEach(cb => cb(null, 'syncFolderTree', [{
        name: 'directory',
        absolutePath: '/mock/watched/directory',
        children: [],
        loadState: 'loaded',
        isWriteTarget: true,
      }]));
    };

    const mockElectronAPI = {
      main: {
        applyGraphDeltaToDBAndMem: async () => ({ success: true }),
        applyGraphDeltaToDBThroughMem: async () => ({ success: true }),
        getGraph: async () => ({ nodes: {}, edges: [] }),
        getProjectedGraph: async () => mockElectronAPI.graph._projectedGraph,
        getNode: async () => null,
        loadSettings: async () => ({
          terminalSpawnPathRelativeToWatchedDirectory: '../',
          agents: [{ name: 'Claude', command: './claude.sh' }],
          shiftEnterSendsOptionEnter: true
        }),
        saveSettings: async () => ({ success: true }),
        saveNodePositions: async () => ({ success: true }),
        startFileWatching: async (dir: string) => {
          setTimeout(broadcastProjectState, 10);
          return { success: true, directory: dir };
        },
        stopFileWatching: async () => ({ success: true }),
        getWatchStatus: async () => ({ isWatching: true, directory: '/mock/watched/directory' }),
        loadPreviousFolder: async () => ({ success: false }),
        getStartupProjectHint: async () => ({ kind: 'open-folder' as const, projectPath: '/mock/watched/directory' }),
        openProject: async (dir: string) => {
          const projectedGraph = mockElectronAPI.graph._projectedGraph ?? createEmptyProjectedGraph();
          setTimeout(() => {
            broadcastProjectState();
            broadcastFolderTree();
            mockElectronAPI.graph._projectedGraphCallback?.(projectedGraph);
          }, 10);

          return {
            sessionId: 'mock-session',
            writeFolderPath: mockWriteFolderPath,
            projectState: {
              projectRoot: dir,
              readPaths: [...mockProjectPaths],
              writeFolderPath: mockWriteFolderPath,
            },
            initialProjectedGraph: projectedGraph,
            folderState: [],
            activeView: {
              viewId: 'main',
              name: 'Main',
            },
          };
        },
        getBackendPort: async () => 5001,
        getMetrics: async () => ({ sessions: [] }),
        markFrontendReady: async () => { setTimeout(broadcastProjectState, 10); },
        getLiveStateSnapshot: async () => ({
          graph: {
            nodes: {},
            incomingEdgesIndex: [],
            nodeByBaseName: [],
            unresolvedLinksIndex: [],
          },
          roots: { loaded: [], folderTree: [{
            name: 'directory',
            absolutePath: '/mock/watched/directory',
            children: [],
            loadState: 'loaded',
            isWriteTarget: true,
          }] },
          folderState: [],
          activeView: { viewId: 'main', name: 'Main' },
          collapseSet: [],
          selection: [],
          layout: { positions: [] },
          meta: { schemaVersion: 1, revision: 0 },
        }),
        views: {
          list: async () => [{ viewId: 'main', name: 'Main', isActive: true }],
          activate: async () => ({ success: true }),
          clone: async (_srcViewId: string, name: string) => ({ viewId: `view-${name}`, name }),
          delete: async () => ({ success: true }),
        },
        createDatedVoiceTreeFolder: async () => {},
        readImageAsDataUrl: async (): Promise<string> => 'data:image/png;base64,test',
        getVoicetreeHomePath: async (): Promise<string> => '/Users/testuser/.voicetree',
        getProjectPaths: async (): Promise<readonly string[]> => [...mockProjectPaths],
        getWriteFolderPath: async () => ({ _tag: 'Some' as const, value: mockWriteFolderPath }),
        setWriteFolderPath: async (path: string) => {
          mockWriteFolderPath = path;
          if (!mockProjectPaths.includes(path)) mockProjectPaths.push(path);
          broadcastProjectState();
          return { success: true };
        },
        addReadPath: async (path: string) => {
          if (!mockProjectPaths.includes(path)) mockProjectPaths.push(path);
          broadcastProjectState();
          return { success: true };
        },
        removeReadPath: async (path: string) => {
          const index = mockProjectPaths.indexOf(path);
          if (index >= 0) mockProjectPaths.splice(index, 1);
          broadcastProjectState();
          return { success: true };
        },
        getShowAllPaths: async (): Promise<readonly string[]> => [],
        toggleShowAll: async () => ({ success: true, showAll: false }),
        addReadOnLinkPath: async (path: string) => {
          if (!mockProjectPaths.includes(path)) mockProjectPaths.push(path);
          return { success: true };
        },
        removeReadOnLinkPath: async (path: string) => {
          const index = mockProjectPaths.indexOf(path);
          if (index >= 0) mockProjectPaths.splice(index, 1);
          return { success: true };
        },
        getAvailableFoldersForSelector: async (query: string): Promise<readonly AvailableFolderItem[]> => {
          return getAvailableFoldersForSelector(query);
        },
        loadProjects: async () => [{
          id: 'mock-project-1',
          path: '/mock/watched/directory',
          name: 'Mock Test Project',
          type: 'folder' as const,
          lastOpened: Date.now(),
        }],
        saveProject: async () => {},
        removeProject: async () => {},
        getDefaultSearchDirectories: async () => [],
        scanForProjects: async () => [],
        showFolderPicker: async () => ({ success: false }),
        applyGraphDeltaToDBThroughMemUIAndEditorExposed: async () => ({ success: true }),
        applyGraphDeltaToDBThroughMemAndUIExposed: async () => ({ success: true }),
        updateTerminalIsDone: async () => {},
        updateTerminalPinned: async () => {},
        updateTerminalActivityState: async () => {},
        removeTerminalFromRegistry: async () => {},
        closeAgent: async () => ({closed: false} as const),
      },
      onWatchingStarted: () => {},
      onFileWatchingStopped: () => {},
      onProjectSwitching: () => () => {},
      onProjectReady: () => () => {},
      onProjectLost: () => () => {},
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onProjectedGraphUpdate: (callback: (graph: any) => void) => {
          mockElectronAPI.graph._projectedGraphCallback = callback;
          return () => {};
        },
        onGraphClear: () => () => {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        _projectedGraphCallback: undefined as ((graph: any) => void) | undefined
      },
      invoke: async () => {},
      _ipcListeners: {} as Record<string, ((event: unknown, ...args: unknown[]) => void)[]>,
      on: (channel: string, callback: (event: unknown, ...args: unknown[]) => void) => {
        if (!mockElectronAPI._ipcListeners[channel]) {
          mockElectronAPI._ipcListeners[channel] = [];
        }
        mockElectronAPI._ipcListeners[channel].push(callback);
        return () => {
          const idx = mockElectronAPI._ipcListeners[channel]?.indexOf(callback);
          if (idx !== undefined && idx >= 0) {
            mockElectronAPI._ipcListeners[channel].splice(idx, 1);
          }
        };
      },
      off: () => {},
      _triggerIpc: (channel: string, ...args: unknown[]) => {
        const listeners = mockElectronAPI._ipcListeners[channel] || [];
        listeners.forEach(cb => cb(null, ...args));
      }
    };

    (window as unknown as { electronAPI: typeof mockElectronAPI }).electronAPI = mockElectronAPI;
  });
}

export const test = base.extend<{ consoleCapture: { logs: string[]; errors: string[] } }>({
  consoleCapture: async ({ page }, use, testInfo) => {
    const logs: string[] = [];
    const errors: string[] = [];
    page.on('console', msg => { logs.push(`[${msg.type()}] ${msg.text()}`); });
    page.on('pageerror', error => { errors.push(`[Error] ${error.message}`); });
    await use({ logs, errors });
    if (testInfo.status !== 'passed') {
      console.log('\n=== Browser Console Logs ===');
      logs.forEach(log => console.log(log));
      if (errors.length > 0) {
        console.log('\n=== Browser Errors ===');
        errors.forEach(err => console.log(err));
      }
    }
  }
});
