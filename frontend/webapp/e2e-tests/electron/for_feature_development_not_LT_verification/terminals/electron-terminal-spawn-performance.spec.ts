/**
 * BEHAVIORAL SPEC:
 * 1. Measure terminal spawn performance in large graphs
 * 2. Capture timing from trace() wrapper in terminal-manager.ts
 * 3. Write metrics to /tmp/voicetree-perf-metrics.json for CLI readability
 *
 * Run with:
 *   npx electron-vite build && npx playwright test e2e-tests/electron/for_feature_development_not_LT_verification/terminals/electron-terminal-spawn-performance.spec.ts --config=playwright-electron.config.ts
 *
 * Read results with:
 *   cat /tmp/voicetree-perf-metrics.json | jq '.spawnTimeMs'
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

// Use large fixture for performance testing
const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_real_large', '2025-09-30');
const METRICS_OUTPUT_PATH = '/tmp/voicetree-perf-metrics.json';

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

interface PerfMetrics {
  testName: string;
  timestamp: string;
  fixtureNodeCount: number;
  spawnTimeMs: number | null;
  rawConsoleLogs: string[];
}

// Extend test with Electron app
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-perf-test-'));

    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({
      lastDirectory: FIXTURE_VAULT_PATH,
      suffixes: {
        [FIXTURE_VAULT_PATH]: ''
      }
    }, null, 2), 'utf8');
    console.log('[Test] Created config to auto-load:', FIXTURE_VAULT_PATH);

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`
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
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15000 });

    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');

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

test.describe('Terminal Spawn Performance', () => {
  test('should measure and export terminal spawn timing in large graph', async ({ electronApp, appWindow }) => {
    test.setTimeout(90000);

    const consoleLogs: string[] = [];

    // Capture main process console logs (where trace() logs timing)
    electronApp.on('console', msg => {
      const text = msg.text();
      consoleLogs.push(text);
      if (text.includes('[trace]')) {
        console.log('[MAIN PROCESS TRACE]:', text);
      }
    });

    console.log('=== STEP 1: Wait for graph to load ===');
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) return 0;
        return cy.nodes().length;
      });
    }, {
      message: 'Waiting for graph to load',
      timeout: 30000,
      intervals: [500, 1000, 2000]
    }).toBeGreaterThan(0);

    const actualNodeCount = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      return cy?.nodes().length ?? 0;
    });
    console.log(`Graph loaded with ${actualNodeCount} nodes`);

    console.log('=== STEP 2: Get target node ===');
    const targetNodeId = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const nodes = cy.nodes();
      if (nodes.length === 0) throw new Error('No nodes available');
      return nodes[0].id();
    });
    console.log(`Target node: ${targetNodeId}`);

    console.log('=== STEP 3: Spawn terminal and capture timing ===');

    // Record start time for fallback measurement
    const startTime = Date.now();

    const spawnResult = await appWindow.evaluate(async (nodeId) => {
      const w = (window as ExtendedWindow);
      const api = w.electronAPI;

      if (!api?.terminal) {
        throw new Error('electronAPI.terminal not available');
      }

      const terminalData = {
        type: 'Terminal' as const,
        attachedToNodeId: nodeId,
        terminalCount: 0,
        title: 'perf-test-terminal',
        anchoredToNodeId: { _tag: 'None' } as { _tag: 'None' },
        shadowNodeDimensions: { width: 600, height: 400 },
        resizable: true,
        initialCommand: 'echo "perf test complete"',
        executeCommand: true
      };

      const result = await api.terminal.spawn(terminalData);
      return result;
    }, targetNodeId);

    const endTime = Date.now();
    const fallbackDuration = endTime - startTime;

    expect(spawnResult.success).toBe(true);
    console.log(`Terminal spawned: ${spawnResult.terminalId}`);

    // Wait a bit for trace logs to appear
    await appWindow.waitForTimeout(500);

    console.log('=== STEP 4: Parse trace timing from console logs ===');

    // Look for [trace] terminal:spawn: XXX.XXms in console logs
    let spawnTimeMs: number | null = null;
    const tracePattern = /\[trace\] terminal:spawn: ([\d.]+)ms/;

    for (const log of consoleLogs) {
      const match = log.match(tracePattern);
      if (match) {
        spawnTimeMs = parseFloat(match[1]);
        console.log(`Found trace timing: ${spawnTimeMs}ms`);
        break;
      }
    }

    // Use fallback if trace wasn't captured
    if (spawnTimeMs === null) {
      console.log(`Trace timing not found in logs, using fallback measurement: ${fallbackDuration}ms`);
      spawnTimeMs = fallbackDuration;
    }

    console.log('=== STEP 5: Write metrics to JSON file ===');

    const metrics: PerfMetrics = {
      testName: 'terminal-spawn-performance',
      timestamp: new Date().toISOString(),
      fixtureNodeCount: actualNodeCount,
      spawnTimeMs: spawnTimeMs,
      rawConsoleLogs: consoleLogs.filter(log => log.includes('[trace]') || log.includes('terminal'))
    };

    await fs.writeFile(METRICS_OUTPUT_PATH, JSON.stringify(metrics, null, 2), 'utf8');
    console.log(`Metrics written to ${METRICS_OUTPUT_PATH}`);

    console.log('\n=== RESULTS ===');
    console.log(`Node count: ${actualNodeCount}`);
    console.log(`Spawn time: ${spawnTimeMs}ms`);
    console.log(`\nRead with: cat ${METRICS_OUTPUT_PATH} | jq '.spawnTimeMs'`);

    // Basic assertion - spawn should complete within reasonable time
    expect(spawnTimeMs).toBeLessThan(10000); // 10 second max
  });
});

export { test };
