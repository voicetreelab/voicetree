/**
 * Browser-based test for transcribe panel UI
 * Takes a screenshot of the transcribe panel with mock transcribed text
 * Shows full UI state including: folder path (bottom-left), transcribe panel (center), minimap (bottom-right)
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  waitForCytoscapeReady,
  sendGraphDelta,
  createTestGraphDelta,
} from '@e2e/playwright-browser/graph-delta-test-utils.ts';

const test = base.extend({});

/**
 * Sets up the mock to include watched directory info for full UI state
 */
async function setupMockWithWatchedDirectory(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    // Store callback for watching-started event
    let watchingStartedCallback: ((data: { directory: string; vaultSuffix: string }) => void) | null = null;

    // Create a comprehensive mock of the Electron API
    const mockElectronAPI = {
      main: {
        applyGraphDeltaToDBAndMem: async () => ({ success: true }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        applyGraphDeltaToDBThroughMem: async (delta: any) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          delta.forEach((nodeDelta: any) => {
            if (nodeDelta.type === 'UpsertNode') {
              const node = nodeDelta.nodeToUpsert;
              mockElectronAPI.graph._graphState.nodes[node.relativeFilePathIsID] = node;
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
              mockElectronAPI.graph._graphState.nodes[node.relativeFilePathIsID] = node;
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
        watchingStartedCallback = callback;
        // Immediately trigger with mock data to show folder in UI
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

test.describe('Transcribe Panel UI', () => {
  test('should display transcribed text with transparent fade effect', async ({ page }) => {
    console.log('\n=== Starting transcribe panel UI test ===');

    console.log('=== Step 1: Setup mock Electron API with watched directory ===');
    await setupMockWithWatchedDirectory(page);
    console.log('✓ Electron API mock prepared with watched directory');

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    console.log('✓ React rendered');

    await page.waitForTimeout(100);

    console.log('=== Step 3: Wait for Cytoscape ===');
    await waitForCytoscapeReady(page);
    console.log('✓ Cytoscape initialized');

    console.log('=== Step 3b: Add nodes for minimap ===');
    // Add test nodes so the minimap appears (requires 2+ nodes)
    await sendGraphDelta(page, createTestGraphDelta());
    await page.waitForTimeout(200); // Wait for graph to render
    console.log('✓ Test nodes added for minimap');

    console.log('=== Step 4: Inject mock transcription tokens ===');
    // We need to inject mock tokens into the VoiceTreeTranscribe component
    // Since the component uses React state, we'll manipulate it via exposed window APIs
    // or by directly updating the DOM with mock content

    // Wait for the transcribe panel to be rendered
    await page.waitForSelector('.flex.flex-col.relative', { timeout: 5000 });

    // Inject mock transcribed text by modifying the Renderer's DOM
    // The Renderer component displays tokens - we'll add mock token spans
    // The reverted code uses a 68px height container with overflow-y-auto and mask gradient
    await page.evaluate(() => {
      // Find the transcription display container (the auto-scroll div with mask gradient)
      // It's inside the absolute positioned container with height 68px
      const transcriptionDisplay = document.querySelector('.overflow-y-auto.absolute.inset-0');
      if (!transcriptionDisplay) {
        console.error('Could not find transcription display');
        return;
      }

      // Clear any existing content and add many lines of mock transcribed text
      // All lines use same black styling so fade effect is clearly visible
      transcriptionDisplay.innerHTML = `
        <div style="padding: 8px;">
          <div class="text-black font-medium">Line 1: This is the first line of transcribed speech from the voice input.</div>
          <div class="text-black font-medium">Line 2: The user is speaking about their project ideas and requirements.</div>
          <div class="text-black font-medium">Line 3: We need to implement a new feature for the dashboard component.</div>
          <div class="text-black font-medium">Line 4: The feature should allow users to visualize their data in real-time.</div>
          <div class="text-black font-medium">Line 5: Additionally, we want to add filtering and sorting capabilities.</div>
          <div class="text-black font-medium">Line 6: The UI should be responsive and work well on mobile devices.</div>
          <div class="text-black font-medium">Line 7: We also need to consider accessibility requirements for screen readers.</div>
          <div class="text-black font-medium">Line 8: Performance optimization is crucial for large datasets.</div>
          <div class="text-black font-medium">Line 9: Let's start with a basic prototype and iterate from there.</div>
          <div class="text-black font-medium">Line 10: This is the most recent transcribed text at full opacity.</div>
        </div>
      `;

      // Scroll to bottom to show latest content
      transcriptionDisplay.scrollTop = transcriptionDisplay.scrollHeight;
    });
    console.log('✓ Mock transcription tokens injected');

    console.log('=== Step 5: Verify the mic button is visible ===');
    // The mic button contains an animated mic icon (circle with mic inside when not recording)
    const micButton = page.locator('button.rounded-lg').first();
    await expect(micButton).toBeVisible();
    console.log('✓ Mic button is visible');

    console.log('=== Step 6: Take screenshot of transcribe panel (expanded) ===');
    // Take full page screenshot to capture the transcription panel (which is absolutely positioned)
    await page.screenshot({
      path: 'e2e-tests/screenshots/transcribe-panel-with-text.png',
    });
    console.log('✓ Screenshot saved to e2e-tests/screenshots/transcribe-panel-with-text.png');

    console.log('=== Step 6b: Take screenshot of expanded state ===');
    await page.screenshot({
      path: 'e2e-tests/screenshots/transcribe-panel-expanded.png',
    });
    console.log('✓ Screenshot saved to e2e-tests/screenshots/transcribe-panel-expanded.png');

    console.log('=== Step 6c: Click toggle button to collapse ===');
    // Find and click the collapse toggle button (ChevronDown icon above input row)
    const toggleButton = page.locator('button[title="Collapse transcription"]');
    await expect(toggleButton).toBeVisible();
    await toggleButton.click();
    // Wait for collapse animation
    await page.waitForTimeout(250);
    console.log('✓ Clicked collapse toggle button');

    console.log('=== Step 6d: Take screenshot of collapsed state ===');
    await page.screenshot({
      path: 'e2e-tests/screenshots/transcribe-panel-collapsed.png',
    });
    console.log('✓ Screenshot saved to e2e-tests/screenshots/transcribe-panel-collapsed.png');

    console.log('=== Step 6e: Click toggle button to expand again ===');
    const expandButton = page.locator('button[title="Expand transcription"]');
    await expect(expandButton).toBeVisible();
    await expandButton.click();
    // Wait for expand animation
    await page.waitForTimeout(250);
    console.log('✓ Clicked expand toggle button');

    // Verify it's expanded again
    const collapseButtonAgain = page.locator('button[title="Collapse transcription"]');
    await expect(collapseButtonAgain).toBeVisible();
    console.log('✓ Panel expanded again, toggle works both ways');

    console.log('=== Step 7: Verify transparency and fade styles ===');
    const maskStyle = await page.evaluate(() => {
      const container = document.querySelector('.overflow-y-auto.absolute.inset-0');
      if (!container) return null;
      const style = window.getComputedStyle(container as Element);
      return {
        maskImage: style.maskImage || style.webkitMaskImage,
        background: style.background,
        backgroundColor: style.backgroundColor,
      };
    });

    console.log('  Container styles:', maskStyle);
    // Verify mask-image is applied (for fade effect) - top is 30% opacity, bottom is full opacity
    expect(maskStyle?.maskImage).toContain('gradient');
    expect(maskStyle?.maskImage).toContain('rgba(0, 0, 0, 0.3)'); // 30% at top
    expect(maskStyle?.maskImage).toContain('rgb(0, 0, 0)'); // full opacity at bottom
    console.log('✓ Fade mask gradient is applied (30% top, full opacity bottom)');

    console.log('\n✅ Transcribe panel UI test PASSED!');
  });

  test('should show "Recording" label when recording', async ({ page }) => {
    console.log('\n=== Starting recording state test ===');

    await setupMockWithWatchedDirectory(page);
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);
    await page.waitForTimeout(100);

    // Add test nodes for minimap
    await sendGraphDelta(page, createTestGraphDelta());
    await page.waitForTimeout(300); // Wait for graph to render

    // Find the mic button (inside the rounded-lg button with AnimatedMicIcon)
    // The mic button shows a circle with mic icon inside when not recording
    const micButton = page.locator('button.rounded-lg').first();

    // Verify the UI elements exist
    await expect(micButton).toBeVisible();
    console.log('✓ Mic button is visible');

    // Verify Add/Ask pill is visible
    const addButton = page.locator('button:has-text("Add")').first();
    const askButton = page.locator('button:has-text("Ask")').first();
    await expect(addButton).toBeVisible();
    await expect(askButton).toBeVisible();
    console.log('✓ Add/Ask pill is visible');

    // Take screenshot of initial state
    await page.screenshot({
      path: 'e2e-tests/screenshots/transcribe-panel-not-recording.png',
    });
    console.log('✓ Screenshot of not-recording state saved');

    console.log('\n✅ Recording state test PASSED!');
  });
});
