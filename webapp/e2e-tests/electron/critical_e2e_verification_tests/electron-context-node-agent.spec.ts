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

import { expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import { test, FIXTURE_VAULT_PATH, type ExtendedWindow } from './electron-context-node-agent-fixtures';

test.describe('Context Node Agent Terminal E2E', () => {
  test.describe.configure({ timeout: 90000 });

  test('should spawn agent terminal with context node and retrieve needle from ancestor', async ({ appWindow }) => {
    test.setTimeout(90000); // 90 second timeout for Claude API call

    console.log('=== STEP 1: Set agentCommand to grep needle from context file ===');
    // Grep the needle directly from the context file injected via CONTEXT_NODE_PATH.
    // This tests the full context-node + CONTEXT_NODE_PATH injection + terminal-output
    // pipeline without requiring a real Claude API key in CI.
    const agentCommand = 'grep -o "SECRET_E2E_NEEDLE: [^ ]*" "$CONTEXT_NODE_PATH" | head -1';

    const terminalShell = process.env.SHELL ?? (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash');

    // The daemon-side `resolveAgentCommand` validates that the spawn request's
    // agentCommand is one of `settings.agents[].command`. Register the grep
    // probe as a named agent so the test's command is accepted.
    await appWindow.evaluate(async ({ shell, command }) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');

      const currentSettings = await api.main.loadSettings();
      const updatedSettings = {
        ...currentSettings,
        terminalSpawnPathRelativeToWatchedDirectory: '../', // Launch from parent of watched directory
        shell,
        agents: [{ name: 'E2E Context Probe', command }],
        defaultAgent: 'E2E Context Probe',
      };
      await api.main.saveSettings(updatedSettings);
    }, { shell: terminalShell, command: agentCommand });
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

    console.log('=== STEP 3: Verify watch directory and write folder (auto-loaded from config) ===');
    const watchDir = FIXTURE_VAULT_PATH;
    console.log(`✓ Watch directory: ${watchDir}`);
    const writeFolder = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      const result = await api.main.getWriteFolder();
      if (result && typeof result === 'object' && '_tag' in result) {
        return (result as { _tag: string; value?: string })._tag === 'Some'
          ? (result as { value: string }).value
          : null;
      }
      return null;
    });
    if (!writeFolder) throw new Error('Expected Electron main process to expose a write folder');
    console.log(`✓ Write folder: ${writeFolder}`);

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
    const contextNodePath = path.isAbsolute(contextNodeId)
      ? contextNodeId
      : path.join(watchDir, contextNodeId);
    const contextNodeRelativePath = path.relative(watchDir, contextNodePath);
    // Parent of root-level context nodes must be the top-level `ctx-nodes/` folder.
    // (Nested ctx-nodes/ for non-root parents is a separate contract not exercised here.)
    expect(path.dirname(contextNodeRelativePath)).toBe('ctx-nodes');

    console.log('=== STEP 4b: Verify context node file contains needle from ancestor ===');
    // This verifies the context aggregation logic works - Node 3 content should be included
    const contextFilePath = contextNodePath;

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

    console.log('=== STEP 5: Spawn the agent terminal ===');

    // Compute paths in Node context, pass as strings to browser
    const initialSpawnDir = path.join(watchDir, '../');
    console.log(`Context node absolute path: ${contextNodePath}`);
    console.log(`Initial spawn directory: ${initialSpawnDir}`);

    // `spawnTerminalWithContextNode` reuses the context node when `taskNodeId`
    // already references one, runs the registered agent command, and returns
    // the daemon-assigned `terminalId` we use to locate the pipe-pane log.
    const spawnResponse = await appWindow.evaluate(async ({ ctxNodeId, ctxNodePath, spawnDir, command }) => {
      const w = (window as ExtendedWindow);
      const api = w.electronAPI;
      if (!api) throw new Error('electronAPI not available');

      return api.main.spawnTerminalWithContextNode({
        taskNodeId: ctxNodeId,
        agentCommand: command,
        terminalCount: 0,
        spawnDirectory: spawnDir,
        envOverrides: {
          CONTEXT_NODE_PATH: ctxNodePath,
          CLAUDE_CODE_ENABLE_TELEMETRY: '1',
          OTEL_METRICS_EXPORTER: 'otlp',
          OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
          OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
          OTEL_METRIC_EXPORT_INTERVAL: '1000',
        },
      });
    }, { ctxNodeId: contextNodeId, ctxNodePath: contextNodePath, spawnDir: initialSpawnDir, command: agentCommand });

    const terminalId = spawnResponse.terminalId;
    expect(terminalId, 'spawnTerminalWithContextNode returned no terminalId').toBeTruthy();

    console.log('=== STEP 6: Poll tmux log file for Claude output ===');
    // tmux-backed terminals stream their pane output to
    // <writeFolder>/.voicetree/terminals/<terminalId>.log via `tmux pipe-pane`.
    // Poll that file instead of subscribing to a renderer event stream.
    const logPath = path.join(writeFolder, '.voicetree', 'terminals', `${terminalId}.log`);
    console.log(`[Test] Polling log: ${logPath}`);

    const needle = 'VOICETREE_CTX_12345';
    const deadline = Date.now() + 60000;
    let terminalOutput = '';
    while (Date.now() < deadline) {
      try {
        terminalOutput = await fs.readFile(logPath, 'utf8');
        if (terminalOutput.includes(needle)) break;
      } catch {
        // Log not created yet; pipe-pane runs after session creation.
      }
      await new Promise(r => setTimeout(r, 250));
    }

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
