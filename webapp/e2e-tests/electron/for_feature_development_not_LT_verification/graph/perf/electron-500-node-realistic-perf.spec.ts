/**
 * E2E TEST: Realistic 500-Node Performance — Full Pipeline
 *
 * Unlike the synthetic perf test (cy.add()), this test exercises the REAL pipeline:
 *   filesystem → file watcher → markdown parser → graph delta → COLA layout → render
 *
 * PHASES:
 * 1. LOAD — Generate 500 .md files on disk, launch Electron, measure load-to-interactive
 * 2. PAN/ZOOM — Measure FPS on the settled real graph with compound nodes + real edges
 * 3. UPDATE — Write a new .md file to disk, wait for file watcher pickup + relayout
 *
 * SETUP:
 * - Build first: npx electron-vite build
 * - Config: playwright-electron-dev.config.ts
 * - Trace output: webapp/e2e-tests/perf-traces/<operation>-<timestamp>.json
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import type { Core as CytoscapeCore } from 'cytoscape';
import { killOrphanVtGraphdDaemons } from '@vt/graph-db-client';

import { generateVaultOnDisk } from './perf-helpers/generateRealisticVault';
import {
  startCDPTrace,
  stopCDPTraceAndSave,
  analyzeTrace,
  printMetricsTable,
  logGpuTraceEvents,
  fmtMs,
  CDP_PAN_ZOOM_CATEGORIES,
} from './perf-helpers/cdpTrace';
import {
  startMainProcessProfile,
  stopMainProcessProfileAndSave,
  analyzeMainProcessProfile,
  printMainProcessMetrics,
} from './perf-helpers/mainProcessProfile';
import { waitForLayoutStable } from './perf-helpers/layoutHelpers';
import { simulatePanZoom, type PanZoomFpsResult } from './perf-helpers/simulatePanZoom';

const PROJECT_ROOT = path.resolve(process.cwd());
const PERF_TRACES_DIR = path.join(PROJECT_ROOT, 'e2e-tests', 'perf-traces');

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: {
    main?: {
      startFileWatching?: (directoryPath?: string) => Promise<{ success: boolean; directory?: string; error?: string }>;
      getGraph?: () => Promise<{ nodes?: Record<string, unknown>; edges?: Record<string, unknown> }>;
    };
  };
}

// ============================================================================
// Fixtures
// ============================================================================

let mainInspectPort = 0;
let generatedVaultPath = '';
let generatedProjectPath = '';

const REALISTIC_PERF_NODE_COUNT = Number.parseInt(process.env.REALISTIC_PERF_NODE_COUNT ?? '500', 10);

function canLoadNativeGraphDbModules(nodeBin: string): boolean {
  try {
    execFileSync(nodeBin, ['-e', "const { DatabaseSync } = require('node:sqlite'); new DatabaseSync(':memory:').close()"], {
      cwd: path.resolve(PROJECT_ROOT, '..'),
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function resolveGraphDaemonNodeBin(): string {
  const nvmNodeBin = path.join(os.homedir(), '.nvm', 'versions', 'node', 'v22.20.0', 'bin', 'node');
  const candidates = [
    process.env.VT_GRAPHD_NODE_BIN,
    process.env.npm_node_execpath,
    process.execPath,
    existsSync(nvmNodeBin) ? nvmNodeBin : undefined,
    'node',
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find(canLoadNativeGraphDbModules) ?? process.execPath;
}

async function collectLoadDiagnostics(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async (projectRoot) => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    const api = (
      window as unknown as {
        electronAPI?: {
          main?: {
            getWatchStatus?: () => Promise<unknown>;
            getVaultPaths?: () => Promise<unknown>;
            getGraph?: () => Promise<{ nodes?: Record<string, unknown>; edges?: Record<string, unknown> }>;
          };
        };
      }
    ).electronAPI;

    const safeCall = async <T>(fn: (() => Promise<T>) | undefined): Promise<T | string> => {
      if (!fn) return 'unavailable';
      try {
        return await fn();
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };

    const bodyText = document.body?.innerText?.slice(0, 1000) ?? '';
    const graph = await safeCall(api?.main?.getGraph);
    const graphNodeCount = typeof graph === 'object' && graph !== null && 'nodes' in graph
      ? Object.keys((graph as { nodes?: Record<string, unknown> }).nodes ?? {}).length
      : graph;
    const graphEdgeCount = typeof graph === 'object' && graph !== null && 'edges' in graph
      ? Object.keys((graph as { edges?: Record<string, unknown> }).edges ?? {}).length
      : graph;

    return {
      url: location.href,
      title: document.title,
      projectRoot,
      bodyText,
      hasCytoscape: Boolean(cy),
      cyNodes: cy?.nodes().length ?? null,
      cyEdges: cy?.edges().length ?? null,
      watchStatus: await safeCall(api?.main?.getWatchStatus),
      vaultPaths: await safeCall(api?.main?.getVaultPaths),
      graphNodeCount,
      graphEdgeCount,
    };
  }, generatedVaultPath);
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(
      path.join(os.tmpdir(), 'voicetree-realistic-perf-')
    );

    generatedProjectPath = path.join(tempUserDataPath, 'perf-test-project');
    generatedVaultPath = await generateVaultOnDisk(generatedProjectPath, REALISTIC_PERF_NODE_COUNT);

    // Seed projects.json pointing at the generated vault
    const projectsPath = path.join(tempUserDataPath, 'projects.json');
    await fs.writeFile(
      projectsPath,
      JSON.stringify([{
        id: 'realistic-perf-project',
        path: generatedProjectPath,
        name: 'perf-test-vault',
        type: 'folder',
        lastOpened: Date.now(),
        voicetreeInitialized: true,
      }], null, 2),
      'utf8'
    );

    // Seed voicetree-config.json with vault config so the app loads ALL .md files
    // Without this, the app creates a new voicetree-{date} subfolder and only loads that
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        lastDirectory: generatedProjectPath,
        vaultConfig: {
          [generatedProjectPath]: {
            writeFolder: generatedVaultPath,
            readPaths: [],
          }
        }
      }, null, 2),
      'utf8'
    );

    const INSPECT_PORT = 9231; // Different port from synthetic test
    const electronApp = await electron.launch({
      args: [
        `--inspect=${INSPECT_PORT}`,
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`,
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '0',
        MINIMIZE_TEST: '0',
        VOICETREE_PERSIST_STATE: '1',
        VOICETREE_DAEMON_LOAD_TIMEOUT_MS: '180000',
        VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(),
      },
      timeout: 30000,
    });
    mainInspectPort = INSPECT_PORT;

    // Surface [load-timing] lines from the main process. Playwright's Electron
    // launch captures stdout into a pipe that no one reads by default, so
    // process.stdout.write() inside the bundled main goes nowhere visible.
    const mainStdout = electronApp.process().stdout;
    if (mainStdout) {
      mainStdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        for (const line of text.split('\n')) {
          if (line.startsWith('[load-timing]')) {
            console.log(line);
          }
        }
      });
    }

    await use(electronApp);

    // Graceful shutdown
    try {
      const window = await electronApp.firstWindow();
      await window.evaluate(async () => {
        const api = (
          window as unknown as {
            electronAPI?: { main?: { stopFileWatching?: () => Promise<void> } };
          }
        ).electronAPI;
        if (api?.main?.stopFileWatching) {
          await api.main.stopFileWatching();
        }
      });
      await window.waitForTimeout(300);
    } catch {
      // Ignore shutdown errors
    }

    await electronApp.close();
    await fs.rm(tempUserDataPath, { recursive: true, force: true });

    // After the temp vault is gone, any leftover vt-graphd daemons spawned by
    // this run point at a non-existent path. Reap them so they don't hold
    // ports for the next scenario or developer iteration.
    const reaped = killOrphanVtGraphdDaemons();
    if (reaped.killed.length > 0) {
      console.log('[Realistic Perf] Reaped orphan vt-graphd daemons', reaped.killed);
    }
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 30000 });

    window.on('console', (msg) => {
      const type = msg.type();
      const text = msg.text();
      if (type === 'warning' || type === 'error') {
        console.log(`BROWSER [${type}]:`, text);
      } else if (text.startsWith('[load-timing]')) {
        console.log(text);
      }
    });
    window.on('pageerror', (error) => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');

    // Click the seeded project to navigate to graph view
    await window.waitForSelector('text=Voicetree', { timeout: 15000 });
    const projectButton = window.locator('button:has-text("perf-test-vault")').first();
    await projectButton.click();
    console.log(`[Realistic Perf] Clicked project to enter graph view (project=${generatedProjectPath}, writeFolder=${generatedVaultPath}, nodes=${REALISTIC_PERF_NODE_COUNT})`);

    const watchResult = await window.evaluate(async (projectPath) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api?.main?.startFileWatching) {
        throw new Error('electronAPI.main.startFileWatching is unavailable');
      }
      return api.main.startFileWatching(projectPath);
    }, generatedProjectPath);
    console.log('[Realistic Perf] startFileWatching result:', JSON.stringify(watchResult));
    expect(watchResult.success, watchResult.error ?? 'startFileWatching failed').toBe(true);

    // Wait for Cytoscape instance to become available
    await window.waitForFunction(
      () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
      undefined,
      { timeout: 30000 }
    );

    await use(window);
  },
});

// ============================================================================
// Test
// ============================================================================

test.describe('Realistic 500-Node Performance', () => {
  test('LOAD → PAN/ZOOM → UPDATE with real vault pipeline', async ({ electronApp: _electronApp, appWindow }) => {
    test.setTimeout(600000); // 10 min — real pipeline is much slower

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const cdp = await appWindow.context().newCDPSession(appWindow);
    let rendererProfilerActive = false;

    const startRendererProfiler = async (): Promise<void> => {
      await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
      await cdp.send('Profiler.start');
      rendererProfilerActive = true;
    };

    const stopRendererProfiler = async (
      options?: { suppressErrors?: boolean }
    ): Promise<{ profile?: unknown } | undefined> => {
      if (!rendererProfilerActive) return undefined;
      rendererProfilerActive = false;
      try {
        return await cdp.send('Profiler.stop') as { profile?: unknown };
      } catch (error) {
        if (options?.suppressErrors) return undefined;
        throw error;
      }
    };

    // Start main process profiling
    await startMainProcessProfile(mainInspectPort);
    console.log('[Realistic Perf] Main process CPU profiler started');

    await cdp.send('Profiler.enable');
    await cdp.send('Performance.enable');
    await startRendererProfiler();
    console.log('[Realistic Perf] Renderer process CPU profiler started');

    try {

    // ======================================================================
    // Phase 1: LOAD — measure load-to-interactive
    // ======================================================================
    const loadMetrics = await test.step('PHASE 1: LOAD 500-node vault', async () => {
      console.log('\n=== PHASE 1: LOAD (real pipeline) ===');
      await appWindow.evaluate(() => performance.mark('load-start'));
      await startCDPTrace(cdp);

      await expect
        .poll(
          async () => appWindow.evaluate(async () => {
            const graph = await (window as unknown as ExtendedWindow).electronAPI?.main?.getGraph?.();
            return Object.keys(graph?.nodes ?? {}).length;
          }),
          {
            message: 'Waiting for main graph to load generated vault nodes',
            timeout: 300000,
            intervals: [5000, 5000, 5000, 5000, 5000],
          }
        )
        .toBeGreaterThan(0);

      // Wait for graph to have nodes from the file watcher pipeline
      // The real pipeline processes files through: watcher → parser → graph delta → layout
      // Poll and log progress until node count stabilizes.
      let lastCount = -1;
      let stableRuns = 0;
      const STABLE_THRESHOLD = 4; // 4 consecutive same-count polls = ~20s stable

      try {
        await expect
          .poll(
            async () => {
              const info = await appWindow.evaluate((): { nodes: number; edges: number } => {
                const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
                if (!cy) return { nodes: 0, edges: 0 };
                return { nodes: cy.nodes().length, edges: cy.edges().length };
              });
              console.log(`[Load poll] nodes=${info.nodes} edges=${info.edges} stableRuns=${stableRuns}`);

              if (info.nodes === lastCount && info.nodes > 0) {
                stableRuns++;
              } else {
                stableRuns = 0;
                lastCount = info.nodes;
              }

              return stableRuns >= STABLE_THRESHOLD;
            },
            {
              message: `Waiting for vault to finish loading (last count: ${lastCount})`,
              timeout: 300000,
              intervals: [5000, 5000, 5000, 5000, 5000],
            }
          )
          .toBe(true);
      } catch (error) {
        console.error('[Realistic Perf] LOAD wait diagnostics:', JSON.stringify(await collectLoadDiagnostics(appWindow), null, 2));
        throw error;
      }
      console.log(`[Realistic Perf] Vault loading complete at ${lastCount} nodes`);

      const nodeCountBeforeStable = await appWindow.evaluate((): number => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        return cy ? cy.nodes().length : 0;
      });
      console.log(`[Realistic Perf] Nodes before layout stable: ${nodeCountBeforeStable}`);

      await waitForLayoutStable(appWindow, 180000);
      await appWindow.evaluate(() => performance.mark('load-layout-stable'));

      const finalCount = await appWindow.evaluate((): { nodes: number; edges: number } => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) return { nodes: 0, edges: 0 };
        return { nodes: cy.nodes().length, edges: cy.edges().length };
      });
      console.log(`[Realistic Perf] Final: ${finalCount.nodes} nodes, ${finalCount.edges} edges`);

      const trace = await stopCDPTraceAndSave(cdp, PERF_TRACES_DIR, `realistic-load-500-${timestamp}.json`);
      logGpuTraceEvents(trace, 'LOAD');
      const loadPerfM = await cdp.send('Performance.getMetrics') as { metrics: Array<{ name: string; value: number }> };
      const loadHeap = loadPerfM.metrics.find(m => m.name === 'JSHeapUsedSize');
      console.log(`[Memory] JS Heap: ${((loadHeap?.value ?? 0) / 1024 / 1024).toFixed(1)} MB`);
      const m = analyzeTrace(trace, 'LOAD 500-node vault (real pipeline)');
      printMetricsTable(m);
      return m;
    });

    // Save LOAD-phase renderer profile
    const loadProfile = (await stopRendererProfiler())?.profile;
    if (loadProfile) {
      const loadJson = JSON.stringify(loadProfile, null, 2);
      const loadPath = path.join(PERF_TRACES_DIR, `realistic-renderer-load-${timestamp}.cpuprofile`);
      await fs.writeFile(loadPath, loadJson, 'utf8');
      console.log('  LOAD-phase renderer profile saved');
      const loadProfMetrics = analyzeMainProcessProfile(loadJson);
      console.log('\n  LOAD RENDERER CPU PROFILE:');
      printMainProcessMetrics(loadProfMetrics);
    }

    // Extra settle time
    await appWindow.waitForTimeout(3000);

    // ======================================================================
    // Phase 2: PAN/ZOOM on settled real graph
    // ======================================================================
    await startRendererProfiler();

    let fpsResult: PanZoomFpsResult | undefined;

    const panZoomMetrics = await test.step('PHASE 2: PAN/ZOOM on settled real graph', async () => {
      console.log('\n=== PHASE 2: PAN/ZOOM (real graph) ===');
      await appWindow.evaluate(() => performance.mark('panzoom-start'));
      await startCDPTrace(cdp, CDP_PAN_ZOOM_CATEGORIES);

      const gpuRenderer = await appWindow.evaluate(() => {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        return gl ? (gl.getParameter(gl.RENDERER) as string) : 'no webgl';
      });
      console.log(`[GPU] WebGL renderer: ${gpuRenderer}`);

      fpsResult = await simulatePanZoom(appWindow);
      console.log(`[PanZoom FPS] rAF: ${fpsResult.rafFps} FPS (${fpsResult.frameCount} frames)${fpsResult.cytoscapeFps !== undefined ? `, Cytoscape native: ${fpsResult.cytoscapeFps} FPS` : ', Cytoscape native FPS: unavailable'}`);

      await appWindow.evaluate(() => performance.mark('panzoom-end'));

      const trace = await stopCDPTraceAndSave(cdp, PERF_TRACES_DIR, `realistic-panzoom-500-${timestamp}.json`);
      logGpuTraceEvents(trace, 'PAN/ZOOM');
      const pzPerfM = await cdp.send('Performance.getMetrics') as { metrics: Array<{ name: string; value: number }> };
      const pzHeap = pzPerfM.metrics.find(m => m.name === 'JSHeapUsedSize');
      console.log(`[Memory] JS Heap: ${((pzHeap?.value ?? 0) / 1024 / 1024).toFixed(1)} MB`);
      const m = analyzeTrace(trace, 'PAN/ZOOM on real 500-node graph');
      printMetricsTable(m);
      return m;
    });

    // Save PAN/ZOOM renderer profile
    const pzProfile = (await stopRendererProfiler())?.profile;
    if (pzProfile) {
      const pzJson = JSON.stringify(pzProfile, null, 2);
      const pzPath = path.join(PERF_TRACES_DIR, `realistic-panzoom-renderer-${timestamp}.cpuprofile`);
      await fs.writeFile(pzPath, pzJson, 'utf8');
      console.log(`  Pan/Zoom renderer profile saved (${(Buffer.byteLength(pzJson) / 1024).toFixed(0)} KB)`);
      const pzMetrics = analyzeMainProcessProfile(pzJson);
      console.log('\n  PAN/ZOOM RENDERER CPU PROFILE (real graph):');
      printMainProcessMetrics(pzMetrics);
    }

    // ======================================================================
    // Phase 3: UPDATE — write new .md file to disk, measure file watcher pickup
    // ======================================================================
    await startRendererProfiler();

    const updateMetrics = await test.step('PHASE 3: UPDATE — new file via file watcher', async () => {
      console.log('\n=== PHASE 3: UPDATE (file watcher pipeline) ===');

      const preUpdateCount = await appWindow.evaluate((): number => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        return cy ? cy.nodes().length : 0;
      });
      console.log(`[Realistic Perf] Nodes before update: ${preUpdateCount}`);

      await appWindow.evaluate(() => performance.mark('update-start'));
      await startCDPTrace(cdp);

      // Write a new .md file to the vault — the file watcher should pick it up
      const newNodeContent = [
        '---',
        'isContextNode: false',
        '---',
        '# New node added during test',
        '',
        'This node was created to measure the UPDATE pipeline.',
        '',
        '-----------------',
        '_Links:_',
        '',
        '[[node-0.md]]',
      ].join('\n');

      await fs.writeFile(
        path.join(generatedVaultPath, 'update-test-node.md'),
        newNodeContent,
        'utf8'
      );
      console.log('[Realistic Perf] Wrote update-test-node.md to vault');

      // Wait for the new node to appear in the graph
      await appWindow.waitForFunction(
        (expected: number) => {
          const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
          if (!cy) return false;
          return cy.nodes().length > expected;
        },
        preUpdateCount,
        { timeout: 60000 }
      );

      await waitForLayoutStable(appWindow, 60000);
      await appWindow.evaluate(() => performance.mark('update-layout-stable'));

      const postUpdateCount = await appWindow.evaluate((): number => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        return cy ? cy.nodes().length : 0;
      });
      console.log(`[Realistic Perf] Nodes after update: ${postUpdateCount} (+${postUpdateCount - preUpdateCount})`);

      const trace = await stopCDPTraceAndSave(cdp, PERF_TRACES_DIR, `realistic-update-${timestamp}.json`);
      logGpuTraceEvents(trace, 'UPDATE');
      const updPerfM = await cdp.send('Performance.getMetrics') as { metrics: Array<{ name: string; value: number }> };
      const updHeap = updPerfM.metrics.find(m => m.name === 'JSHeapUsedSize');
      console.log(`[Memory] JS Heap: ${((updHeap?.value ?? 0) / 1024 / 1024).toFixed(1)} MB`);
      const m = analyzeTrace(trace, 'UPDATE — file watcher pipeline');
      printMetricsTable(m);
      return m;
    });

    // ======================================================================
    // Summary & assertions
    // ======================================================================
    await test.step('Summary & assertions', async () => {
      const sep = '='.repeat(70);
      console.log(`\n${sep}`);
      console.log('  REALISTIC 500-NODE PERFORMANCE — SUMMARY');
      console.log(sep);
      console.log(`  LOAD:     ${fmtMs(loadMetrics.totalDurationMs)} total, longest task ${fmtMs(loadMetrics.longestTaskMs)}`);
      console.log(`  PAN/ZOOM: ${fmtMs(panZoomMetrics.totalDurationMs)} total, longest task ${fmtMs(panZoomMetrics.longestTaskMs)}`);
      if (fpsResult) {
        console.log(`  PAN/ZOOM FPS (rAF):  ${fpsResult.rafFps} FPS (${fpsResult.frameCount} frames measured)`);
        if (fpsResult.cytoscapeFps !== undefined) {
          console.log(`  PAN/ZOOM FPS (cy):   ${fpsResult.cytoscapeFps} FPS (Cytoscape native)`);
        }
      }
      console.log(`  UPDATE:   ${fmtMs(updateMetrics.totalDurationMs)} total, longest task ${fmtMs(updateMetrics.longestTaskMs)}`);
      console.log(sep);
      console.log(`  Traces: ${PERF_TRACES_DIR}`);
      console.log(`  View:   chrome://tracing or https://ui.perfetto.dev`);
      console.log(sep);

      // Generous thresholds for first run — tighten after baseline established
      expect(loadMetrics.totalDurationMs, 'LOAD < 120s').toBeLessThan(120000);
      expect(panZoomMetrics.totalDurationMs, 'PAN/ZOOM < 30s').toBeLessThan(30000);
      expect(updateMetrics.totalDurationMs, 'UPDATE < 60s').toBeLessThan(60000);

      console.log('\nALL ASSERTIONS PASSED');
    });

    } finally {
      // Save remaining renderer profile
      await test.step('Renderer CPU profile (UPDATE phase)', async () => {
        const profile = (await stopRendererProfiler({ suppressErrors: true }))?.profile;
        if (profile) {
          const profileJson = JSON.stringify(profile, null, 2);
          const filepath = path.join(PERF_TRACES_DIR, `realistic-renderer-update-${timestamp}.cpuprofile`);
          await fs.writeFile(filepath, profileJson, 'utf8');
          console.log(`  Renderer UPDATE profile saved (${(Buffer.byteLength(profileJson) / 1024).toFixed(0)} KB)`);
          const metrics = analyzeMainProcessProfile(profileJson);
          console.log('\n  UPDATE RENDERER CPU PROFILE:');
          printMainProcessMetrics(metrics);
        }
      });

      // Main process profile
      await test.step('Main process CPU profile', async () => {
        const profilePath = await stopMainProcessProfileAndSave(
          PERF_TRACES_DIR,
          `realistic-main-process-${timestamp}.cpuprofile`,
        );
        const profileJson = await fs.readFile(profilePath, 'utf8');
        const metrics = analyzeMainProcessProfile(profileJson);
        printMainProcessMetrics(metrics);
      });
    }
  });
});

export { test };
