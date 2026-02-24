/**
 * E2E TEST: 500-Node CDP Performance Tracing
 *
 * Uses Chrome DevTools Protocol (CDP) to capture browser-level traces during
 * graph CRUD operations at scale (500 nodes). Produces `.json` trace files
 * openable in chrome://tracing or https://ui.perfetto.dev for flame-chart analysis.
 *
 * THREE PHASES (single test, test.step()):
 * 1. CREATE — Add 500 nodes (10 clusters × 50, binary-tree topology)
 *    → triggers runFullUltimateLayout (R-tree pack → Cola → fit)
 * 2. UPDATE — Add 50 new nodes to existing cluster roots
 *    → triggers local Cola (50/550 = 9%, < 30% threshold)
 * 3. DELETE — Remove those 50 nodes
 *    → triggers full rebalance (>7 nodes removed)
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
import type { Core as CytoscapeCore } from 'cytoscape';

import { generateClusteredGraph, generateUpdateElements } from './perf-helpers/generateClusteredGraph';
import type { GraphElement } from './perf-helpers/generateClusteredGraph';
import {
  startCDPTrace,
  stopCDPTraceAndSave,
  analyzeTrace,
  printMetricsTable,
  fmtMs,
} from './perf-helpers/cdpTrace';

const PROJECT_ROOT = path.resolve(process.cwd());
const PERF_TRACES_DIR = path.join(PROJECT_ROOT, 'e2e-tests', 'perf-traces');
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
}

// ============================================================================
// Fixtures — based on electron-smoke-test.spec.ts pattern
// Needs projects.json so the app shows a project to click into graph view
// ============================================================================

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(
      path.join(os.tmpdir(), 'voicetree-500node-perf-test-')
    );

    // Seed projects.json so app shows a clickable project on the selection screen
    const projectsPath = path.join(tempUserDataPath, 'projects.json');
    await fs.writeFile(
      projectsPath,
      JSON.stringify([{
        id: 'perf-test-project',
        path: FIXTURE_VAULT_PATH,
        name: 'example_small',
        type: 'folder',
        lastOpened: Date.now(),
        voicetreeInitialized: true,
      }], null, 2),
      'utf8'
    );

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`,
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
        VOICETREE_PERSIST_STATE: '1',
      },
      timeout: 15000,
    });

    await use(electronApp);

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
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15000 });

    window.on('console', (msg) => {
      const type = msg.type();
      if (type === 'warning' || type === 'error') {
        console.log(`BROWSER [${type}]:`, msg.text());
      }
    });
    window.on('pageerror', (error) => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');

    // Click the seeded project to navigate from project picker → graph view
    await window.waitForSelector('text=Voicetree', { timeout: 10000 });
    const projectButton = window.locator('button:has-text("example_small")').first();
    await projectButton.click();
    console.log('[Perf Test] Clicked project to enter graph view');

    // Wait for Cytoscape instance to become available
    await window.waitForFunction(
      () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
      { timeout: 15000 }
    );
    await window.waitForTimeout(1000);

    await use(window);
  },
});

// ============================================================================
// Layout stability helper
// ============================================================================

async function waitForLayoutStable(appWindow: Page, timeoutMs: number = 60000): Promise<void> {
  let lastSnapshot = '';

  await expect
    .poll(
      async () => {
        const snap = await appWindow.evaluate((): string => {
          const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
          if (!cy) return '';
          const positions: Array<[number, number]> = [];
          cy.nodes().forEach((n) => {
            if (!n.data('isContextNode')) {
              positions.push([Math.round(n.position('x')), Math.round(n.position('y'))]);
            }
          });
          return JSON.stringify(positions);
        });
        const stoppedMoving = snap === lastSnapshot && lastSnapshot !== '';
        lastSnapshot = snap;
        return stoppedMoving;
      },
      {
        message: 'Waiting for layout to stabilize',
        timeout: timeoutMs,
        intervals: [1000, 1000, 2000, 2000, 2000, 3000, 3000, 3000, 5000, 5000],
      }
    )
    .toBe(true);
}

// ============================================================================
// Test
// ============================================================================

test.describe('500-Node CDP Performance Trace', () => {
  test('CREATE → UPDATE → DELETE with CDP tracing', async ({ appWindow }) => {
    test.setTimeout(300000); // 5 min total

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const cdp = await appWindow.context().newCDPSession(appWindow);

    const graphElements = generateClusteredGraph(10, 50, 50000);
    const generatedNodeCount = graphElements.filter((e) => e.group === 'nodes').length;
    console.log(`Generated: ${generatedNodeCount} nodes, ${graphElements.length - generatedNodeCount} edges`);

    // Capture baseline node count (vault's pre-existing nodes from example_small)
    const baselineNodeCount = await appWindow.evaluate((): number => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      return cy ? cy.nodes().length : 0;
    });
    console.log(`Baseline nodes from vault: ${baselineNodeCount}`);

    // Phase 1: CREATE
    const createMetrics = await test.step('PHASE 1: CREATE 500 nodes', async () => {
      console.log('\n=== PHASE 1: CREATE ===');
      await appWindow.evaluate(() => performance.mark('graph-add-start'));
      await startCDPTrace(cdp);

      await appWindow.evaluate((els: GraphElement[]) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('cytoscapeInstance not available');
        cy.add(els as Parameters<typeof cy.add>[0]);
        performance.mark('cy-add-complete');
      }, graphElements);

      const count = await appWindow.evaluate((): number => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        return cy ? cy.nodes().length : 0;
      });
      expect(count).toBe(baselineNodeCount + generatedNodeCount);

      await waitForLayoutStable(appWindow, 60000);
      await appWindow.evaluate(() => performance.mark('layout-stable'));

      const trace = await stopCDPTraceAndSave(cdp, PERF_TRACES_DIR, `create-500-${timestamp}.json`);
      const m = analyzeTrace(trace, 'CREATE 500 nodes');
      printMetricsTable(m);
      return m;
    });

    // Diagnostic: check for pre-existing overlaps BEFORE UPDATE
    const preUpdateOverlapInfo = await appWindow.evaluate((): string => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return 'no cy';
      const nodes = cy.nodes().filter((n: { data: (key: string) => boolean }) => !n.data('isContextNode'));
      const lines: string[] = [`total nodes: ${nodes.length}`];
      let overlapCount = 0;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i].boundingBox({ includeLabels: false, includeOverlays: false, includeEdges: false });
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j].boundingBox({ includeLabels: false, includeOverlays: false, includeEdges: false });
          if (a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1) {
            const overlapX = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
            const overlapY = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
            lines.push(`OVERLAP: ${nodes[i].id()} [${a.x1.toFixed(0)},${a.y1.toFixed(0)},${a.x2.toFixed(0)},${a.y2.toFixed(0)}] vs ${nodes[j].id()} [${b.x1.toFixed(0)},${b.y1.toFixed(0)},${b.x2.toFixed(0)},${b.y2.toFixed(0)}] area=${(overlapX*overlapY).toFixed(0)}px²`);
            overlapCount++;
          }
        }
      }
      return overlapCount === 0 ? `PRE-UPDATE: 0 overlaps (${nodes.length} nodes) ✅` : `PRE-UPDATE: ${overlapCount} overlaps\n${lines.join('\n')}`;
    });

    // Write diagnostic to file so we can read it even if test fails
    await fs.writeFile(path.join(PERF_TRACES_DIR, 'overlap-diagnostic.txt'), preUpdateOverlapInfo, 'utf8');

    // Phase 2: UPDATE (+50 nodes, local Cola)
    const updateElements = generateUpdateElements(10, 5, 50000);
    const updateMetrics = await test.step('PHASE 2: UPDATE +50 nodes', async () => {
      console.log('\n=== PHASE 2: UPDATE ===');
      await appWindow.evaluate(() => performance.mark('update-add-start'));
      await startCDPTrace(cdp);

      await appWindow.evaluate((els: GraphElement[]) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('cytoscapeInstance not available');
        cy.add(els as Parameters<typeof cy.add>[0]);
        performance.mark('update-cy-add-complete');
      }, updateElements);

      const total = await appWindow.evaluate((): number => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        return cy ? cy.nodes().length : 0;
      });
      expect(total).toBe(baselineNodeCount + generatedNodeCount + 50);

      await waitForLayoutStable(appWindow, 30000);
      await appWindow.evaluate(() => performance.mark('update-layout-stable'));

      const trace = await stopCDPTraceAndSave(cdp, PERF_TRACES_DIR, `update-50-${timestamp}.json`);
      const m = analyzeTrace(trace, 'UPDATE +50 nodes (local Cola)');
      printMetricsTable(m);
      return m;
    });

    // Overlap assertion after UPDATE phase — AABB pairwise check
    await test.step('OVERLAP CHECK: No node overlaps after UPDATE', async () => {
      const overlaps = await appWindow.evaluate((): { count: number; pairs: Array<{ ids: string[]; boxes: Array<{ x1: number; y1: number; x2: number; y2: number }>; overlapArea: number }> } => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) return { count: 0, pairs: [] };
        const nodes = cy.nodes().filter((n: { data: (key: string) => boolean }) => !n.data('isContextNode'));
        const pairs: Array<{ ids: string[]; boxes: Array<{ x1: number; y1: number; x2: number; y2: number }>; overlapArea: number }> = [];
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i].boundingBox({ includeLabels: false, includeOverlays: false, includeEdges: false });
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j].boundingBox({ includeLabels: false, includeOverlays: false, includeEdges: false });
            if (a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1) {
              const overlapX = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
              const overlapY = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
              pairs.push({ ids: [nodes[i].id(), nodes[j].id()], boxes: [a, b], overlapArea: overlapX * overlapY });
            }
          }
        }
        return { count: pairs.length, pairs: pairs.slice(0, 10) };
      });

      // Build detailed message for diagnostics
      const overlapDetails = overlaps.pairs.map(p =>
        `${p.ids[0]} [${p.boxes[0].x1.toFixed(0)},${p.boxes[0].y1.toFixed(0)},${p.boxes[0].x2.toFixed(0)},${p.boxes[0].y2.toFixed(0)}] vs ${p.ids[1]} [${p.boxes[1].x1.toFixed(0)},${p.boxes[1].y1.toFixed(0)},${p.boxes[1].x2.toFixed(0)},${p.boxes[1].y2.toFixed(0)}] area=${p.overlapArea.toFixed(0)}px²`
      ).join('\n');
      await fs.writeFile(path.join(PERF_TRACES_DIR, 'post-update-overlap-diagnostic.txt'),
        overlaps.count === 0 ? 'No overlaps ✅' : `${overlaps.count} overlaps:\n${overlapDetails}`, 'utf8');
      expect(overlaps.count, `No node overlaps after UPDATE (found ${overlaps.count}):\n${overlapDetails}`).toBe(0);
    });

    // Phase 3: DELETE (-50 nodes, full rebalance)
    const deleteMetrics = await test.step('PHASE 3: DELETE 50 nodes', async () => {
      console.log('\n=== PHASE 3: DELETE ===');
      await appWindow.evaluate(() => performance.mark('delete-start'));
      await startCDPTrace(cdp);

      await appWindow.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('cytoscapeInstance not available');
        cy.remove(cy.nodes().filter((n) => n.id().includes('update')));
        performance.mark('delete-cy-remove-complete');
      });

      const remaining = await appWindow.evaluate((): number => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        return cy ? cy.nodes().length : 0;
      });
      expect(remaining).toBe(baselineNodeCount + generatedNodeCount);

      await waitForLayoutStable(appWindow, 60000);
      await appWindow.evaluate(() => performance.mark('delete-layout-stable'));

      const trace = await stopCDPTraceAndSave(cdp, PERF_TRACES_DIR, `delete-50-${timestamp}.json`);
      const m = analyzeTrace(trace, 'DELETE 50 nodes (full rebalance)');
      printMetricsTable(m);
      return m;
    });

    // Summary & sanity assertions
    await test.step('Summary & sanity assertions', async () => {
      const sep = '='.repeat(60);
      console.log(`\n${sep}`);
      console.log('  500-NODE CDP PERFORMANCE TRACE — SUMMARY');
      console.log(sep);
      console.log(`  CREATE: ${fmtMs(createMetrics.totalDurationMs)} total, longest ${fmtMs(createMetrics.longestTaskMs)}`);
      console.log(`  UPDATE: ${fmtMs(updateMetrics.totalDurationMs)} total, longest ${fmtMs(updateMetrics.longestTaskMs)}`);
      console.log(`  DELETE: ${fmtMs(deleteMetrics.totalDurationMs)} total, longest ${fmtMs(deleteMetrics.longestTaskMs)}`);
      console.log(sep);
      console.log(`  Traces: ${PERF_TRACES_DIR}`);
      console.log(`  View:   chrome://tracing or https://ui.perfetto.dev`);
      console.log(sep);

      expect(createMetrics.totalDurationMs, 'CREATE < 60s').toBeLessThan(60000);
      expect(createMetrics.longestTaskMs, 'CREATE longest task < 10s').toBeLessThan(10000);
      // Pack->Fast Cola pipeline: UPDATE should be dramatically faster
      expect(updateMetrics.totalDurationMs, 'UPDATE < 10s (was 15.79s)').toBeLessThan(10000);
      expect(updateMetrics.longestTaskMs, 'UPDATE longest task < 500ms (was 9.34s)').toBeLessThan(500);
      expect(deleteMetrics.totalDurationMs, 'DELETE < 60s').toBeLessThan(60000);

      console.log('\n✅ ALL SANITY ASSERTIONS PASSED');
    });
  });
});

export { test };
