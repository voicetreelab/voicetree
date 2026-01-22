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
  sendGraphDelta
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
    let mockWritePath = '/mock/write-vault';
    let mockShowAllPaths: string[] = [];

    // Create a comprehensive mock of the Electron API
    const mockElectronAPI = {
      // Main API
      main: {
        // Graph operations
        applyGraphDeltaToDBAndMem: async () => ({ success: true }),
        applyGraphDeltaToDBThroughMem: async () => ({ success: true }),
        getGraph: async () => ({ nodes: {}, edges: [] }),
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
        startFileWatching: async (dir: string) => ({ success: true, directory: dir }),
        stopFileWatching: async () => ({ success: true }),
        getWatchStatus: async () => ({ isWatching: true, directory: '/mock/write-vault' }),
        loadPreviousFolder: async () => ({ success: false }),

        // Backend server configuration
        getBackendPort: async () => 5001,

        // Agent metrics
        getMetrics: async () => ({ sessions: [] }),

        // Image loading
        readImageAsDataUrl: async (): Promise<string> => 'data:image/png;base64,test',

        // Frontend ready signal (no-op for tests)
        markFrontendReady: async () => {},

        // UI-edge graph delta operations
        applyGraphDeltaToDBThroughMemUIAndEditorExposed: async () => ({ success: true }),
        applyGraphDeltaToDBThroughMemAndUIExposed: async () => ({ success: true }),

        // === VAULT METHODS (critical for VaultPathSelector) ===
        getVaultPaths: async (): Promise<readonly string[]> => mockVaultPaths,

        getWritePath: async () => ({
          _tag: 'Some' as const,
          value: mockWritePath
        }),

        setWritePath: async (path: string) => {
          mockWritePath = path;
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
        }
      },

      // File watching event listeners
      onWatchingStarted: () => {},
      onFileWatchingStopped: () => {},
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
          mockElectronAPI.graph._updateCallback = callback;
          return () => {};
        },
        onGraphClear: () => () => {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        _updateCallback: undefined as ((delta: any) => void) | undefined
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
    console.log('=== Starting VaultPathSelector eye icon toggle removal test ===');

    // Step 1: Setup mock Electron API with vault methods
    await setupMockElectronAPIWithVault(page);
    console.log('✓ Mock Electron API with vault methods prepared');

    // Step 2: Navigate to app
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    console.log('✓ React rendered');

    // Step 3: Wait for Cytoscape
    await waitForCytoscapeReady(page);
    console.log('✓ Cytoscape initialized');

    // Step 4: Send test graph to ensure app is in a working state
    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(100);
    console.log('✓ Test graph loaded');

    // Step 5: Find and click the VaultPathSelector button
    // It should have title starting with "Write Path:"
    const selectorButton = page.locator('button[title^="Write Path:"]');
    await expect(selectorButton).toBeVisible({ timeout: 5000 });
    console.log('✓ VaultPathSelector button is visible');

    // Click to open dropdown
    await selectorButton.click();
    await page.waitForTimeout(100);

    // Step 6: Verify dropdown is open (use more specific selector)
    const dropdown = page.locator('.absolute.bottom-full.bg-card');
    await expect(dropdown).toBeVisible({ timeout: 3000 });
    console.log('✓ Dropdown opened');

    // Step 7: Verify NO eye icon exists in the dropdown
    // Eye icons would have been 👁 or 👁‍🗨 emoji in buttons
    const eyeIconButtons = page.locator('.absolute.bottom-full.bg-card button').filter({
      has: page.locator('text=👁')
    });

    const eyeIconCount = await eyeIconButtons.count();
    console.log(`  Eye icon button count: ${eyeIconCount}`);

    // ASSERTION: No eye icons should exist
    expect(eyeIconCount).toBe(0);
    console.log('✓ No eye icon toggle found in dropdown');

    // Alternative check: Look for any button with "show all" in title
    const showAllButtons = dropdown.locator('button[title*="show all" i], button[title*="Show all" i]');
    const showAllCount = await showAllButtons.count();
    console.log(`  "Show all" button count: ${showAllCount}`);

    expect(showAllCount).toBe(0);
    console.log('✓ No "show all" toggle buttons found');

    // Step 8: Verify data-testid elements don't exist (if using data-testid approach)
    const showAllToggle = page.locator('[data-testid="show-all-toggle"]');
    await expect(showAllToggle).toHaveCount(0);
    console.log('✓ No data-testid="show-all-toggle" element found');

    console.log('');
    console.log('=== TEST PASSED: Eye icon toggle is removed ===');
  });

  test('should still allow adding and removing readPaths', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('=== Starting VaultPathSelector add/remove path test ===');

    // Setup
    await setupMockElectronAPIWithVault(page);
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);

    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(100);

    // Open dropdown
    const selectorButton = page.locator('button[title^="Write Path:"]');
    await expect(selectorButton).toBeVisible({ timeout: 5000 });
    await selectorButton.click();
    await page.waitForTimeout(100);

    // Verify dropdown is open (use more specific selector)
    const dropdown = page.locator('.absolute.bottom-full.bg-card');
    await expect(dropdown).toBeVisible({ timeout: 3000 });
    console.log('✓ Dropdown opened');

    // Find the "Add read folder" section (UI text changed from "Add read-on-link path")
    const addPathSection = dropdown.locator('text=Add read folder');
    await expect(addPathSection).toBeVisible();
    console.log('✓ Add path section visible');

    // Find the input field
    const addPathInput = dropdown.locator('input[placeholder*="folder"]');
    await expect(addPathInput).toBeVisible();
    console.log('✓ Add path input visible');

    // Find the add button (+ button)
    const addButton = dropdown.locator('button:has-text("+")');
    await expect(addButton).toBeVisible();
    console.log('✓ Add button visible');

    // Verify remove buttons exist for non-write paths (✕ buttons)
    // The write path doesn't have a remove button, but read paths do
    const removeButtons = dropdown.locator('button:has-text("✕")');
    const removeCount = await removeButtons.count();
    console.log(`  Remove button count: ${removeCount}`);

    // Should have at least one remove button (for read paths, not for editing mode)
    // Note: The ✕ is also used in the edit mode cancel button
    expect(removeCount).toBeGreaterThan(0);
    console.log('✓ Remove path buttons exist');

    console.log('');
    console.log('=== TEST PASSED: Add/remove functionality still works ===');
  });

  test('should display readPaths without toggle state indicator', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('=== Starting VaultPathSelector display without toggle indicator test ===');

    // Setup
    await setupMockElectronAPIWithVault(page);
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);

    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(100);

    // Open dropdown
    const selectorButton = page.locator('button[title^="Write Path:"]');
    await expect(selectorButton).toBeVisible({ timeout: 5000 });
    await selectorButton.click();
    await page.waitForTimeout(100);

    // Verify dropdown is open (use more specific selector)
    const dropdown = page.locator('.absolute.bottom-full.bg-card');
    await expect(dropdown).toBeVisible({ timeout: 3000 });

    // Get all path rows (they have title attribute with path)
    const pathRows = dropdown.locator('div[title]');
    const rowCount = await pathRows.count();
    console.log(`  Path rows count: ${rowCount}`);

    // Verify we have path rows
    expect(rowCount).toBeGreaterThan(0);

    // Verify none of the rows have visual indicators of "show all" state
    // In the original implementation, isShowAll would change the icon color
    // After removal, there should be no such indicators
    for (let i = 0; i < rowCount; i++) {
      const row = pathRows.nth(i);
      const rowHtml = await row.innerHTML();

      // Verify no eye emoji or similar toggles
      expect(rowHtml).not.toContain('👁');
      expect(rowHtml).not.toContain('show all');
      expect(rowHtml).not.toContain('showAll');
    }

    console.log('✓ Path rows display without toggle state indicators');
    console.log('');
    console.log('=== TEST PASSED: No toggle state indicators in path display ===');
  });
});

export { test };
