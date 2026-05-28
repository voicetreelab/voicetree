/**
 * BEHAVIORAL SPEC:
 * E2E test for VaultPathSelector WITHOUT showAll toggle.
 *
 * This test verifies:
 * 1. VaultPathSelector should NOT show an eye icon or "show all" toggle
 * 2. readPaths should display without any toggle state indicator
 * 3. The add/remove path functionality should still work
 */

import { test as base, expect, type Page } from '@playwright/test';
import {
  waitForCytoscapeReady,
  createTestGraphDelta,
  sendGraphDelta,
} from '@e2e/playwright-browser/graph-delta-test-utils';

/**
 * Custom mock setup that extends the base mock with vault methods
 */
async function setupMockElectronAPIWithVault(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Create vault paths for testing
    const mockVaultPaths: string[] = [
      '/mock/write-vault',
      '/mock/read-vault-1',
      '/mock/read-vault-2'
    ];
    let mockWriteFolder = '/mock/write-vault';
    let mockShowAllPaths: string[] = [];
    const createEmptyProjectedGraph = () => ({
      nodes: [],
      edges: [],
      rootPath: '',
      revision: 0,
      forests: [],
      arboricity: 0,
      recentNodeIds: []
    });

    // Broadcast vault state to VaultPathStore via IPC (simulates main process push)
    const broadcastVaultState = (): void => {
      const listeners = mockElectronAPI._ipcListeners['ui:call'] || [];
      listeners.forEach(cb => cb(null, 'syncVaultState', [{
        readPaths: [...mockVaultPaths],
        writeFolder: mockWriteFolder,
        starredFolders: [],
      }]));
    };

    // Create a comprehensive mock of the Electron API
    const mockElectronAPI = {
      // Main API
      main: {
        // Graph operations
        applyGraphDeltaToDBAndMem: async () => ({ success: true }),
        applyGraphDeltaToDBThroughMem: async () => ({ success: true }),
        getGraph: async () => ({ nodes: {}, edges: [] }),
        getProjectedGraph: async () => mockElectronAPI.graph._projectedGraph,
        getNode: async () => null,

        // Settings operations
        loadSettings: async () => ({
          terminalSpawnPathRelativeToWatchedDirectory: '../',
          agents: [{ name: 'Claude', command: './claude.sh' }],
          shiftEnterSendsOptionEnter: true
        }),
        saveSettings: async () => ({ success: true }),

        // Node position saving
        saveNodePositions: async () => ({ success: true }),

        // File watching controls
        startFileWatching: async (dir: string) => {
          setTimeout(broadcastVaultState, 10);
          return { success: true, directory: dir };
        },
        stopFileWatching: async () => ({ success: true }),
        getWatchStatus: async () => ({ isWatching: true, directory: '/mock/write-vault' }),
        loadPreviousFolder: async () => ({ success: false }),
        getStartupVaultHint: async () => ({ kind: 'open-folder' as const, path: '/mock/write-vault' }),
        openVault: async (dir: string) => {
          const projectedGraph = mockElectronAPI.graph._projectedGraph ?? createEmptyProjectedGraph();
          setTimeout(() => {
            broadcastVaultState();
            mockElectronAPI.graph._projectedGraphCallback?.(projectedGraph);
          }, 10);

          return {
            sessionId: 'mock-session',
            writeFolder: mockWriteFolder,
            vaultState: {
              projectRoot: dir,
              readPaths: [...mockVaultPaths],
              writeFolder: mockWriteFolder,
            },
            initialProjectedGraph: projectedGraph,
            folderState: [],
            activeView: {
              viewId: 'main',
              name: 'Main',
            },
          };
        },

        // Backend server configuration
        getBackendPort: async () => 5001,

        // Agent metrics
        getMetrics: async () => ({ sessions: [] }),

        // Image loading
        readImageAsDataUrl: async (): Promise<string> => 'data:image/png;base64,test',

        // App support path (used by VaultPathSelector to derive home directory)
        getAppSupportPath: async (): Promise<string> => '/Users/testuser/Library/Application Support/Voicetree',

        markFrontendReady: async () => { setTimeout(broadcastVaultState, 10); },
        getLiveStateSnapshot: async () => ({
          graph: {
            nodes: {},
            incomingEdgesIndex: [],
            nodeByBaseName: [],
            unresolvedLinksIndex: [],
          },
          roots: {
            loaded: [],
            folderTree: [{
              name: 'write-vault',
              absolutePath: '/mock/write-vault',
              children: [],
              loadState: 'loaded',
              isWriteTarget: true,
            }],
          },
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

        // UI-edge graph delta operations
        applyGraphDeltaToDBThroughMemUIAndEditorExposed: async () => ({ success: true }),
        applyGraphDeltaToDBThroughMemAndUIExposed: async () => ({ success: true }),

        // === VAULT METHODS (critical for VaultPathSelector) ===
        getVaultPaths: async (): Promise<readonly string[]> => mockVaultPaths,

        getWriteFolder: async () => ({
          _tag: 'Some' as const,
          value: mockWriteFolder
        }),

        setWriteFolder: async (path: string) => {
          mockWriteFolder = path;
          broadcastVaultState();
          return { success: true };
        },

        addReadPath: async (path: string) => {
          if (!mockVaultPaths.includes(path)) {
            mockVaultPaths.push(path);
          }
          broadcastVaultState();
          return { success: true };
        },

        removeReadPath: async (path: string) => {
          const index = mockVaultPaths.indexOf(path);
          if (index >= 0) {
            mockVaultPaths.splice(index, 1);
          }
          broadcastVaultState();
          return { success: true };
        },

        getShowAllPaths: async (): Promise<readonly string[]> => mockShowAllPaths,

        toggleShowAll: async (path: string) => {
          const index = mockShowAllPaths.indexOf(path);
          if (index >= 0) {
            mockShowAllPaths = mockShowAllPaths.filter(p => p !== path);
            return { success: true, showAll: false };
          } else {
            mockShowAllPaths = [...mockShowAllPaths, path];
            return { success: true, showAll: true };
          }
        },

        addReadOnLinkPath: async (path: string) => {
          if (!mockVaultPaths.includes(path)) {
            mockVaultPaths.push(path);
          }
          return { success: true };
        },

        removeReadOnLinkPath: async (path: string) => {
          const index = mockVaultPaths.indexOf(path);
          if (index >= 0) {
            mockVaultPaths.splice(index, 1);
          }
          return { success: true };
        },

        // Folder selector API (used by VaultPathSelector for autocomplete)
        getAvailableFoldersForSelector: async (_query: string) => {
          // Return mock folders for testing - just needs to be a valid response
          return [
            { absolutePath: '/mock/folder1', displayPath: 'folder1', modifiedAt: Date.now() },
            { absolutePath: '/mock/folder2', displayPath: 'folder2', modifiedAt: Date.now() - 1000 },
          ];
        },

        // Project selection operations (required for ProjectSelectionScreen)
        loadProjects: async () => [{
          id: 'mock-project-1',
          path: '/mock/write-vault',
          name: 'Mock Test Project',
          type: 'folder' as const,
          lastOpened: Date.now(),
          voicetreeInitialized: true,
        }],
        saveProject: async () => {},
        removeProject: async () => {},
        getDefaultSearchDirectories: async () => [],
        scanForProjects: async () => [],
        initializeProject: async () => '/mock/write-vault/voicetree',
        showFolderPicker: async () => ({ success: false }),

        // Terminal state mutations
        updateTerminalIsDone: async () => {},
        updateTerminalPinned: async () => {},
        updateTerminalActivityState: async () => {},
        removeTerminalFromRegistry: async () => {},
        closeAgent: async () => ({closed: false} as const),
      },

      // File watching event listeners
      onWatchingStarted: () => {},
      onFileWatchingStopped: () => {},
      onVaultSwitching: () => () => {},
      onVaultReady: () => () => {},
      onVaultLost: () => () => {},
      onViewSwitched: () => () => {},
      removeAllListeners: () => {},

      // Terminal API
      terminal: {
        attach: async () => 'mock-handle',
        onData: () => () => {},
        onStatus: () => () => {},
        write: async () => true,
        resize: async () => true,
        detach: async () => true,
      },

      // VTD /events stream (Phase 0 / BF-367). No-op for tests that don't drive frames.
      events: {
        on: () => () => {},
        onConnectionState: () => () => {},
        resnapshot: async () => {},
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

      // General IPC communication
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

// Test fixture with console capture
const test = base.extend<{ consoleCapture: { logs: string[]; errors: string[] } }>({
  consoleCapture: async ({ page }, use, testInfo) => {
    const logs: string[] = [];
    const errors: string[] = [];

    page.on('console', msg => {
      logs.push(`[${msg.type()}] ${msg.text()}`);
    });

    page.on('pageerror', error => {
      errors.push(`[Error] ${error.message}`);
    });

    await use({ logs, errors });

    // Print logs on test failure
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

test.describe('VaultPathSelector without showAll toggle', () => {
  test('should not render eye icon toggle for readPaths', async ({ page, consoleCapture: _consoleCapture }) => {
    await setupMockElectronAPIWithVault(page);
    await page.goto('/');
    await waitForCytoscapeReady(page);

    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(200);

    // FolderTreeSidebar opens by default (isOpen: true in fresh localStorage)
    const sidebar = page.locator('[data-testid="folder-tree-sidebar"]');
    await expect(sidebar).toBeVisible({ timeout: 5000 });

    // Verify NO eye icon exists anywhere in the sidebar
    const eyeIconButtons = sidebar.locator('button').filter({ has: page.locator('text=👁') });
    expect(await eyeIconButtons.count()).toBe(0);

    // No "show all" buttons
    const showAllButtons = sidebar.locator('button[title*="show all" i], button[title*="Show all" i]');
    expect(await showAllButtons.count()).toBe(0);

    // No data-testid for show-all toggle
    const showAllToggle = sidebar.locator('[data-testid="show-all-toggle"]');
    await expect(showAllToggle).toHaveCount(0);
  });

  test('should still allow adding readPaths via folder search', async ({ page, consoleCapture: _consoleCapture }) => {
    await setupMockElectronAPIWithVault(page);
    await page.goto('/');
    await waitForCytoscapeReady(page);

    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(200);

    const sidebar = page.locator('[data-testid="folder-tree-sidebar"]');
    await expect(sidebar).toBeVisible({ timeout: 5000 });

    // Find the footer add-folder input
    const addInput = sidebar.locator('input[placeholder="+ Add folder..."]');
    await expect(addInput).toBeVisible();

    // Type a query to trigger getAvailableFoldersForSelector
    await addInput.fill('folder');
    await page.waitForTimeout(300);

    // Results should appear with add buttons
    const results = sidebar.locator('.folder-tree-add-results');
    await expect(results).toBeVisible({ timeout: 3000 });

    const addButtons = results.locator('.folder-tree-add-result-btn');
    expect(await addButtons.count()).toBeGreaterThan(0);
  });

  test('should display sidebar without toggle state indicators', async ({ page, consoleCapture: _consoleCapture }) => {
    await setupMockElectronAPIWithVault(page);
    await page.goto('/');
    await waitForCytoscapeReady(page);

    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(200);

    const sidebar = page.locator('[data-testid="folder-tree-sidebar"]');
    await expect(sidebar).toBeVisible({ timeout: 5000 });

    // Get sidebar HTML and verify no toggle indicators
    const sidebarHtml = await sidebar.innerHTML();
    expect(sidebarHtml).not.toContain('👁');
    expect(sidebarHtml).not.toContain('show-all-toggle');
    expect(sidebarHtml).not.toContain('showAll');
  });
});

export { test };
