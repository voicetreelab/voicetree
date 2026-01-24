/**
 * BEHAVIORAL SPEC:
 * 1. Capture renderer CPU profile via Chrome DevTools Protocol (CDP)
 * 2. Identify hot functions causing high CPU in large graphs
 * 3. Write results to /tmp/renderer-cpu-profile.json for CLI readability
 *
 * Run with:
 *   npx electron-vite build && npx playwright test e2e-tests/electron/for_feature_development_not_LT_verification/renderer-cpu-profile.spec.ts --config=playwright-electron.config.ts
 *
 * Read results with:
 *   cat /tmp/renderer-cpu-profile.json | jq '.hotFunctions[].functionName'
 *   cat /tmp/renderer-cpu-profile.json | jq '.hotFunctions[:10]'
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page, CDPSession } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

// Use large fixture for performance testing
const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_real_large', '2025-09-30');
const PROFILE_OUTPUT_PATH = '/tmp/renderer-cpu-profile.json';
const RAW_PROFILE_PATH = '/tmp/renderer-cpu-profile.cpuprofile';

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

interface CallFrame {
  functionName: string;
  scriptId: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}

interface ProfileNode {
  id: number;
  callFrame: CallFrame;
  hitCount?: number;
  children?: number[];
}

interface CPUProfile {
  nodes: ProfileNode[];
  startTime: number;
  endTime: number;
  samples?: number[];
  timeDeltas?: number[];
}

interface HotFunction {
  functionName: string;
  url: string;
  lineNumber: number;
  hitCount: number;
  percentage: number;
}

interface ProfileMetrics {
  testName: string;
  timestamp: string;
  fixtureNodeCount: number;
  profileDurationMs: number;
  totalSamples: number;
  hotFunctions: HotFunction[];
  rawProfilePath: string;
}

// Extend test with Electron app
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-cpu-profile-'));

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
      timeout: 15000
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

test.describe('Renderer CPU Profile', () => {
  test('should capture and analyze renderer CPU profile in large graph', async ({ appWindow }) => {
    test.setTimeout(120000);

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

    console.log('=== STEP 2: Start CDP CPU profiling ===');

    // Get CDP session for the renderer
    const context = appWindow.context();
    const cdpSession: CDPSession = await context.newCDPSession(appWindow);

    // Enable and start profiler
    await cdpSession.send('Profiler.enable');
    await cdpSession.send('Profiler.start');
    console.log('CPU profiler started');

    console.log('=== STEP 3: Let the app run to capture CPU activity ===');

    // Trigger some activity - pan/zoom the graph
    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (cy) {
        // Trigger layout recalculation
        cy.resize();
        // Pan around to trigger renders
        cy.pan({ x: 100, y: 100 });
        cy.pan({ x: -100, y: -100 });
        cy.zoom(1.2);
        cy.zoom(0.8);
      }
    });

    // Capture for 5 seconds to get good sample
    const profileDurationMs = 5000;
    console.log(`Capturing profile for ${profileDurationMs}ms...`);
    await appWindow.waitForTimeout(profileDurationMs);

    console.log('=== STEP 4: Stop profiling and get results ===');

    const { profile } = await cdpSession.send('Profiler.stop') as { profile: CPUProfile };
    await cdpSession.send('Profiler.disable');
    console.log('CPU profiler stopped');

    // Save raw profile for Chrome DevTools
    await fs.writeFile(RAW_PROFILE_PATH, JSON.stringify(profile, null, 2), 'utf8');
    console.log(`Raw .cpuprofile saved to ${RAW_PROFILE_PATH}`);

    console.log('=== STEP 5: Analyze profile to find hot functions ===');

    // Calculate total hit count
    const totalHits = profile.nodes.reduce((sum, node) => sum + (node.hitCount || 0), 0);
    console.log(`Total samples: ${totalHits}`);

    // Find hot functions (with hits > 0, sorted by hit count)
    const hotFunctions: HotFunction[] = profile.nodes
      .filter(node => (node.hitCount || 0) > 0)
      .map(node => ({
        functionName: node.callFrame.functionName || '(anonymous)',
        url: node.callFrame.url,
        lineNumber: node.callFrame.lineNumber,
        hitCount: node.hitCount || 0,
        percentage: totalHits > 0 ? ((node.hitCount || 0) / totalHits) * 100 : 0
      }))
      .sort((a, b) => b.hitCount - a.hitCount)
      .slice(0, 50); // Top 50 functions

    console.log('\n=== TOP 20 HOT FUNCTIONS ===');
    hotFunctions.slice(0, 20).forEach((fn, i) => {
      const shortUrl = fn.url.split('/').slice(-2).join('/');
      console.log(`${i + 1}. ${fn.functionName} (${fn.percentage.toFixed(1)}%) - ${shortUrl}:${fn.lineNumber}`);
    });

    console.log('=== STEP 6: Write metrics to JSON file ===');

    const metrics: ProfileMetrics = {
      testName: 'renderer-cpu-profile',
      timestamp: new Date().toISOString(),
      fixtureNodeCount: actualNodeCount,
      profileDurationMs,
      totalSamples: totalHits,
      hotFunctions,
      rawProfilePath: RAW_PROFILE_PATH
    };

    await fs.writeFile(PROFILE_OUTPUT_PATH, JSON.stringify(metrics, null, 2), 'utf8');
    console.log(`\nMetrics written to ${PROFILE_OUTPUT_PATH}`);

    console.log('\n=== CLI COMMANDS ===');
    console.log(`View top 10 hot functions:`);
    console.log(`  cat ${PROFILE_OUTPUT_PATH} | jq '.hotFunctions[:10] | .[] | "\\(.percentage | tostring | .[0:5])% \\(.functionName)"'`);
    console.log(`\nView function names only:`);
    console.log(`  cat ${PROFILE_OUTPUT_PATH} | jq '.hotFunctions[].functionName'`);
    console.log(`\nOpen flame graph in Chrome DevTools:`);
    console.log(`  1. Open chrome://inspect`);
    console.log(`  2. Click "Open dedicated DevTools for Node"`);
    console.log(`  3. Go to Performance tab > Load profile > ${RAW_PROFILE_PATH}`);

    // Basic assertions
    expect(hotFunctions.length).toBeGreaterThan(0);
    expect(totalHits).toBeGreaterThan(0);
  });
});

export { test };
