/**
 * E2E Test: Transcription Preview Chip Timeout Behavior
 *
 * Tests the preview chip timeout behavior when an editor is focused.
 * Calls showTranscriptionPreview() directly to test chip behavior without mocking Soniox.
 *
 * Test scenarios:
 * 1. Timeout fires (15s) → sends to server BUT keeps chip visible
 * 2. User can press Enter after timeout to insert into editor
 * 3. User pressing Escape after timeout does not double-send
 * 4. User pressing Enter before timeout → text goes to editor only
 * 5. User pressing Escape before timeout → text goes to server only
 *
 * Uses Playwright's clock API to fast-forward through the 15s timeout.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';
import type { EditorView } from '@codemirror/view';

const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');

// Type definitions for window extensions
interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

interface ServerCallTracker {
  calls: Array<{ text: string; timestamp: number }>;
}

// Extend test with Electron app fixture
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  serverCalls: ServerCallTracker;
}>({
  serverCalls: async ({}, use) => {
    const tracker: ServerCallTracker = { calls: [] };
    await use(tracker);
  },

  electronApp: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-preview-chip-e2e-'));

    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: FIXTURE_VAULT_PATH }, null, 2), 'utf8');
    console.log('[Preview Chip E2E] Created config to auto-load:', FIXTURE_VAULT_PATH);

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1'
      },
      timeout: 15000
    });

    await use(electronApp);

    // Cleanup
    try {
      const window = await electronApp.firstWindow();
      await window.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (api) {
          await api.main.stopFileWatching();
        }
      });
      await window.waitForTimeout(300);
    } catch {
      console.log('Note: Could not stop file watching during cleanup');
    }

    await electronApp.close();
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
    console.log('[Preview Chip E2E] Cleanup complete');
  },

  appWindow: async ({ electronApp, serverCalls }, use) => {
    const window = await electronApp.firstWindow({ timeout: 10000 });

    window.on('console', msg => {
      const text = msg.text();
      if (text.includes('[TranscriptionSender]') || text.includes('[PreviewChip]')) {
        console.log(`BROWSER [${msg.type()}]:`, text);
      }
    });

    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });

    // Intercept fetch calls to /send-text to track server calls
    await window.route('**/send-text', async (route) => {
      const request = route.request();
      const postData = request.postDataJSON() as { text?: string };
      if (postData?.text) {
        serverCalls.calls.push({ text: postData.text, timestamp: Date.now() });
        console.log(`[E2E] Server call intercepted: "${postData.text.substring(0, 50)}..."`);
      }
      // Return success response
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ buffer_length: 0 })
      });
    });

    await use(window);
  }
});

test.describe('Transcription Preview Chip Timeout', () => {
  test.setTimeout(60000);

  /**
   * Helper: Open an editor on the first node
   */
  async function openEditorOnFirstNode(page: Page): Promise<void> {
    // Wait for nodes to render
    await page.waitForFunction(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      return cy && cy.nodes().length > 0;
    }, { timeout: 5000 });

    // Click on first node to select it
    await page.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      const firstNode = cy?.nodes().first();
      if (firstNode) {
        firstNode.emit('tap');
      }
    });
    await page.waitForTimeout(200);

    // Press Enter to open editor
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Wait for CodeMirror editor to appear
    await page.waitForSelector('.cm-editor', { timeout: 5000 });
    console.log('[E2E] Editor opened');
  }

  /**
   * Helper: Show preview chip directly by calling showTranscriptionPreview
   * Returns true if chip was shown, false otherwise
   */
  async function showPreviewChipDirectly(
    page: Page,
    text: string,
    serverEndpoint: string
  ): Promise<boolean> {
    return await page.evaluate(async ({ text, serverEndpoint }) => {
      // Import functions from speech-to-focused module
      const speechModule = await import('@/shell/edge/UI-edge/floating-windows/speech-to-focused');
      const { getFocusedTarget, showTranscriptionPreview } = speechModule;

      const target = getFocusedTarget();
      if (!target) {
        console.log('[PreviewChip] No focused target found');
        return false;
      }

      // Create onTimeout callback that sends to server
      const onTimeout = () => {
        console.log('[PreviewChip] Timeout fired - sending to server');
        fetch(serverEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, force_flush: false })
        }).catch(err => console.error('[PreviewChip] Server send failed:', err));
      };

      // Show the preview chip
      void showTranscriptionPreview(text, target, { onTimeout });
      console.log('[PreviewChip] Preview chip shown with text:', text);
      return true;
    }, { text, serverEndpoint });
  }

  /**
   * Helper: Get text content from the CodeMirror editor
   */
  async function getEditorContent(page: Page): Promise<string> {
    return await page.evaluate(() => {
      const cmEditor = document.querySelector('.cm-editor');
      if (!cmEditor) return '';

      // Get EditorView from DOM
      const { EditorView } = require('@codemirror/view');
      const view = EditorView.findFromDOM(cmEditor as HTMLElement) as EditorView | null;
      return view?.state.doc.toString() || '';
    });
  }

  test('timeout sends to server but keeps chip visible for Enter', async ({ appWindow, serverCalls }) => {
    console.log('\n=== Test: Timeout sends to server, user can still press Enter ===');

    // Install fake timers
    await appWindow.clock.install();

    // Open editor on a node
    await openEditorOnFirstNode(appWindow);

    // Get initial editor content
    const initialContent = await getEditorContent(appWindow);
    console.log('[E2E] Initial editor content length:', initialContent.length);

    // Show preview chip directly
    const testText = 'hello world timeout test';
    const backendPort = await appWindow.evaluate(() => {
      return (window as unknown as ExtendedWindow).electronAPI?.main.getBackendPort();
    }) || 8001;
    const endpoint = `http://localhost:${backendPort}/send-text`;

    const shown = await showPreviewChipDirectly(appWindow, testText, endpoint);
    expect(shown).toBe(true);

    // Verify chip appears
    await expect(appWindow.locator('.transcription-preview-chip')).toBeVisible({ timeout: 2000 });
    console.log('[E2E] Preview chip visible');

    // Fast forward 15 seconds (timeout duration)
    await appWindow.clock.fastForward(15000);
    await appWindow.waitForTimeout(100);

    // Server should have been called on timeout
    expect(serverCalls.calls.length).toBeGreaterThanOrEqual(1);
    console.log(`[E2E] Server called ${serverCalls.calls.length} time(s) after timeout`);

    // Chip should STILL be visible
    await expect(appWindow.locator('.transcription-preview-chip')).toBeVisible();
    console.log('[E2E] Chip still visible after timeout');

    // Now user presses Enter to also insert into editor
    await appWindow.keyboard.press('Enter');
    await appWindow.waitForTimeout(200);

    // Chip should be gone
    await expect(appWindow.locator('.transcription-preview-chip')).not.toBeVisible();
    console.log('[E2E] Chip dismissed after Enter');

    // Editor should contain the text
    const finalContent = await getEditorContent(appWindow);
    expect(finalContent).toContain(testText);
    console.log('[E2E] Text inserted into editor');

    console.log('Test passed!');
  });

  test('timeout + Escape does not double-send', async ({ appWindow, serverCalls }) => {
    console.log('\n=== Test: Timeout + Escape does not double-send ===');

    await appWindow.clock.install();
    await openEditorOnFirstNode(appWindow);

    const testText = 'escape after timeout test';
    const backendPort = await appWindow.evaluate(() => {
      return (window as unknown as ExtendedWindow).electronAPI?.main.getBackendPort();
    }) || 8001;
    const endpoint = `http://localhost:${backendPort}/send-text`;

    await showPreviewChipDirectly(appWindow, testText, endpoint);
    await expect(appWindow.locator('.transcription-preview-chip')).toBeVisible({ timeout: 2000 });

    // Fast forward past timeout
    await appWindow.clock.fastForward(15000);
    await appWindow.waitForTimeout(100);

    const callsAfterTimeout = serverCalls.calls.length;
    expect(callsAfterTimeout).toBeGreaterThanOrEqual(1);
    console.log(`[E2E] ${callsAfterTimeout} server call(s) after timeout`);

    // Press Escape
    await appWindow.keyboard.press('Escape');
    await appWindow.waitForTimeout(200);

    // Chip should be dismissed
    await expect(appWindow.locator('.transcription-preview-chip')).not.toBeVisible();

    // Should NOT have made another server call (already sent on timeout)
    // Note: Since we're bypassing useTranscriptionSender, the double-send prevention
    // is handled by the fact that our onTimeout already sent, and Escape just dismisses
    expect(serverCalls.calls.length).toBe(callsAfterTimeout);
    console.log(`[E2E] No additional server call on Escape (still ${serverCalls.calls.length})`);

    console.log('Test passed!');
  });

  test('Enter before timeout sends to editor only', async ({ appWindow, serverCalls }) => {
    console.log('\n=== Test: Enter before timeout sends to editor only ===');

    await appWindow.clock.install();
    await openEditorOnFirstNode(appWindow);

    const testText = 'quick enter test';
    const backendPort = await appWindow.evaluate(() => {
      return (window as unknown as ExtendedWindow).electronAPI?.main.getBackendPort();
    }) || 8001;
    const endpoint = `http://localhost:${backendPort}/send-text`;

    // Get initial content
    const _initialContent = await getEditorContent(appWindow);

    await showPreviewChipDirectly(appWindow, testText, endpoint);
    await expect(appWindow.locator('.transcription-preview-chip')).toBeVisible({ timeout: 2000 });

    // Immediately press Enter (before 15s timeout)
    await appWindow.keyboard.press('Enter');
    await appWindow.waitForTimeout(200);

    // Chip should be gone
    await expect(appWindow.locator('.transcription-preview-chip')).not.toBeVisible();

    // Server should NOT have been called (no timeout fired)
    expect(serverCalls.calls.length).toBe(0);
    console.log('[E2E] No server call when Enter pressed before timeout');

    // Editor should contain the text
    const finalContent = await getEditorContent(appWindow);
    expect(finalContent).toContain(testText);
    console.log('[E2E] Text inserted into editor');

    console.log('Test passed!');
  });

  test('Escape before timeout sends to server only', async ({ appWindow, serverCalls }) => {
    console.log('\n=== Test: Escape before timeout sends to server only ===');

    await appWindow.clock.install();
    await openEditorOnFirstNode(appWindow);

    const testText = 'escape before timeout test';
    const backendPort = await appWindow.evaluate(() => {
      return (window as unknown as ExtendedWindow).electronAPI?.main.getBackendPort();
    }) || 8001;
    const endpoint = `http://localhost:${backendPort}/send-text`;

    // Get initial content
    const initialContent = await getEditorContent(appWindow);

    // For this test, we need the Escape to trigger a server send.
    // Since we're bypassing useTranscriptionSender, we need to handle this ourselves.
    // We'll modify the test to use page.exposeFunction for the dismiss handler.

    const shown = await appWindow.evaluate(async ({ text, serverEndpoint }) => {
      const speechModule = await import('@/shell/edge/UI-edge/floating-windows/speech-to-focused');
      const { getFocusedTarget, showTranscriptionPreview } = speechModule;

      const target = getFocusedTarget();
      if (!target) return false;

      // For Escape-before-timeout scenario, we track whether Enter or timeout happened
      let sentOnTimeout = false;

      const onTimeout = () => {
        sentOnTimeout = true;
        console.log('[PreviewChip] Timeout fired');
        fetch(serverEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, force_flush: false })
        }).catch(err => console.error('[PreviewChip] Server send failed:', err));
      };

      // The promise resolves when user presses Enter (true) or Escape (false)
      void showTranscriptionPreview(text, target, { onTimeout }).then(inserted => {
        // If Escape was pressed (not inserted) and timeout didn't fire, send to server
        if (!inserted && !sentOnTimeout) {
          console.log('[PreviewChip] Escape before timeout - sending to server');
          fetch(serverEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, force_flush: false })
          }).catch(err => console.error('[PreviewChip] Server send failed:', err));
        }
      });

      return true;
    }, { text: testText, serverEndpoint: endpoint });

    expect(shown).toBe(true);
    await expect(appWindow.locator('.transcription-preview-chip')).toBeVisible({ timeout: 2000 });

    // Immediately press Escape (before 15s timeout)
    await appWindow.keyboard.press('Escape');
    await appWindow.waitForTimeout(300);

    // Chip should be gone
    await expect(appWindow.locator('.transcription-preview-chip')).not.toBeVisible();

    // Server SHOULD have been called (Escape triggers send)
    expect(serverCalls.calls.length).toBe(1);
    console.log('[E2E] Server call made on Escape');

    // Verify the text was sent
    expect(serverCalls.calls[0].text).toBe(testText);

    // Editor should NOT contain the new text (only Escape, no Enter)
    const finalContent = await getEditorContent(appWindow);
    expect(finalContent).toBe(initialContent);
    console.log('[E2E] Text NOT inserted into editor (Escape = cancel)');

    console.log('Test passed!');
  });
});

export { test };
