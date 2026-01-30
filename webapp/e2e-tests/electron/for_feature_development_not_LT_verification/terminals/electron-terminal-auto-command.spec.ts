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
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

// Use absolute paths for example_folder_fixtures
const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_real_large', '2025-09-30');

// Type definitions (already uses ElectronAPI from types)
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
    // Create a temporary userData directory for this test
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-auto-cmd-test-'));

    // Write the config file to auto-load the test vault
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({
      lastDirectory: FIXTURE_VAULT_PATH,
      suffixes: {
        [FIXTURE_VAULT_PATH]: '' // Empty suffix means use directory directly
      }
    }, null, 2), 'utf8');
    console.log('[Test] Created config file to auto-load:', FIXTURE_VAULT_PATH);

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}` // Use temp userData to isolate test config
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1'
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
    const window = await electronApp.firstWindow({ timeout: 15000});

    // Log console messages for debugging
    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    // Capture page errors
    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');

    // Wait for cytoscape instance with retry logic
    try {
      await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
    } catch (error) {
      console.error('Failed to initialize cytoscape instance:', error);
      throw error;
    }

    await window.waitForTimeout(1000);

    await use(window);
  }
});

test.describe('Terminal Auto-Command Execution E2E', () => {
  test('should automatically execute command when terminal is created from context menu', async ({ appWindow }) => {
    test.setTimeout(60000); // Increase timeout for large graph loading

    console.log('=== STEP 1: Wait for auto-load to complete ===');
    // The app auto-loads from config file on startup, wait for nodes to appear
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) return 0;
        return cy.nodes().length;
      });
    }, {
      message: 'Waiting for graph to auto-load nodes',
      timeout: 20000,
      intervals: [500, 1000, 1000, 2000]
    }).toBeGreaterThan(0);

    console.log('✓ Graph auto-loaded with nodes');

    console.log('=== STEP 2: Get a node to create terminal from ===');
    const targetNodeId = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const nodes = cy.nodes();
      if (nodes.length === 0) throw new Error('No nodes available');
      return nodes[0].id();
    });

    console.log(`Target node: ${targetNodeId}`);

    console.log('=== STEP 3: Set up terminal data listener BEFORE spawning ===');

    // Set up promise to collect output - must be done BEFORE spawning terminal
    // to avoid race condition where output arrives before listener is attached
    const terminalOutputPromise = appWindow.evaluate(async (nodeId) => {
      const w = (window as ExtendedWindow);
      const api = w.electronAPI;

      if (!api?.terminal) {
        throw new Error('electronAPI.terminal not available');
      }

      return new Promise<{ terminalId: string; output: string }>((resolve) => {
        let output = '';
        let dataReceivedCount = 0;
        let capturedTerminalId: string | null = null;

        const timeout = setTimeout(() => {
          console.log('[Test] Timeout reached');
          console.log(`[Test] Data events received: ${dataReceivedCount}`);
          console.log(`[Test] Collected output length: ${output.length}`);
          console.log(`[Test] Collected output:`, output);
          resolve({ terminalId: capturedTerminalId ?? '', output });
        }, 5000);

        console.log('[Test] Setting up onData listener before spawning terminal');

        // Listen for terminal data - this will capture ALL data from ANY terminal
        api.terminal.onData((id, data) => {
          console.log(`[Test] onData callback triggered - id: ${id}`);

          // First data event tells us the terminal ID
          if (!capturedTerminalId) {
            capturedTerminalId = id;
            console.log(`[Test] Captured terminal ID: ${id}`);
          }

          if (id === capturedTerminalId) {
            dataReceivedCount++;
            console.log(`[Test] Data event #${dataReceivedCount} for terminal ${id}`);
            console.log(`[Test] Data length: ${data.length}, preview:`, data.substring(0, 100));
            output += data;

            // Check if we've received all the expected output
            if (output.includes('10') && output.includes('1') && output.includes('5')) {
              clearTimeout(timeout);
              console.log('[Test] Received all expected output (contains 1, 5, and 10)');
              resolve({ terminalId: id, output });
            }
          }
        });

        console.log('[Test] onData listener set up, now spawning terminal...');

        // NOW spawn the terminal with the listener already in place
        void (async () => {
          const cy = w.cytoscapeInstance;
          if (!cy) throw new Error('Cytoscape not initialized');

          const node = cy.getElementById(nodeId);
          if (node.length === 0) throw new Error('Node not found');

          // TerminalData requires the full type structure per types.ts
          const terminalData = {
            type: 'Terminal' as const,
            attachedToNodeId: nodeId,
            terminalCount: 0,
            title: nodeId.replace(/_/g, ' '),
            anchoredToNodeId: { _tag: 'None' } as { _tag: 'None' }, // fp-ts Option.none
            shadowNodeDimensions: { width: 600, height: 400 },
            resizable: true,
            initialCommand: 'for i in {1..10}; do echo $i; done',
            executeCommand: true
          };

          const result = await api.terminal.spawn(terminalData);
          console.log('[Test] Terminal spawn result:', result);

          if (!result.success) {
            clearTimeout(timeout);
            throw new Error('Failed to spawn terminal');
          }
        })();
      });
    }, targetNodeId);

    console.log('=== STEP 4: Wait for terminal output ===');
    const { terminalId: _terminalId, output: terminalOutput } = await terminalOutputPromise;

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
