/**
 * BEHAVIORAL SPEC:
 * E2E test for spawning an agent terminal with context node
 *
 * This test verifies the COMPLETE flow:
 * 1. Load example_small fixture containing a small graph
 * 2. Create a context node from Node 5 (aggregates ancestors within distance 7)
 * 3. Spawn agent terminal with context node path as env var
 * 4. Agent searches context for SECRET_E2E_NEEDLE (located in Node 3, 2 hops away)
 * 5. Verify agent returns the needle value from the context
 *
 * GRAPH STRUCTURE:
 * Node 3 (Speaker's Immediate Action) - contains SECRET_E2E_NEEDLE
 *   └── Node 4 (Test Outcome) - links to 3
 *         └── Node 5 (Immediate Test Observation) - links to 4 ← SPAWN FROM HERE
 *
 * When context node is created from Node 5, it aggregates content from Node 3 and Node 4
 * (within distance 7), so the needle WILL be in the context file.
 *
 * EXPECTED OUTCOME:
 * ✅ Test should PASS - context node contains ancestor content
 * ✅ Agent successfully reads context and returns needle value
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/utils/types/electron';

// Use absolute paths for example_folder_fixtures
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
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-ctx-agent-test-'));

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
      timeout: 10000 // 10 second timeout for app launch
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
    const window = await electronApp.firstWindow({ timeout: 15000 });

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

test.describe('Context Node Agent Terminal E2E', () => {
  test('should spawn agent terminal with context node and retrieve needle from ancestor', async ({ appWindow }) => {
    test.setTimeout(90000); // 90 second timeout for Claude API call

    console.log('=== STEP 1: Set agentCommand with -p flag for stdout output ===');
    // Define the agent command - uses -p flag to output to stdout
    const agentCommand = 'claude --dangerously-skip-permissions -p --append-system-prompt-file "$CONTEXT_NODE_PATH" "Search your context for \'SECRET_E2E_NEEDLE:\'. Return ONLY the value after the colon, nothing else."';

    await appWindow.evaluate(async (cmd) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');

      // Save settings (for completeness, though we pass command directly to spawn)
      const settings = {
        agentCommand: cmd,
        terminalSpawnPathRelativeToWatchedDirectory: '../' // Launch from parent of watched directory
      };
      await api.main.saveSettings(settings);
    }, agentCommand);
    console.log('✓ Agent command configured:', agentCommand);

    console.log('=== STEP 2: Load the test vault (example_small) ===');
    const watchResult = await appWindow.evaluate(async (vaultPath) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.startFileWatching(vaultPath);
    }, FIXTURE_VAULT_PATH);

    expect(watchResult.success).toBe(true);
    console.log('✓ File watching started');

    // Wait for initial scan
    await appWindow.waitForTimeout(3000);

    console.log('=== STEP 3: Get watch status to determine context node path ===');
    const watchStatus = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getWatchStatus();
    });

    expect(watchStatus.isWatching).toBe(true);
    expect(watchStatus.directory).toBeTruthy();
    const watchDir = watchStatus.directory!;
    console.log(`✓ Watch directory: ${watchDir}`);

    console.log('=== STEP 4: Create context node from Node 5 ===');
    const parentNodeId = '5_Immediate_Test_Observation_No_Output.md';
    console.log(`Parent node: ${parentNodeId}`);

    const contextNodeId = await appWindow.evaluate(async (nodeId) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.createContextNode(nodeId);
    }, parentNodeId);

    console.log(`✓ Context node created: ${contextNodeId}`);
    expect(contextNodeId).toBeTruthy();
    expect(contextNodeId).toMatch(/^ctx-nodes\//);

    console.log('=== STEP 4b: Verify context node file contains needle from ancestor ===');
    // This verifies the context aggregation logic works - Node 3 content should be included
    const contextFilePath = path.join(watchDir, contextNodeId);
    const contextFileContent = await fs.readFile(contextFilePath, 'utf-8');
    expect(contextFileContent).toContain('SECRET_E2E_NEEDLE: VOICETREE_CTX_12345');
    console.log('✓ Verified context node file contains needle from Node 3 ancestor');

    console.log('=== STEP 5: Set up terminal data listener BEFORE spawning ===');

    // Compute paths in Node context, pass as strings to browser
    const contextNodePath = path.join(watchDir, contextNodeId);
    const initialSpawnDir = path.join(watchDir, '../');
    console.log(`Context node absolute path: ${contextNodePath}`);
    console.log(`Initial spawn directory: ${initialSpawnDir}`);

    // Set up promise to collect output - must be done BEFORE spawning terminal
    const terminalOutputPromise = appWindow.evaluate(async ({ ctxNodeId, ctxNodePath, spawnDir, command }) => {
      const w = (window as ExtendedWindow);
      const api = w.electronAPI;

      if (!api?.terminal) {
        throw new Error('electronAPI.terminal not available');
      }

      return new Promise<{ terminalId: string; output: string }>((resolve, reject) => {
        let output = '';
        let dataReceivedCount = 0;
        let capturedTerminalId: string | null = null;

        const timeout = setTimeout(() => {
          console.log('[Test] Timeout reached after 60s');
          console.log(`[Test] Data events received: ${dataReceivedCount}`);
          console.log(`[Test] Collected output length: ${output.length}`);
          console.log(`[Test] Collected output:`, output);

          // Timeout is okay - resolve with what we have
          resolve({ terminalId: capturedTerminalId ?? '', output });
        }, 60000); // 60 second timeout for Claude API

        console.log('[Test] Setting up onData listener before spawning terminal');

        // Listen for terminal data
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
            console.log(`[Test] Data length: ${data.length}, preview:`, data.substring(0, 200));
            output += data;

            // Check if we've received the needle value
            if (output.includes('VOICETREE_CTX_12345')) {
              clearTimeout(timeout);
              console.log('[Test] Received needle value in output!');
              resolve({ terminalId: id, output });
            }
          }
        });

        console.log('[Test] onData listener set up, now spawning terminal...');

        // NOW spawn the terminal with the listener already in place
        void (async () => {
          try {
            console.log(`[Test] Context node absolute path: ${ctxNodePath}`);

            const spawnResult = await api.terminal.spawn({
              attachedToNodeId: ctxNodeId,
              terminalCount: 0,
              initialCommand: command,
              executeCommand: true,
              initial_spawn_directory: spawnDir,
              initialEnvVars: {
                CONTEXT_NODE_PATH: ctxNodePath
              }
            });

            console.log('[Test] Terminal spawn result:', spawnResult);

            if (!spawnResult.success) {
              clearTimeout(timeout);
              reject(new Error('Failed to spawn terminal: ' + spawnResult.error));
            }
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        })();
      });
    }, { ctxNodeId: contextNodeId, ctxNodePath: contextNodePath, spawnDir: initialSpawnDir, command: agentCommand });

    console.log('=== STEP 6: Wait for terminal output from Claude ===');
    const { terminalId, output: terminalOutput } = await terminalOutputPromise;

    console.log(`Terminal ID: ${terminalId}`);
    console.log(`Terminal output length: ${terminalOutput.length} characters`);
    console.log('Terminal output:');
    console.log('---');
    console.log(terminalOutput);
    console.log('---');

    console.log('=== STEP 7: Verify needle value is in output ===');

    // The needle should be in the output because:
    // 1. Node 5 is the spawn point
    // 2. Context node aggregates ancestors within distance 7
    // 3. Node 3 is 2 hops away (5 -> 4 -> 3) and contains the needle
    // 4. Claude reads the context file via --append-system-prompt-file
    expect(terminalOutput).toContain('VOICETREE_CTX_12345');
    console.log('✓ Needle value found in terminal output!');

    console.log('');
    console.log('=== TEST SUMMARY ===');
    console.log('✓ Agent command configured with -p flag');
    console.log('✓ Test vault loaded (example_small)');
    console.log('✓ Watch status retrieved');
    console.log('✓ Context node created from Node 5');
    console.log('✓ Terminal spawned with CONTEXT_NODE_PATH env var');
    console.log('✓ Claude agent executed and returned output');
    console.log('✓ Needle from Node 3 (2 hops away) found in context');
    console.log('');
    console.log('✅ CONTEXT NODE AGENT TERMINAL TEST PASSED');
  });
});

export { test };
