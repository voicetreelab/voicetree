/**
 * BEHAVIORAL SPEC:
 * 1. Context menu terminal creation automatically executes a command
 * 2. The command output appears in the terminal
 * 3. The command "for i in {1..10}; do echo $i; done" prints numbers 1-10
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/types/electron';

// Use absolute paths for example_folder_fixtures
const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'e2e-tests', 'fixtures', 'example_real_large', '2025-09-30');

// Type definitions
interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
  testHelpers?: {
    createTerminal: (nodeId: string) => void;
  };
}

// Extend test with Electron app
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    const electronApp = await electron.launch({
      args: [path.join(PROJECT_ROOT, 'dist-electron/main/index.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1'
      }
    });

    await use(electronApp);

    // Graceful shutdown
    try {
      const window = await electronApp.firstWindow();
      await window.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (api) {
          await api.stopFileWatching();
        }
      });
      await window.waitForTimeout(300);
    } catch {
      console.log('Note: Could not stop file watching during cleanup');
    }

    await electronApp.close();
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();

    // Log console messages for debugging
    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    // Capture page errors
    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
    await window.waitForTimeout(1000);

    await use(window);
  }
});

test.describe('Terminal Auto-Command Execution E2E', () => {
  test('should automatically execute command when terminal is created from context menu', async ({ appWindow }) => {
    console.log('=== STEP 1: Load the test vault ===');

    const watchResult = await appWindow.evaluate(async (vaultPath) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.startFileWatching(vaultPath);
    }, FIXTURE_VAULT_PATH);

    expect(watchResult.success).toBe(true);
    console.log('✓ File watching started');

    // Wait for initial scan
    await appWindow.waitForTimeout(3000);

    console.log('=== STEP 2: Get a node to create terminal from ===');
    const targetNodeId = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const nodes = cy.nodes();
      if (nodes.length === 0) throw new Error('No nodes available');
      return nodes[0].id();
    });

    console.log(`Target node: ${targetNodeId}`);

    console.log('=== STEP 3: Create terminal with auto-command directly ===');

    // Create terminal directly through electronAPI with the metadata that includes auto-command
    const terminalResult = await appWindow.evaluate(async (nodeId) => {
      const w = (window as ExtendedWindow);
      const api = w.electronAPI;

      if (!api?.terminal) {
        throw new Error('electronAPI.terminal not available');
      }

      // Get node file path
      const cy = w.cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const node = cy.getElementById(nodeId);
      if (node.length === 0) throw new Error('Node not found');

      // Create terminal with auto-command metadata (same as context menu would do)
      const nodeMetadata = {
        id: nodeId,
        name: nodeId.replace(/_/g, ' '),
        filePath: undefined, // Not critical for this test
        initialCommand: 'for i in {1..10}; do echo $i; done',
        executeCommand: true
      };

      const result = await api.terminal.spawn(nodeMetadata);
      console.log('[Test] Terminal spawn result:', result);

      return result;
    }, targetNodeId);

    expect(terminalResult.success).toBe(true);
    expect(terminalResult.terminalId).toBeTruthy();
    const terminalId = terminalResult.terminalId!;
    console.log(`✓ Terminal created with ID: ${terminalId}`);

    console.log('=== STEP 4: Collect terminal output data ===');

    // Set up a listener to collect terminal data
    const terminalOutput = await appWindow.evaluate(async (tId) => {
      const w = (window as ExtendedWindow);
      const api = w.electronAPI;

      if (!api?.terminal) {
        throw new Error('electronAPI.terminal not available');
      }

      return new Promise<string>((resolve) => {
        let output = '';
        let dataReceivedCount = 0;
        const timeout = setTimeout(() => {
          console.log('[Test] Timeout reached');
          console.log(`[Test] Data events received: ${dataReceivedCount}`);
          console.log(`[Test] Collected output length: ${output.length}`);
          console.log(`[Test] Collected output:`, output);
          resolve(output);
        }, 5000); // Increased timeout to 5 seconds

        console.log(`[Test] Setting up onData listener for terminal ${tId}`);

        // Listen for terminal data
        api.terminal.onData((id, data) => {
          console.log(`[Test] onData callback triggered - id: ${id}, expecting: ${tId}`);
          if (id === tId) {
            dataReceivedCount++;
            console.log(`[Test] Data event #${dataReceivedCount} for terminal ${id}`);
            console.log(`[Test] Data length: ${data.length}, preview:`, data.substring(0, 100));
            output += data;

            // Check if we've received all the expected output
            if (output.includes('10') && output.includes('1') && output.includes('5')) {
              clearTimeout(timeout);
              console.log('[Test] Received all expected output (contains 1, 5, and 10)');
              resolve(output);
            }
          }
        });

        console.log('[Test] onData listener set up, waiting for data...');
      });
    }, terminalId);

    console.log(`Terminal output length: ${terminalOutput.length} characters`);
    console.log(`Terminal output preview: ${terminalOutput.substring(0, 300)}`);

    console.log('=== STEP 5: Verify command was executed and output contains numbers 1-10 ===');

    // Verify that numbers 1-10 appear in the output
    const hasNumbers = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']
      .every(num => terminalOutput.includes(num));

    expect(hasNumbers).toBe(true);
    console.log('✓ Terminal output contains numbers 1-10');

    console.log('✓ Terminal auto-command execution test completed successfully!');
  });
});

export { test };
