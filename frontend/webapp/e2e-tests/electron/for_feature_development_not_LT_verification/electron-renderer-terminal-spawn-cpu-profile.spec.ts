/**
 * BEHAVIORAL SPEC:
 * 1. Load large graph fixture and select ALL nodes (30+ to trigger performance issue)
 * 2. Start CDP CPU profiler BEFORE terminal spawn
 * 3. Use runAgentOnSelectedNodes to create context node with ALL selected nodes
 * 4. Capture profile for 10 seconds (matching reported "10s spinning wheel")
 * 5. Output JSON metrics to /tmp/renderer-terminal-spawn-profile.json
 *
 * This test captures RENDERER CPU profile during terminal spawn, focusing on
 * the bottleneck identified in previous investigations (styfn$*, highlightContextNodes).
 *
 * The key insight: previous test only captured 8 nodes because createContextNode uses
 * distance-based BFS with contextNodeMaxDistance=5. By using runAgentOnSelectedNodes
 * with ALL nodes explicitly selected, we create a context with 50+ contained nodes
 * which triggers the actual performance bottleneck.
 *
 * Run with:
 *   npx electron-vite build && npx playwright test e2e-tests/electron/for_feature_development_not_LT_verification/electron-renderer-terminal-spawn-cpu-profile.spec.ts --config=playwright-electron-dev.config.ts
 *
 * Read results with:
 *   cat /tmp/renderer-terminal-spawn-profile.json | jq '.'
 *   cat /tmp/renderer-terminal-spawn-profile.json | jq '.topFunctions[:10]'
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
const PROFILE_OUTPUT_PATH = '/tmp/renderer-terminal-spawn-profile.json';
const RAW_PROFILE_PATH = '/tmp/renderer-terminal-spawn-profile.cpuprofile';

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

interface TopFunction {
  functionName: string;
  url: string;
  lineNumber: number;
  hitCount: number;
  percentage: number;
  category: 'style' | 'layout' | 'highlight' | 'other';
}

interface TerminalSpawnMetrics {
  testName: string;
  timestamp: string;

  // Graph metrics
  totalNodeCount: number;
  selectedNodeCount: number;  // Number of nodes explicitly selected for context
  contextNodeContainedCount: number;

  // Timing metrics
  terminalSpawnTimeMs: number;      // Time until API returns + context node appears
  screenshot1TimeMs: number;        // Time to capture first screenshot
  terminalReadyTimeMs: number;      // Additional time until xterm element is visible
  totalTimeToReadyMs: number;       // Total time from spawn start to terminal ready
  profileDurationMs: number;

  // CPU profile metrics
  totalSamples: number;
  topFunctions: TopFunction[];

  // Aggregated by category
  styleFunctionsTotalPct: number;
  layoutFunctionsTotalPct: number;
  highlightFunctionsPct: number;

  // Raw profile path for Chrome DevTools
  rawProfilePath: string;
}

/**
 * Categorize function by name pattern
 */
function categorizeFunction(functionName: string, url: string): TopFunction['category'] {
  // Style functions (Cytoscape style recalculation)
  if (functionName.startsWith('styfn$') || functionName.includes('Style') || functionName.includes('style')) {
    return 'style';
  }
  // Layout functions (cola, dagre, etc.)
  if (functionName.includes('layout') || functionName.includes('cola') || functionName.includes('Layout')) {
    return 'layout';
  }
  // Highlight functions
  if (functionName.includes('highlight') || functionName.includes('Highlight') ||
      url.includes('highlightContextNodes')) {
    return 'highlight';
  }
  return 'other';
}

// Extend test with Electron app
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-terminal-spawn-profile-'));

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

test.describe('Renderer Terminal Spawn CPU Profile', () => {
  test('should capture CPU profile during terminal spawn with 50+ selected nodes', async ({ appWindow }) => {
    test.setTimeout(180000); // 3 minute timeout for full profile capture

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

    const totalNodeCount = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      return cy?.nodes().length ?? 0;
    });
    console.log(`Graph loaded with ${totalNodeCount} nodes`);

    console.log('=== STEP 2: Collect ALL node IDs for context selection ===');

    // Get all node IDs to select for context (this triggers the 30+ node bottleneck)
    const allNodeIds: string[] = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return cy.nodes().map(node => node.id());
    });

    console.log(`Collected ${allNodeIds.length} node IDs for context selection`);

    // Get first node's position for task node placement
    const firstNodePosition = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return { x: 0, y: 0 };
      const firstNode = cy.nodes()[0];
      return firstNode ? firstNode.position() : { x: 0, y: 0 };
    });

    console.log('=== STEP 3: Start CDP CPU profiling BEFORE terminal spawn ===');

    const context = appWindow.context();
    const cdpSession: CDPSession = await context.newCDPSession(appWindow);

    await cdpSession.send('Profiler.enable');
    await cdpSession.send('Profiler.start');
    console.log('CPU profiler started');

    console.log('=== STEP 4: Use runAgentOnSelectedNodes to create context with ALL nodes ===');

    const spawnStartTime = Date.now();

    // Use runAgentOnSelectedNodes which creates context node with explicit node selection
    // This bypasses the distance-based BFS limit and includes ALL selected nodes
    const runResult = await appWindow.evaluate(async (params: {
      selectedNodeIds: string[];
      position: { x: number; y: number };
    }) => {
      performance.mark('test:ipc:start');
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      const result = await api.main.runAgentOnSelectedNodes({
        selectedNodeIds: params.selectedNodeIds,
        taskDescription: 'CPU Profile Performance Test - 50+ nodes context',
        position: params.position
      });
      performance.mark('test:ipc:end');
      performance.measure('IPC call duration', 'test:ipc:start', 'test:ipc:end');
      const ipcMeasure = performance.getEntriesByName('IPC call duration')[0];
      console.log(`[TIMING] IPC call took: ${ipcMeasure?.duration?.toFixed(1)}ms`);

      // Check how many nodes have active breathing animations
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      const breathingNodes = cy?.nodes().filter(n => n.data('breathingActive') === true).length ?? 0;
      console.log(`[TIMING] Nodes with active breathing animations: ${breathingNodes}`);

      return result;
    }, { selectedNodeIds: allNodeIds, position: firstNodePosition });

    const ipcEndTime = Date.now();
    const ipcDuration = ipcEndTime - spawnStartTime;
    console.log(`IPC call returned after ${ipcDuration}ms`);

    const contextNodeId = runResult.contextNodeId;
    console.log(`Context node created: ${contextNodeId}`);
    console.log(`Task node created: ${runResult.taskNodeId}`);
    console.log(`Terminal spawned: ${runResult.terminalId}`);

    // Wait for context node to appear in Cytoscape
    const pollStartTime = Date.now();
    await expect.poll(async () => {
      return appWindow.evaluate((ctxId) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) return false;
        return cy.getElementById(ctxId).length > 0;
      }, contextNodeId);
    }, {
      message: 'Waiting for context node to appear in graph',
      timeout: 60000
    }).toBe(true);
    const pollEndTime = Date.now();
    const pollDuration = pollEndTime - pollStartTime;
    console.log(`Context node appeared after ${pollDuration}ms of polling`);

    const spawnEndTime = Date.now();
    const terminalSpawnTimeMs = spawnEndTime - spawnStartTime;
    console.log(`Total spawn time: ${terminalSpawnTimeMs}ms (IPC: ${ipcDuration}ms + Poll: ${pollDuration}ms)`);

    console.log(`Full spawn flow completed in ${terminalSpawnTimeMs}ms`);

    // Screenshot immediately after "spawn" is considered complete
    const screenshot1Start = Date.now();
    await appWindow.screenshot({ path: '/tmp/terminal-spawn-1-api-returned.png' });
    const screenshot1Time = Date.now() - screenshot1Start;
    console.log(`Screenshot 1: Took ${screenshot1Time}ms`);

    // Now wait for terminal to actually be ready - check for xterm element
    console.log('=== STEP 4b: Wait for terminal to be ready for input ===');
    const terminalReadyStart = Date.now();

    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        // Check for xterm terminal element being rendered
        const xtermElement = document.querySelector('.xterm-screen');
        return xtermElement !== null;
      });
    }, {
      message: 'Waiting for xterm terminal to be ready',
      timeout: 30000,
      intervals: [100, 200, 500]
    }).toBe(true);

    const terminalReadyTime = Date.now() - terminalReadyStart;
    const totalTimeToReady = Date.now() - spawnStartTime;

    await appWindow.screenshot({ path: '/tmp/terminal-spawn-2-xterm-ready.png' });
    console.log(`Screenshot 2: Terminal xterm element visible (additional ${terminalReadyTime}ms, total ${totalTimeToReady}ms)`);

    // Wait a tiny bit for any async cleanup, then stop profiler
    // We want to capture JUST the freeze, not idle time after
    await appWindow.waitForTimeout(500);
    const profileDurationMs = Date.now() - spawnStartTime;

    console.log('=== STEP 5: Stop profiling immediately after freeze ===');

    const { profile } = await cdpSession.send('Profiler.stop') as { profile: CPUProfile };
    await cdpSession.send('Profiler.disable');
    console.log('CPU profiler stopped');

    // Save raw profile for Chrome DevTools
    await fs.writeFile(RAW_PROFILE_PATH, JSON.stringify(profile, null, 2), 'utf8');
    console.log(`Raw .cpuprofile saved to ${RAW_PROFILE_PATH}`);

    console.log('=== STEP 7: Get context node contained count ===');

    // Get the containedNodeIds from the context node we created earlier
    const containedCount = await appWindow.evaluate(async (ctxId) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('API not available');

      const node = await api.main.getNode(ctxId);
      if (node?.nodeUIMetadata?.containedNodeIds) {
        return node.nodeUIMetadata.containedNodeIds.length;
      }
      return 0;
    }, contextNodeId);

    console.log(`Context node: ${contextNodeId}, contained nodes: ${containedCount}`);

    console.log('=== STEP 8: Analyze profile to find hot functions ===');

    // Calculate total hit count
    const totalHits = profile.nodes.reduce((sum, node) => sum + (node.hitCount || 0), 0);
    console.log(`Total samples: ${totalHits}`);

    // Find hot functions with category classification
    const topFunctions: TopFunction[] = profile.nodes
      .filter(node => (node.hitCount || 0) > 0)
      .map(node => ({
        functionName: node.callFrame.functionName || '(anonymous)',
        url: node.callFrame.url,
        lineNumber: node.callFrame.lineNumber,
        hitCount: node.hitCount || 0,
        percentage: totalHits > 0 ? ((node.hitCount || 0) / totalHits) * 100 : 0,
        category: categorizeFunction(node.callFrame.functionName || '', node.callFrame.url)
      }))
      .sort((a, b) => b.hitCount - a.hitCount)
      .slice(0, 50);

    // Calculate aggregated percentages by category
    const styleFunctionsTotalPct = topFunctions
      .filter(fn => fn.category === 'style')
      .reduce((sum, fn) => sum + fn.percentage, 0);

    const layoutFunctionsTotalPct = topFunctions
      .filter(fn => fn.category === 'layout')
      .reduce((sum, fn) => sum + fn.percentage, 0);

    const highlightFunctionsPct = topFunctions
      .filter(fn => fn.category === 'highlight')
      .reduce((sum, fn) => sum + fn.percentage, 0);

    console.log('\n=== TOP 20 HOT FUNCTIONS ===');
    topFunctions.slice(0, 20).forEach((fn, i) => {
      const shortUrl = fn.url.split('/').slice(-2).join('/');
      console.log(`${i + 1}. [${fn.category}] ${fn.functionName} (${fn.percentage.toFixed(1)}%) - ${shortUrl}:${fn.lineNumber}`);
    });

    console.log('\n=== AGGREGATED BY CATEGORY ===');
    console.log(`Style functions (styfn$*): ${styleFunctionsTotalPct.toFixed(1)}%`);
    console.log(`Layout functions: ${layoutFunctionsTotalPct.toFixed(1)}%`);
    console.log(`Highlight functions: ${highlightFunctionsPct.toFixed(1)}%`);

    console.log('=== STEP 9: Write metrics to JSON file ===');

    const selectedNodeCount = allNodeIds.length;
    const metrics: TerminalSpawnMetrics = {
      testName: 'renderer-terminal-spawn-cpu-profile',
      timestamp: new Date().toISOString(),

      // Graph metrics
      totalNodeCount,
      selectedNodeCount,
      contextNodeContainedCount: containedCount,

      // Timing metrics
      terminalSpawnTimeMs,
      screenshot1TimeMs: screenshot1Time,
      terminalReadyTimeMs: terminalReadyTime,
      totalTimeToReadyMs: totalTimeToReady,
      profileDurationMs,

      // CPU profile metrics
      totalSamples: totalHits,
      topFunctions,

      // Aggregated by category
      styleFunctionsTotalPct,
      layoutFunctionsTotalPct,
      highlightFunctionsPct,

      // Raw profile path
      rawProfilePath: RAW_PROFILE_PATH
    };

    await fs.writeFile(PROFILE_OUTPUT_PATH, JSON.stringify(metrics, null, 2), 'utf8');
    console.log(`\nMetrics written to ${PROFILE_OUTPUT_PATH}`);

    console.log('\n=== CLI COMMANDS ===');
    console.log(`View summary:`);
    console.log(`  cat ${PROFILE_OUTPUT_PATH} | jq '{selectedNodeCount, contextNodeContainedCount, terminalSpawnTimeMs, terminalReadyTimeMs, totalTimeToReadyMs, styleFunctionsTotalPct}'`);
    console.log(`\nView top 10 functions:`);
    console.log(`  cat ${PROFILE_OUTPUT_PATH} | jq '.topFunctions[:10] | .[] | "[\\(.category)] \\(.percentage | tostring | .[0:5])% \\(.functionName)"'`);
    console.log(`\nOpen flame graph in Chrome DevTools:`);
    console.log(`  1. Open chrome://inspect`);
    console.log(`  2. Click "Open dedicated DevTools for Node"`);
    console.log(`  3. Go to Performance tab > Load profile > ${RAW_PROFILE_PATH}`);

    // Basic assertions
    expect(topFunctions.length).toBeGreaterThan(0);
    expect(totalHits).toBeGreaterThan(0);

    // Key assertion: verify we have 30+ contained nodes (the threshold for performance issues)
    expect(containedCount).toBeGreaterThanOrEqual(30);

    console.log('\n=== RESULTS SUMMARY ===');
    console.log(`Graph: ${totalNodeCount} nodes`);
    console.log(`Selected for context: ${selectedNodeCount} nodes`);
    console.log(`Context node contained: ${containedCount} nodes`);
    console.log(`Terminal spawn time (API return): ${terminalSpawnTimeMs}ms`);
    console.log(`Terminal ready time (additional): ${terminalReadyTime}ms`);
    console.log(`Total time to ready: ${totalTimeToReady}ms`);
    console.log(`Style functions: ${styleFunctionsTotalPct.toFixed(1)}%`);
    console.log(`Highlight functions: ${highlightFunctionsPct.toFixed(1)}%`);
    console.log(`\nScreenshots saved to:`);
    console.log(`  /tmp/terminal-spawn-1-api-returned.png`);
    console.log(`  /tmp/terminal-spawn-2-xterm-ready.png`);
  });
});

export { test };
