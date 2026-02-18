/**
 * BEHAVIORAL SPEC:
 * Visual tests for VaultPathSelector lazy path expansion.
 *
 * This test verifies the nested path navigation feature:
 * 1. Type "docs/" → shows docs subfolders
 * 2. Type "docs/p" → shows filtered results
 * 3. Display paths show full relative path (e.g., docs/projects/auth)
 * 4. "Create folder" button doesn't appear for existing nested folders
 */

import { test as base, expect, type Page } from '@playwright/test';
import {
  waitForCytoscapeReady,
  createTestGraphDelta,
  sendGraphDelta,
  selectMockProject
} from '@e2e/playwright-browser/graph-delta-test-utils';
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
async function setupMockElectronAPIWithNestedFolders(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const mockVaultPaths: string[] = ['/mock/watched/directory'];
    let mockWritePath = '/mock/watched/directory';
    // currentSearchQuery tracking removed — not read by any consumer

    // Define the mock folder structure
    const allFolders: { path: string; modifiedAt: number }[] = [
      // Root level
      { path: '/mock/watched/directory', modifiedAt: Date.now() - 1000 },
      { path: '/mock/watched/directory/docs', modifiedAt: Date.now() - 2000 },
      { path: '/mock/watched/directory/src', modifiedAt: Date.now() - 3000 },
      { path: '/mock/watched/directory/tests', modifiedAt: Date.now() - 4000 },
      // docs subfolders
      { path: '/mock/watched/directory/docs/api', modifiedAt: Date.now() - 5000 },
      { path: '/mock/watched/directory/docs/projects', modifiedAt: Date.now() - 6000 },
      { path: '/mock/watched/directory/docs/guides', modifiedAt: Date.now() - 7000 },
      // docs/projects subfolders
      { path: '/mock/watched/directory/docs/projects/auth', modifiedAt: Date.now() - 8000 },
      { path: '/mock/watched/directory/docs/projects/core', modifiedAt: Date.now() - 9000 },
    ];

    const projectRoot = '/mock/watched/directory';

    // Helper to convert path to display path
    const toDisplayPath = (absolutePath: string): string => {
      if (absolutePath === projectRoot) return '.';
      if (absolutePath.startsWith(projectRoot + '/')) {
        return absolutePath.slice(projectRoot.length + 1);
      }
      return absolutePath;
    };

    // Parse search query (mirrors parseSearchQuery from transforms.ts)
    const parseSearchQuery = (query: string): { basePath: string | null; filterText: string; endsWithSlash: boolean } => {
      let normalized = query.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
      const endsWithSlash = normalized.endsWith('/');
      if (endsWithSlash) {
        normalized = normalized.slice(0, -1);
      }

      if (endsWithSlash) {
        return {
          basePath: normalized || null,
          filterText: '',
          endsWithSlash: true,
        };
      }

      const lastSlashIndex = normalized.lastIndexOf('/');
      if (lastSlashIndex === -1) {
        return {
          basePath: null,
          filterText: normalized,
          endsWithSlash: false,
        };
      }

      return {
        basePath: normalized.slice(0, lastSlashIndex) || null,
        filterText: normalized.slice(lastSlashIndex + 1),
        endsWithSlash: false,
      };
    };

    // Mock getAvailableFoldersForSelector with lazy path expansion
    const getAvailableFoldersForSelector = (searchQuery: string): AvailableFolderItem[] => {
      const parsed = parseSearchQuery(searchQuery);

      let scanRoot = projectRoot;
      let filterText = searchQuery;

      if (parsed.basePath) {
        // User typed a path - scan that subdirectory
        const targetPath = projectRoot + '/' + parsed.basePath;
        // Check if target path exists in our mock folders
        const targetExists = allFolders.some(f => f.path === targetPath);
        if (!targetExists) {
          return []; // Invalid path
        }
        scanRoot = targetPath;
        filterText = parsed.filterText;
      }

      // Get immediate subfolders of scanRoot
      const subfolders = allFolders.filter(f => {
        if (f.path === scanRoot) return true; // Include scanRoot itself
        if (!f.path.startsWith(scanRoot + '/')) return false;
        // Check it's an immediate child (only one additional path segment)
        const relativePath = f.path.slice(scanRoot.length + 1);
        return !relativePath.includes('/');
      });

      // Filter out already loaded paths
      const loadedPathSet = new Set(mockVaultPaths);
      let filtered = subfolders.filter(f => !loadedPathSet.has(f.path));

      // Apply filterText
      if (filterText.trim() !== '') {
        const lowerFilter = filterText.toLowerCase();
        filtered = filtered.filter(f => {
          const displayPath = toDisplayPath(f.path);
          return displayPath.toLowerCase().includes(lowerFilter);
        });
      }

      // Sort by modifiedAt descending
      filtered.sort((a, b) => b.modifiedAt - a.modifiedAt);

      // If no search query, limit to 5 and put root first
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

    // Broadcast vault state to VaultPathStore via IPC (simulates main process push)
    // Defined before mockElectronAPI but only called at runtime when mockElectronAPI is initialized
    const broadcastVaultState = (): void => {
      const listeners = mockElectronAPI._ipcListeners['ui:call'] || [];
      listeners.forEach(cb => cb(null, 'syncVaultState', [{
        readPaths: [...mockVaultPaths],
        writePath: mockWritePath,
        starredFolders: [],
      }]));
    };

    // Create a comprehensive mock of the Electron API
    const mockElectronAPI = {
      main: {
        applyGraphDeltaToDBAndMem: async () => ({ success: true }),
        applyGraphDeltaToDBThroughMem: async () => ({ success: true }),
        getGraph: async () => ({ nodes: {}, edges: [] }),
        getNode: async () => null,
        loadSettings: async () => ({
          terminalSpawnPathRelativeToWatchedDirectory: '../',
          agents: [{ name: 'Claude', command: './claude.sh' }],
          shiftEnterSendsOptionEnter: true
        }),
        saveSettings: async () => ({ success: true }),
        saveNodePositions: async () => ({ success: true }),
        startFileWatching: async (dir: string) => {
          setTimeout(broadcastVaultState, 10);
          return { success: true, directory: dir };
        },
        stopFileWatching: async () => ({ success: true }),
        getWatchStatus: async () => ({ isWatching: true, directory: '/mock/watched/directory' }),
        loadPreviousFolder: async () => ({ success: false }),
        getBackendPort: async () => 5001,
        getMetrics: async () => ({ sessions: [] }),
        markFrontendReady: async () => {},
        readImageAsDataUrl: async (): Promise<string> => 'data:image/png;base64,test',

        // App support path (used by VaultPathSelector to derive home directory)
        getAppSupportPath: async (): Promise<string> => '/Users/testuser/Library/Application Support/Voicetree',

        // Vault methods
        getVaultPaths: async (): Promise<readonly string[]> => mockVaultPaths,
        getWritePath: async () => ({
          _tag: 'Some' as const,
          value: mockWritePath
        }),
        setWritePath: async (path: string) => {
          mockWritePath = path;
          if (!mockVaultPaths.includes(path)) {
            mockVaultPaths.push(path);
          }
          setTimeout(broadcastVaultState, 0);
          return { success: true };
        },
        addReadPath: async (path: string) => {
          if (!mockVaultPaths.includes(path)) {
            mockVaultPaths.push(path);
          }
          setTimeout(broadcastVaultState, 0);
          return { success: true };
        },
        removeReadPath: async (path: string) => {
          const index = mockVaultPaths.indexOf(path);
          if (index >= 0) {
            mockVaultPaths.splice(index, 1);
          }
          setTimeout(broadcastVaultState, 0);
          return { success: true };
        },
        getShowAllPaths: async (): Promise<readonly string[]> => [],
        toggleShowAll: async () => ({ success: true, showAll: false }),
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

        // Lazy path expansion - the key function
        getAvailableFoldersForSelector: async (query: string): Promise<readonly AvailableFolderItem[]> => {
          return getAvailableFoldersForSelector(query);
        },

        // Project selection
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

        // UI-edge methods
        applyGraphDeltaToDBThroughMemUIAndEditorExposed: async () => ({ success: true }),
        applyGraphDeltaToDBThroughMemAndUIExposed: async () => ({ success: true }),

        // Terminal state
        updateTerminalIsDone: async () => {},
        updateTerminalPinned: async () => {},
        updateTerminalActivityState: async () => {},
        removeTerminalFromRegistry: async () => {},
      },

      onWatchingStarted: () => {},
      onFileWatchingStopped: () => {},
      removeAllListeners: () => {},

      terminal: {
        spawn: async () => ({ success: false }),
        write: async () => {},
        resize: async () => {},
        kill: async () => {},
        onData: () => {},
        onExit: () => {}
      },

      positions: {
        save: async () => ({ success: true }),
        load: async () => ({ success: false, positions: {} })
      },

      onBackendLog: () => {},

      graph: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        _graphState: { nodes: {}, edges: [] } as any,
        applyGraphDelta: async () => ({ success: true }),
        getState: async () => mockElectronAPI.graph._graphState,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onGraphUpdate: (callback: (delta: any) => void) => {
          mockElectronAPI.graph._updateCallback = callback;
          return () => {};
        },
        onGraphClear: () => () => {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        _updateCallback: undefined as ((delta: any) => void) | undefined
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

test.describe('VaultPathSelector Lazy Path Expansion', () => {

  test('should show subfolders when typing "docs/"', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('=== Test: Show subfolders when typing "docs/" ===');

    // Setup
    await setupMockElectronAPIWithNestedFolders(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);

    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(200);

    // Open VaultPathSelector dropdown
    const selectorButton = page.locator('button[title^="Write Path:"]');
    await expect(selectorButton).toBeVisible({ timeout: 5000 });
    await selectorButton.click();
    await page.waitForTimeout(100);

    // Verify dropdown opened
    const dropdown = page.locator('.absolute.bottom-full.bg-card');
    await expect(dropdown).toBeVisible({ timeout: 3000 });

    // Find search input and type "docs/"
    const searchInput = dropdown.locator('input[placeholder*="folder"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('docs/');
    await page.waitForTimeout(300);

    // Verify docs subfolders are shown
    const folderList = dropdown.locator('.max-h-\\[280px\\]');
    const folderListText = await folderList.textContent();

    console.log('Folder list content after typing "docs/":', folderListText);

    // Should show docs subfolders: api, projects, guides
    expect(folderListText).toContain('docs/api');
    expect(folderListText).toContain('docs/projects');
    expect(folderListText).toContain('docs/guides');

    // Should NOT show root-level folders
    expect(folderListText).not.toContain('./src');
    expect(folderListText).not.toContain('./tests');

    // Take screenshot for visual verification
    await page.screenshot({
      path: 'webapp/e2e-tests/screenshots/vault-selector-docs-slash.png',
      clip: { x: 0, y: 0, width: 500, height: 400 }
    });

    console.log('=== Test PASSED: Subfolders shown for "docs/" ===');
  });

  test('should filter results when typing "docs/pro"', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('=== Test: Filter results when typing "docs/pro" ===');

    // Setup
    await setupMockElectronAPIWithNestedFolders(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);

    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(200);

    // Open dropdown
    const selectorButton = page.locator('button[title^="Write Path:"]');
    await selectorButton.click();
    await page.waitForTimeout(100);

    const dropdown = page.locator('.absolute.bottom-full.bg-card');
    await expect(dropdown).toBeVisible({ timeout: 3000 });

    // Type "docs/pro" to filter - use "pro" not "p" because "api" contains "p"
    const searchInput = dropdown.locator('input[placeholder*="folder"]');
    await searchInput.fill('docs/pro');
    await page.waitForTimeout(300);

    // Verify filtered results
    const folderList = dropdown.locator('.max-h-\\[280px\\]');
    const folderListText = await folderList.textContent();

    console.log('Folder list content after typing "docs/pro":', folderListText);

    // Should show projects (matches "pro")
    expect(folderListText).toContain('docs/projects');

    // Should NOT show api or guides (don't match "pro")
    expect(folderListText).not.toContain('docs/api');
    expect(folderListText).not.toContain('docs/guides');

    // Take screenshot
    await page.screenshot({
      path: 'webapp/e2e-tests/screenshots/vault-selector-docs-pro-filter.png',
      clip: { x: 0, y: 0, width: 500, height: 400 }
    });

    console.log('=== Test PASSED: Filtered results for "docs/pro" ===');
  });

  test('should show nested path in display (docs/projects/auth)', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('=== Test: Display full relative path for nested folders ===');

    // Setup
    await setupMockElectronAPIWithNestedFolders(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);

    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(200);

    // Open dropdown
    const selectorButton = page.locator('button[title^="Write Path:"]');
    await selectorButton.click();
    await page.waitForTimeout(100);

    const dropdown = page.locator('.absolute.bottom-full.bg-card');
    await expect(dropdown).toBeVisible({ timeout: 3000 });

    // Type "docs/projects/" to navigate deeper
    const searchInput = dropdown.locator('input[placeholder*="folder"]');
    await searchInput.fill('docs/projects/');
    await page.waitForTimeout(300);

    // Verify nested folders are shown with full relative path
    const folderList = dropdown.locator('.max-h-\\[280px\\]');
    const folderListText = await folderList.textContent();

    console.log('Folder list content after typing "docs/projects/":', folderListText);

    // Should show full relative paths
    expect(folderListText).toContain('docs/projects/auth');
    expect(folderListText).toContain('docs/projects/core');

    // Take screenshot
    await page.screenshot({
      path: 'webapp/e2e-tests/screenshots/vault-selector-nested-path-display.png',
      clip: { x: 0, y: 0, width: 500, height: 400 }
    });

    console.log('=== Test PASSED: Full relative path displayed for nested folders ===');
  });

  test('should NOT show Create button for existing nested folders', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('=== Test: No Create button for existing nested folders ===');

    // Setup
    await setupMockElectronAPIWithNestedFolders(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);

    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(200);

    // Open dropdown
    const selectorButton = page.locator('button[title^="Write Path:"]');
    await selectorButton.click();
    await page.waitForTimeout(100);

    const dropdown = page.locator('.absolute.bottom-full.bg-card');
    await expect(dropdown).toBeVisible({ timeout: 3000 });

    // Type exact existing folder path
    const searchInput = dropdown.locator('input[placeholder*="folder"]');
    await searchInput.fill('docs/projects/auth');
    await page.waitForTimeout(300);

    // Verify there's NO "Create" button for this exact existing path
    const createButton = dropdown.locator('button:has-text("Create docs/projects/auth")');
    const createButtonCount = await createButton.count();

    console.log('Create button count for existing path:', createButtonCount);

    // The "Create" button should NOT appear when the folder exists
    expect(createButtonCount).toBe(0);

    // Take screenshot
    await page.screenshot({
      path: 'webapp/e2e-tests/screenshots/vault-selector-no-create-existing.png',
      clip: { x: 0, y: 0, width: 500, height: 400 }
    });

    console.log('=== Test PASSED: No Create button for existing nested folders ===');
  });

  test('should show Create button for non-existing nested folder', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('=== Test: Show Create button for non-existing folder ===');

    // Setup
    await setupMockElectronAPIWithNestedFolders(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);

    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(200);

    // Open dropdown
    const selectorButton = page.locator('button[title^="Write Path:"]');
    await selectorButton.click();
    await page.waitForTimeout(100);

    const dropdown = page.locator('.absolute.bottom-full.bg-card');
    await expect(dropdown).toBeVisible({ timeout: 3000 });

    // Type a non-existing folder path
    const searchInput = dropdown.locator('input[placeholder*="folder"]');
    await searchInput.fill('newfeature');
    await page.waitForTimeout(300);

    // Verify "Create" button appears for non-existing path
    const createButton = dropdown.locator('button:has-text("Create newfeature")');
    const createButtonVisible = await createButton.isVisible();

    console.log('Create button visible for new path:', createButtonVisible);

    expect(createButtonVisible).toBe(true);

    // Take screenshot
    await page.screenshot({
      path: 'webapp/e2e-tests/screenshots/vault-selector-create-new-folder.png',
      clip: { x: 0, y: 0, width: 500, height: 400 }
    });

    console.log('=== Test PASSED: Create button shown for non-existing folder ===');
  });

  test('should return empty results for invalid/escape paths like "../"', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('=== Test: Empty results for invalid paths ===');

    // Setup
    await setupMockElectronAPIWithNestedFolders(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);

    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(200);

    // Open dropdown
    const selectorButton = page.locator('button[title^="Write Path:"]');
    await selectorButton.click();
    await page.waitForTimeout(100);

    const dropdown = page.locator('.absolute.bottom-full.bg-card');
    await expect(dropdown).toBeVisible({ timeout: 3000 });

    // Type an escape attempt path
    const searchInput = dropdown.locator('input[placeholder*="folder"]');
    await searchInput.fill('../etc');
    await page.waitForTimeout(300);

    // Should show empty results (no folders matching escape path)
    // The folder list should show "Type to search folders..." or be empty
    const folderList = dropdown.locator('.max-h-\\[280px\\]');
    const folderItems = folderList.locator('.group');
    const itemCount = await folderItems.count();

    console.log('Folder items count for invalid path:', itemCount);

    // There should be no folder results for escape paths
    // (only the "Create" button might appear, which is filtered on the backend)
    expect(itemCount).toBe(0);

    console.log('=== Test PASSED: Empty results for invalid paths ===');
  });
});

export { test };
