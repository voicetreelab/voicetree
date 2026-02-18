/**
 * BEHAVIORAL SPEC:
 * Full E2E integration test for VaultPathSelector lazy path expansion.
 *
 * This test verifies the complete user flow:
 * 1. Open folder selector
 * 2. Type "docs/" in search - assert docs subfolders listed
 * 3. Type "docs/projects/" - assert projects subfolders listed
 * 4. Click "docs/projects/auth" to add it
 * 5. Assert folder is now in loaded paths (appears in "Also reading")
 * 6. Verify "Create docs/projects/auth/" button no longer appears
 *
 * Phase 4 of Lazy Path Expansion Implementation
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
    // Track loaded vault paths - this state persists across API calls
    const mockVaultPaths: string[] = ['/mock/watched/directory'];
    let mockWritePath = '/mock/watched/directory';

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

      // Filter out already loaded paths (key for E2E verification)
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
      } as AvailableFolderItem));
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
          // Simulate main process broadcasting vault state after file watching starts
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

        // Vault methods - KEY FOR E2E TESTING
        getVaultPaths: async (): Promise<readonly string[]> => {
          console.log('[Mock] getVaultPaths called, returning:', mockVaultPaths);
          return [...mockVaultPaths];
        },
        getWritePath: async () => ({
          _tag: 'Some' as const,
          value: mockWritePath
        }),
        setWritePath: async (path: string) => {
          console.log('[Mock] setWritePath called with:', path);
          mockWritePath = path;
          if (!mockVaultPaths.includes(path)) {
            mockVaultPaths.push(path);
          }
          setTimeout(broadcastVaultState, 0);
          return { success: true };
        },
        addReadPath: async (path: string) => {
          console.log('[Mock] addReadPath called with:', path);
          if (!mockVaultPaths.includes(path)) {
            mockVaultPaths.push(path);
          }
          setTimeout(broadcastVaultState, 0);
          return { success: true };
        },
        removeReadPath: async (path: string) => {
          console.log('[Mock] removeReadPath called with:', path);
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
          const result = getAvailableFoldersForSelector(query);
          console.log('[Mock] getAvailableFoldersForSelector query:', query, 'result count:', result.length);
          return result;
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

test.describe('VaultPathSelector E2E Integration Flow', () => {

  test('complete flow: navigate paths, add folder, verify state changes', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('=== E2E Test: Complete flow - navigate, add folder, verify state ===');

    // Setup
    await setupMockElectronAPIWithNestedFolders(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);

    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(200);

    // === Step 1: Open folder selector ===
    console.log('Step 1: Opening folder selector...');
    const selectorButton = page.locator('button[title^="Write Path:"]');
    await expect(selectorButton).toBeVisible({ timeout: 5000 });
    await selectorButton.click();
    await page.waitForTimeout(100);

    const dropdown = page.locator('.absolute.bottom-full.bg-card');
    await expect(dropdown).toBeVisible({ timeout: 3000 });
    console.log('  ✓ Dropdown opened');

    // === Step 2: Type "docs/" and verify subfolders ===
    console.log('Step 2: Typing "docs/" to navigate...');
    const searchInput = dropdown.locator('input[placeholder*="folder"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('docs/');
    await page.waitForTimeout(300);

    const folderList = dropdown.locator('.max-h-\\[280px\\]');
    let folderListText = await folderList.textContent();
    console.log('  Folder list after "docs/":', folderListText);

    // Verify docs subfolders appear
    expect(folderListText).toContain('docs/api');
    expect(folderListText).toContain('docs/projects');
    expect(folderListText).toContain('docs/guides');
    console.log('  ✓ docs/ subfolders displayed correctly');

    // Take screenshot at this step
    await page.screenshot({
      path: 'webapp/e2e-tests/screenshots/e2e-flow-step2-docs-slash.png',
      clip: { x: 0, y: 0, width: 500, height: 400 }
    });

    // === Step 3: Type "docs/projects/" and verify nested subfolders ===
    console.log('Step 3: Typing "docs/projects/" to navigate deeper...');
    await searchInput.fill('docs/projects/');
    await page.waitForTimeout(300);

    folderListText = await folderList.textContent();
    console.log('  Folder list after "docs/projects/":', folderListText);

    // Verify nested subfolders appear
    expect(folderListText).toContain('docs/projects/auth');
    expect(folderListText).toContain('docs/projects/core');
    console.log('  ✓ docs/projects/ subfolders displayed correctly');

    // Take screenshot at this step
    await page.screenshot({
      path: 'webapp/e2e-tests/screenshots/e2e-flow-step3-projects-slash.png',
      clip: { x: 0, y: 0, width: 500, height: 400 }
    });

    // === Step 4: Click "docs/projects/auth" to add it ===
    console.log('Step 4: Adding docs/projects/auth folder...');

    // Find the auth folder row and hover to reveal buttons
    const authFolderRow = folderList.locator('.group:has-text("docs/projects/auth")');
    await expect(authFolderRow).toBeVisible();
    await authFolderRow.hover();
    await page.waitForTimeout(150);

    // Click the "Read" button to add as read folder
    const readButton = authFolderRow.locator('button:has-text("Read")');
    await expect(readButton).toBeVisible({ timeout: 2000 });
    await readButton.click();
    await page.waitForTimeout(300);
    console.log('  ✓ Clicked Read button to add folder');

    // Take screenshot after adding
    await page.screenshot({
      path: 'webapp/e2e-tests/screenshots/e2e-flow-step4-after-add.png',
      clip: { x: 0, y: 0, width: 500, height: 400 }
    });

    // === Step 5: Verify folder is now in loaded paths ===
    console.log('Step 5: Verifying folder is in loaded paths...');

    // Check the "Also reading" section contains our added folder
    const alsoReadingSection = dropdown.locator('text=Also reading');
    await expect(alsoReadingSection).toBeVisible({ timeout: 3000 });

    const dropdownText = await dropdown.textContent();
    console.log('  Dropdown content after adding:', dropdownText);

    // The added folder should appear in the "Also reading" section
    expect(dropdownText).toContain('./docs/projects/auth');
    console.log('  ✓ docs/projects/auth appears in "Also reading" section');

    // Take screenshot showing folder in Also reading
    await page.screenshot({
      path: 'webapp/e2e-tests/screenshots/e2e-flow-step5-folder-in-list.png',
      clip: { x: 0, y: 0, width: 500, height: 400 }
    });

    // === Step 6: Verify folder no longer appears in available folders ===
    console.log('Step 6: Verifying folder no longer in available folders...');

    // Type the path again to trigger a refresh
    await searchInput.fill('docs/projects/');
    await page.waitForTimeout(300);

    folderListText = await folderList.textContent();
    console.log('  Available folders after adding auth:', folderListText);

    // docs/projects/auth should NOT appear in available folders anymore (it's now loaded)
    // But docs/projects/core should still appear
    const authStillAvailable = folderListText?.includes('docs/projects/auth');
    expect(authStillAvailable).toBe(false);
    expect(folderListText).toContain('docs/projects/core');
    console.log('  ✓ docs/projects/auth removed from available folders');
    console.log('  ✓ docs/projects/core still available');

    // Take screenshot showing auth not in list
    await page.screenshot({
      path: 'webapp/e2e-tests/screenshots/e2e-flow-step6-auth-removed.png',
      clip: { x: 0, y: 0, width: 500, height: 400 }
    });

    // === Step 7: Verify Create button doesn't appear for loaded folder ===
    console.log('Step 7: Verifying no Create button for loaded folder...');

    // Type exact path of the now-loaded folder
    await searchInput.fill('docs/projects/auth');
    await page.waitForTimeout(300);

    const createButton = dropdown.locator('button:has-text("Create docs/projects/auth")');
    const createButtonCount = await createButton.count();
    console.log('  Create button count for loaded path:', createButtonCount);

    expect(createButtonCount).toBe(0);
    console.log('  ✓ No Create button for already-loaded folder');

    // Final screenshot
    await page.screenshot({
      path: 'webapp/e2e-tests/screenshots/e2e-flow-step7-no-create-button.png',
      clip: { x: 0, y: 0, width: 500, height: 400 }
    });

    console.log('=== E2E Test PASSED: Complete flow verified ===');
  });

  test('add folder as write destination and verify state', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('=== E2E Test: Add folder as write destination ===');

    // Setup
    await setupMockElectronAPIWithNestedFolders(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);

    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(200);

    // Open folder selector
    const selectorButton = page.locator('button[title^="Write Path:"]');
    await selectorButton.click();
    await page.waitForTimeout(100);

    const dropdown = page.locator('.absolute.bottom-full.bg-card');
    await expect(dropdown).toBeVisible({ timeout: 3000 });

    // Navigate to docs/projects/
    const searchInput = dropdown.locator('input[placeholder*="folder"]');
    await searchInput.fill('docs/projects/');
    await page.waitForTimeout(300);

    const folderList = dropdown.locator('.max-h-\\[280px\\]');

    // Find the core folder and click Write button
    console.log('Clicking Write button on docs/projects/core...');
    const coreFolderRow = folderList.locator('.group:has-text("docs/projects/core")');
    await expect(coreFolderRow).toBeVisible();
    await coreFolderRow.hover();
    await page.waitForTimeout(150);

    const writeButton = coreFolderRow.locator('button:has-text("Write")');
    await expect(writeButton).toBeVisible({ timeout: 2000 });
    await writeButton.click();
    await page.waitForTimeout(300);

    // Verify the write path has changed
    const writingToSection = dropdown.locator('text=Writing to').locator('..');
    await expect(writingToSection).toBeVisible();

    const writingToText = await writingToSection.textContent();
    console.log('Writing to section:', writingToText);

    // The write path should now be docs/projects/core
    expect(writingToText).toContain('./docs/projects/core');
    console.log('  ✓ Write path updated to docs/projects/core');

    // Take screenshot
    await page.screenshot({
      path: 'webapp/e2e-tests/screenshots/e2e-flow-write-destination.png',
      clip: { x: 0, y: 0, width: 500, height: 400 }
    });

    console.log('=== E2E Test PASSED: Write destination updated correctly ===');
  });

  test('remove folder from read list and verify it returns to available', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('=== E2E Test: Remove folder from read list ===');

    // Setup
    await setupMockElectronAPIWithNestedFolders(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);

    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(200);

    // Open folder selector
    const selectorButton = page.locator('button[title^="Write Path:"]');
    await selectorButton.click();
    await page.waitForTimeout(100);

    const dropdown = page.locator('.absolute.bottom-full.bg-card');
    await expect(dropdown).toBeVisible({ timeout: 3000 });

    // First, add a folder
    const searchInput = dropdown.locator('input[placeholder*="folder"]');
    await searchInput.fill('docs/');
    await page.waitForTimeout(300);

    const folderList = dropdown.locator('.max-h-\\[280px\\]');
    const apiFolderRow = folderList.locator('.group:has-text("docs/api")');
    await expect(apiFolderRow).toBeVisible();
    await apiFolderRow.hover();
    await page.waitForTimeout(150);

    const readButton = apiFolderRow.locator('button:has-text("Read")');
    await readButton.click();
    await page.waitForTimeout(300);

    console.log('Added docs/api to read list');

    // Verify it's in the "Also reading" section
    let dropdownText = await dropdown.textContent();
    expect(dropdownText).toContain('./docs/api');
    console.log('  ✓ docs/api in Also reading section');

    // Now remove it
    console.log('Removing docs/api from read list...');
    const alsoReadingRow = dropdown.locator('.hover\\:bg-accent\\/50:has-text("./docs/api")');
    await expect(alsoReadingRow).toBeVisible();

    const removeButton = alsoReadingRow.locator('button[title="Remove from read list"]');
    await expect(removeButton).toBeVisible();
    await removeButton.click();
    await page.waitForTimeout(300);

    // Verify it's removed from "Also reading"
    dropdownText = await dropdown.textContent();

    // Search for it again to verify it's back in available folders
    await searchInput.fill('docs/');
    await page.waitForTimeout(300);

    const folderListText = await folderList.textContent();
    console.log('Available folders after removal:', folderListText);

    // docs/api should be back in available folders
    expect(folderListText).toContain('docs/api');
    console.log('  ✓ docs/api back in available folders');

    // Take screenshot
    await page.screenshot({
      path: 'webapp/e2e-tests/screenshots/e2e-flow-remove-folder.png',
      clip: { x: 0, y: 0, width: 500, height: 400 }
    });

    console.log('=== E2E Test PASSED: Remove folder flow verified ===');
  });

});

export { test };
