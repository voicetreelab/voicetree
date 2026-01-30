/**
 * BEHAVIORAL SPEC: Hotkey Settings Integration
 *
 * This test verifies that hotkeys respect user settings:
 * 1. Settings can override the default hotkey modifier (Meta -> Control)
 * 2. The hotkey works with the configured modifier after settings change
 *
 * EXPECTED OUTCOME:
 * When closeWindow hotkey is configured to use Control instead of Meta,
 * pressing Ctrl+W should close the editor window.
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';
import type { VTSettings, HotkeySettings } from '@/pure/settings/types';

// Use absolute paths
const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');

// Type definitions
interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

// Extend test with Electron app
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    // Create a temporary userData directory for this test
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-hotkey-test-'));

    // Write the config file to auto-load the test vault on startup
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: FIXTURE_VAULT_PATH }, null, 2), 'utf8');
    console.log('[Hotkey Test] Created config file to auto-load:', FIXTURE_VAULT_PATH);

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}` // Use temp userData to isolate test config
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
        VOICETREE_PERSIST_STATE: '1'
      },
      timeout: 10000
    });

    await use(electronApp);

    // Graceful shutdown
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

    // Cleanup temp directory
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 10000 });

    // Log console messages for debugging
    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    // Capture page errors
    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
      console.error('Stack:', error.stack);
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });

    // Wait a bit longer to ensure graph is ready
    await window.waitForTimeout(1000);

    await use(window);
  }
});

test.describe('Hotkey Settings Integration', () => {
  test('should close editor with Ctrl+W when hotkey is configured to use Control modifier', async ({ appWindow }) => {
    test.setTimeout(30000);

    console.log('=== STEP 1: Save original settings for later restoration ===');
    const originalSettings = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.loadSettings();
    }) as VTSettings;
    console.log('Original closeWindow modifier:', originalSettings.hotkeys?.closeWindow?.modifiers);

    console.log('=== STEP 2: Update settings to use Control modifier for closeWindow ===');
    await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');

      const currentSettings = await api.main.loadSettings();
      // Deep copy to remove readonly
      const testSettings = JSON.parse(JSON.stringify(currentSettings));

      // Set closeWindow to use Control modifier (simulating Windows settings)
      const controlHotkeys: HotkeySettings = {
        fitToLastNode: { key: ' ', modifiers: [] },
        nextTerminal: { key: ']', modifiers: ['Control'] },
        prevTerminal: { key: '[', modifiers: ['Control'] },
        createNewNode: { key: 'n', modifiers: ['Control'] },
        runTerminal: { key: 'Enter', modifiers: ['Control'] },
        deleteSelectedNodes: { key: 'Backspace', modifiers: ['Control'] },
        closeWindow: { key: 'w', modifiers: ['Control'] },
        openSettings: { key: ',', modifiers: ['Control'] },
        openSearch: { key: 'f', modifiers: ['Control'] },
        openSearchAlt: { key: 'e', modifiers: ['Control'] },
        recentNode1: { key: '1', modifiers: ['Control'] },
        recentNode2: { key: '2', modifiers: ['Control'] },
        recentNode3: { key: '3', modifiers: ['Control'] },
        recentNode4: { key: '4', modifiers: ['Control'] },
        recentNode5: { key: '5', modifiers: ['Control'] },
        voiceRecording: { key: 'r', modifiers: ['Alt'] },
      };

      testSettings.hotkeys = controlHotkeys;
      await api.main.saveSettings(testSettings);
    });
    console.log('Settings updated with Control modifier');

    console.log('=== STEP 3: Reload the page to pick up new hotkey settings ===');
    // Hotkeys are loaded when VoiceTreeGraphView initializes, so we need to reload
    await appWindow.reload();
    await appWindow.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
    await appWindow.waitForTimeout(1500); // Wait for hotkeys to be set up (async)

    console.log('=== STEP 4: Verify settings were saved correctly ===');
    const savedSettings = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.loadSettings();
    }) as VTSettings;

    expect(savedSettings.hotkeys?.closeWindow?.modifiers).toContain('Control');
    console.log('Verified closeWindow uses Control modifier');

    console.log('=== STEP 5: Wait for graph nodes to load ===');
    await appWindow.waitForFunction(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return false;
      return cy.nodes().length >= 2;
    }, { timeout: 10000 });
    console.log('Nodes loaded');

    console.log('=== STEP 6: Get a node and open its editor ===');
    const nodeId = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const nodes = cy.nodes();
      if (nodes.length === 0) throw new Error('No nodes available');
      // Get the first node
      return nodes[0].id();
    });
    console.log(`Using node: ${nodeId}`);

    // Tap the node to open editor
    await appWindow.evaluate((nId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById(nId);
      if (node.length === 0) throw new Error(`Node ${nId} not found`);
      node.trigger('tap');
    }, nodeId);

    // Wait for editor window to appear
    const editorWindowId = `window-${nodeId}-editor`;
    await expect.poll(async () => {
      return appWindow.evaluate((winId) => {
        const editorWindow = document.getElementById(winId);
        return editorWindow !== null;
      }, editorWindowId);
    }, {
      message: 'Waiting for editor window to appear',
      timeout: 5000
    }).toBe(true);
    console.log('Editor window opened');

    // Small delay to ensure hotkey manager is ready
    await appWindow.waitForTimeout(500);

    console.log('=== STEP 7: Press Ctrl+W to close the editor ===');
    // Press Ctrl+W (not Cmd+W) - this should work because we configured Control modifier
    await appWindow.keyboard.press('Control+w');

    // Wait for editor to close
    await appWindow.waitForTimeout(500);

    console.log('=== STEP 8: Verify editor window is closed ===');
    const editorExists = await appWindow.evaluate((winId) => {
      const editorWindow = document.getElementById(winId);
      return editorWindow !== null;
    }, editorWindowId);

    expect(editorExists).toBe(false);
    console.log('Editor window closed successfully via Ctrl+W');

    console.log('=== STEP 9: Restore original settings ===');
    await appWindow.evaluate(async (original) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      await api.main.saveSettings(original);
    }, originalSettings);
    console.log('Original settings restored');

    console.log('');
    console.log('=== TEST SUMMARY ===');
    console.log('Hotkey settings configured to use Control modifier');
    console.log('Editor opened successfully');
    console.log('Ctrl+W closed the editor (respecting settings)');
    console.log('Original settings restored');
    console.log('');
    console.log('PASS: Hotkey settings are correctly applied');
  });
});

export { test };
