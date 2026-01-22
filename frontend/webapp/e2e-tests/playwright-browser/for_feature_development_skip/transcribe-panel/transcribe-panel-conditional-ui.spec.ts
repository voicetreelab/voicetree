/**
 * E2E test for transcription panel conditional UI elements
 * Tests that blur background and collapse arrow only appear when there is text in the transcription panel
 */

import { test as base, expect } from '@playwright/test';
import {
  waitForCytoscapeReady,
  sendGraphDelta,
  createTestGraphDelta,
} from '@e2e/playwright-browser/graph-delta-test-utils';

const test = base.extend({});

/**
 * Sets up the mock Electron API with watched directory for full UI state
 */
async function setupMockWithWatchedDirectory(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    const mockElectronAPI = {
      main: {
        applyGraphDeltaToDBAndMem: async () => ({ success: true }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        applyGraphDeltaToDBThroughMem: async (delta: any) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          delta.forEach((nodeDelta: any) => {
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
        getGraph: async () => mockElectronAPI.graph._graphState,
        loadSettings: async () => ({
          terminalSpawnPathRelativeToWatchedDirectory: '../',
          agents: [{ name: 'Claude', command: './claude.sh' }],
          shiftEnterSendsOptionEnter: true
        }),
        saveSettings: async () => ({ success: true }),
        saveNodePositions: async () => ({ success: true }),
        startFileWatching: async (dir: string) => {
          console.log('[Mock] startFileWatching called with:', dir);
          return { success: true, directory: dir };
        },
        stopFileWatching: async () => ({ success: true }),
        getWatchStatus: async () => ({ isWatching: true, directory: '/Users/demo/projects/my-notes' }),
        loadPreviousFolder: async () => ({ success: false }),
        getBackendPort: async () => 5001,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        applyGraphDeltaToDBThroughMemUIAndEditorExposed: async (delta: any) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          delta.forEach((nodeDelta: any) => {
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
      },
      onWatchingStarted: (callback: (data: { directory: string; vaultSuffix: string }) => void) => {
        setTimeout(() => {
          callback({ directory: '/Users/demo/projects/my-notes', vaultSuffix: 'voicetree' });
        }, 50);
      },
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _ipcListeners: {} as Record<string, ((event: unknown, ...args: any[]) => void)[]>,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      on: (channel: string, callback: (event: unknown, ...args: any[]) => void) => {
        if (!mockElectronAPI._ipcListeners[channel]) {
          mockElectronAPI._ipcListeners[channel] = [];
        }
        mockElectronAPI._ipcListeners[channel].push(callback);
        return () => {};
      },
      off: () => {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _triggerIpc: (channel: string, ...args: any[]) => {
        const listeners = mockElectronAPI._ipcListeners[channel] || [];
        listeners.forEach(cb => cb(null, ...args));
      }
    };

    (window as unknown as { electronAPI: typeof mockElectronAPI }).electronAPI = mockElectronAPI;
  });
}

test.describe('Transcription Panel Conditional UI Elements', () => {
  test('should only show blur and collapse arrow when text is present', async ({ page }) => {
    console.log('\n=== Starting transcription panel conditional UI test ===');

    // Setup mock Electron API
    await setupMockWithWatchedDirectory(page);

    // Navigate to app
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(100);

    // Wait for Cytoscape
    await waitForCytoscapeReady(page);

    // Add test nodes for minimap
    await sendGraphDelta(page, createTestGraphDelta());
    await page.waitForTimeout(200);

    // Locators for conditional UI elements
    const blurLayer = page.locator('div[style*="backdropFilter"]').first();
    const collapseButton = page.locator('button[title="Collapse transcription"]');
    const expandButton = page.locator('button[title="Expand transcription"]');

    // === TEST 1: Empty state - no blur layer, no collapse arrow ===
    console.log('=== Verifying empty state (no text) ===');
    await expect(blurLayer).not.toBeVisible();
    await expect(collapseButton).not.toBeVisible();
    await expect(expandButton).not.toBeVisible();
    console.log('✓ Empty state: no blur layer, no collapse arrow');

    // Screenshot: Empty state
    await page.screenshot({
      path: 'e2e-tests/screenshots/transcribe-panel-empty-state.png',
    });
    console.log('✓ Screenshot: transcribe-panel-empty-state.png');

    // === TEST 2: Add text via TranscriptionStore ===
    console.log('=== Adding text to transcription store ===');
    await page.evaluate(() => {
      // TranscriptionStore exposes appendManualText on window.__TRANSCRIPTION_STORE__
      interface TranscriptionStoreAPI {
        appendManualText: (text: string) => void;
        reset: () => void;
        getDisplayTokenCount: () => number;
      }
      const store = (window as Window & { __TRANSCRIPTION_STORE__?: TranscriptionStoreAPI }).__TRANSCRIPTION_STORE__;
      if (store) {
        store.appendManualText('Test transcription text for visual verification');
      } else {
        console.error('TranscriptionStore not exposed on window');
      }
    });

    // Wait for React to update
    await page.waitForTimeout(300);

    // === TEST 3: With text - blur layer AND collapse arrow should be visible ===
    console.log('=== Verifying state with text ===');
    await expect(blurLayer).toBeVisible();
    await expect(collapseButton).toBeVisible();
    console.log('✓ With text: blur layer and collapse arrow visible');

    // Screenshot: With text (blur visible)
    await page.screenshot({
      path: 'e2e-tests/screenshots/transcribe-panel-with-text-blur-visible.png',
    });
    console.log('✓ Screenshot: transcribe-panel-with-text-blur-visible.png');

    // === TEST 4: Collapse panel - arrow should rotate ===
    console.log('=== Collapsing panel ===');
    await collapseButton.click();
    await page.waitForTimeout(250); // Wait for animation

    // After collapse, expand button should be visible (arrow rotated)
    await expect(expandButton).toBeVisible();
    console.log('✓ Panel collapsed, expand button visible');

    // Screenshot: Collapsed state
    await page.screenshot({
      path: 'e2e-tests/screenshots/transcribe-panel-collapsed-with-text.png',
    });
    console.log('✓ Screenshot: transcribe-panel-collapsed-with-text.png');

    // === TEST 5: Expand again to verify toggle works ===
    console.log('=== Expanding panel again ===');
    await expandButton.click();
    await page.waitForTimeout(250);
    await expect(collapseButton).toBeVisible();
    console.log('✓ Panel expanded again');

    console.log('\n✅ Transcription panel conditional UI test PASSED!');
  });
});
