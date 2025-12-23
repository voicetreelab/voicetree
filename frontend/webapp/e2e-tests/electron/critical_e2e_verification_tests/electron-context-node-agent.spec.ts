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
import type { ElectronAPI } from '@/shell/electron';

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

    // Write the config file to auto-load the test vault
    // Set empty suffix to use directory directly (without /voicetree subfolder)
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
        MINIMIZE_TEST: '1',
        VOICETREE_PERSIST_STATE: '1'
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

test.describe('Context Node Agent Terminal E2E', () => {
  test('should spawn agent terminal with context node and retrieve needle from ancestor', async ({ appWindow }) => {
    test.setTimeout(90000); // 90 second timeout for Claude API call

    console.log('=== STEP 1: Set agentCommand with -p flag for stdout output ===');
    // Define the agent command - uses -p flag to output to stdout
    const agentCommand = 'claude --dangerously-skip-permissions -p --append-system-prompt-file "$CONTEXT_NODE_PATH" "Search your context for \'SECRET_E2E_NEEDLE:\'. Return ONLY the value after the colon, nothing else."';

    await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');

      // Get current settings and update them
      const currentSettings = await api.main.loadSettings();
      const updatedSettings = {
        ...currentSettings,
        terminalSpawnPathRelativeToWatchedDirectory: '../' // Launch from parent of watched directory
      };
      await api.main.saveSettings(updatedSettings);
    });
    console.log('✓ Agent command configured:', agentCommand);

    console.log('=== STEP 2: Wait for auto-load to complete (test vault: example_small) ===');
    // The app auto-loads from config file on startup, wait for nodes to appear
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) return 0;
        return cy.nodes().length;
      });
    }, {
      message: 'Waiting for graph to auto-load nodes',
      timeout: 15000,
      intervals: [500, 1000, 1000]
    }).toBeGreaterThan(0);

    console.log('✓ Graph auto-loaded with nodes');

    console.log('=== STEP 2b: Wait for auto-load to fully complete ===');
    // Give the auto-load process extra time to finish (like smoke test does)
    await appWindow.waitForTimeout(1000);

    console.log('=== STEP 2c: Verify graph loaded in main process state ===');
    const graphInMainProcess = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getGraph();
    });

    const mainProcessNodeCount = Object.keys(graphInMainProcess.nodes).length;
    console.log(`✓ Main process graph has ${mainProcessNodeCount} nodes`);
    expect(mainProcessNodeCount).toBeGreaterThan(0);

    console.log('=== STEP 3: Verify watch directory (auto-loaded from config) ===');
    const watchDir = FIXTURE_VAULT_PATH;
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

    // Wait for context node file to be written (with retry)
    // The file write happens asynchronously after createContextNode returns
    let contextFileContent = '';
    let attempts = 0;
    const maxAttempts = 20; // Increased from 10
    while (attempts < maxAttempts) {
      try {
        contextFileContent = await fs.readFile(contextFilePath, 'utf-8');
        console.log(`✓ Context node file found (attempt ${attempts + 1})`);
        break;
      } catch (_error) {
        attempts++;
        if (attempts >= maxAttempts) {
          // Log directory contents to help debug
          const ctxNodesDir = path.join(watchDir, 'ctx-nodes');
          try {
            const files = await fs.readdir(ctxNodesDir);
            console.log(`Files in ctx-nodes directory: ${files.join(', ')}`);
          } catch {
            console.log('ctx-nodes directory does not exist');
          }
          throw new Error(`Context node file not created after ${maxAttempts} attempts (${maxAttempts * 500}ms): ${contextFilePath}`);
        }
        console.log(`Waiting for context node file (attempt ${attempts}/${maxAttempts})...`);
        await appWindow.waitForTimeout(500);
      }
    }

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

            // TerminalData requires the full type structure per types.ts
            const spawnResult = await api.terminal.spawn({
              type: 'Terminal' as const,
              attachedToNodeId: ctxNodeId,
              terminalCount: 0,
              title: 'Agent Terminal',
              anchoredToNodeId: { _tag: 'None' } as { _tag: 'None' }, // fp-ts Option.none
              shadowNodeDimensions: { width: 600, height: 400 },
              resizable: true,
              initialCommand: command,
              executeCommand: true,
              initialSpawnDirectory: spawnDir, // Correct field name (camelCase)
              initialEnvVars: {
                CONTEXT_NODE_PATH: ctxNodePath,
                // Enable OTLP telemetry so Electron's OTLP receiver captures metrics
                CLAUDE_CODE_ENABLE_TELEMETRY: '1',
                OTEL_METRICS_EXPORTER: 'otlp',
                OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
                OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
                OTEL_METRIC_EXPORT_INTERVAL: '1000'  // 1 second - must be shorter than Claude -p runtime
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

    // === PHASE 3: E2E OTLP METRICS VERIFICATION ===
    // After agent completes, verify OTLP metrics are received and displayed in dashboard
    console.log('');
    console.log('=== STEP 8: Wait for OTLP metrics to be captured ===');

    // Claude Code sends OTLP metrics with OTEL_METRIC_EXPORT_INTERVAL (set to 5s in env vars above)
    // Wait for metrics to be received and stored in agent_metrics.json
    // The OTLP receiver logs "[OTLP Receiver] Received metrics:" when it gets data

    // Poll for metrics to appear - they may take a few seconds after Claude finishes
    let metricsReceived = false;
    const maxMetricsWaitMs = 20000; // 20 seconds max wait
    const metricsStartTime = Date.now();

    while (!metricsReceived && (Date.now() - metricsStartTime) < maxMetricsWaitMs) {
      const metrics = await appWindow.evaluate(async () => {
        const api = (window as ExtendedWindow).electronAPI;
        if (!api?.main?.getMetrics) return null;
        return await api.main.getMetrics();
      });

      if (metrics && metrics.sessions && metrics.sessions.length > 0) {
        console.log(`✓ OTLP metrics received: ${metrics.sessions.length} session(s)`);
        metricsReceived = true;
      } else {
        console.log(`Waiting for OTLP metrics (${Math.floor((Date.now() - metricsStartTime) / 1000)}s elapsed)...`);
        await appWindow.waitForTimeout(2000);
      }
    }

    // Note: Metrics may not arrive in all cases (e.g., Claude Code version without telemetry)
    // but we should at least verify the dashboard opens and displays correctly

    console.log('=== STEP 9: Open Agent Stats panel ===');

    // Take screenshot before opening stats panel
    await appWindow.screenshot({ path: 'test-results/step9-before-stats-panel.png' });
    console.log('✓ Screenshot saved: step9-before-stats-panel.png');

    // Find and click the stats toggle button using JavaScript to bypass overlay issues
    // The cytoscape-navigator overlay intercepts pointer events so we use dispatchEvent
    await appWindow.evaluate(() => {
      const button = document.querySelector('button[title="Toggle Agent Stats Panel"]') as HTMLButtonElement;
      if (button) {
        button.click(); // Programmatic click bypasses pointer event interception
      } else {
        throw new Error('Stats button not found');
      }
    });
    console.log('✓ Clicked Stats button (via JS)');

    // Wait a moment for React state to update
    await appWindow.waitForTimeout(500);

    // Take screenshot to verify panel state
    await appWindow.screenshot({ path: 'test-results/step9-after-stats-click.png' });
    console.log('✓ Screenshot saved: step9-after-stats-click.png');

    // Wait for the stats panel to appear
    await expect(appWindow.locator('[data-testid="agent-stats-panel-container"]')).toBeVisible({ timeout: 5000 });
    console.log('✓ Stats panel is visible');

    // Take screenshot of open stats panel
    await appWindow.screenshot({ path: 'test-results/step9-stats-panel-open.png' });
    console.log('✓ Screenshot saved: step9-stats-panel-open.png');

    console.log('=== STEP 10: Verify dashboard displays metrics data ===');

    // Verify the dashboard structure is present
    await expect(appWindow.locator('[data-testid="agent-stats-panel"]')).toBeVisible({ timeout: 3000 });
    console.log('✓ AgentStatsPanel component rendered');

    // Verify summary cards are present
    await expect(appWindow.locator('[data-testid="sessions-count"]')).toBeVisible({ timeout: 3000 });
    await expect(appWindow.locator('[data-testid="total-cost"]')).toBeVisible({ timeout: 3000 });
    await expect(appWindow.locator('[data-testid="tokens-input"]')).toBeVisible({ timeout: 3000 });
    console.log('✓ Summary cards (sessions, cost, tokens) are visible');

    // If metrics were received, verify they show non-zero values
    if (metricsReceived) {
      // Wait a moment for the dashboard to refresh with the new data
      await appWindow.waitForTimeout(1000);

      // Check sessions count is not zero
      const sessionsCount = await appWindow.locator('[data-testid="sessions-count"]').textContent();
      console.log(`Sessions count displayed: ${sessionsCount}`);
      expect(sessionsCount).not.toBe('0');
      expect(sessionsCount).not.toBe('...');
      console.log('✓ Sessions count is non-zero');

      // Check that tokens input shows a value (not just "0" or loading state)
      const tokensInputText = await appWindow.locator('[data-testid="tokens-input"]').textContent();
      console.log(`Input tokens displayed: ${tokensInputText}`);
      // Should contain at least one digit that's not zero in the number part
      expect(tokensInputText).toMatch(/[1-9]/);
      console.log('✓ Input tokens show non-zero value');

      // Check that cost is displayed (may be $0.0000 for small operations, but should be present)
      const totalCost = await appWindow.locator('[data-testid="total-cost"]').textContent();
      console.log(`Total cost displayed: ${totalCost}`);
      expect(totalCost).toMatch(/\$\d+\.\d+/);
      console.log('✓ Cost is displayed in correct format');
    } else {
      // FAIL the test if metrics weren't received - this is an E2E test for the full flow
      console.error('❌ OTLP metrics not received - E2E test FAILED');
      console.error('Expected: Claude Code to send metrics via OTLP to localhost:4318');
      console.error('Check: OTEL env vars are set, OTLP receiver is running, Claude version supports telemetry');
      throw new Error('OTLP metrics not received - full E2E flow verification failed');
    }

    // Take final screenshot showing metrics dashboard state
    await appWindow.screenshot({ path: 'test-results/step10-final-metrics-dashboard.png' });
    console.log('✓ Screenshot saved: step10-final-metrics-dashboard.png');

    console.log('');
    console.log('=== E2E OTLP METRICS TEST SUMMARY ===');
    console.log('✓ Stats panel opened successfully');
    console.log('✓ Dashboard components rendered correctly');
    console.log('✓ OTLP metrics captured and displayed in dashboard');
    console.log('');
    console.log('✅ FULL E2E TEST (Agent + OTLP Metrics) COMPLETE');
  });
});

export { test };
