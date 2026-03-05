/**
 * E2E TEST: Incremental Separation — Minimal Movement
 *
 * BEHAVIORAL SPEC:
 * When a graph already has an established layout (hasRunInitialLayout=true) and new nodes
 * form a second disconnected component that overlaps the existing layout, the incremental
 * path (separateOverlappingComponents) nudges the components apart with MINIMAL displacement
 * — not rebuilding from scratch (which would teleport everything hundreds/thousands of px).
 *
 * TEST FLOW:
 * Phase 1 (Setup — triggers full layout):
 *   1. Add 9 connected nodes (cluster A, 3×3 grid) + 1 far isolated node (far1 at 5000,5000)
 *      → 10 initial nodes
 *   2. onNodeAdd → runFullUltimateLayout (hasRunInitialLayout=false) → R-tree pack + Cola + fit
 *      → hasRunInitialLayout becomes true
 *   3. Wait for layout to stabilize. Capture post-initial positions.
 *
 * Phase 2 (Incremental path — triggers separateOverlappingComponents):
 *   4. Read cluster A's bbox from Cytoscape.
 *   5. Add 3 new nodes (cluster B: b1,b2,b3) centered at cluster A's bbox center.
 *      — connected only to each other, NO edges to cluster A → separate component
 *      — 3 new / 13 total = 23% < 30% threshold → incremental path fires ✓
 *   6. onNodeAdd → runLocalCola(b1,b2,b3) → componentsOverlap check
 *      → separateOverlappingComponents nudges cluster B away
 *   7. Wait for layout to stabilize. Capture final positions.
 *
 * ASSERTIONS:
 *   a. No overlap: component A and B bboxes have gap >= 0
 *   b. Minimal movement: each cluster A node moved < 200px from post-initial position
 *   c. Centroid preservation: cluster A center of mass moved < 150px
 *   d. New cluster positioned: b-nodes not at Infinity or NaN
 *   e. Far node unmoved: far1 (isolated, not near overlap) moved < 20px
 *
 * SETUP:
 * - No vault required — nodes added directly to cy
 * - Build first: npx electron-vite build
 * - Config: playwright-electron.config.ts
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import {
  captureNodeBounds,
  computeBbox,
  bboxGap,
  waitForLayoutStable,
} from './perf-helpers/layoutTestHelpers';
import type { ExtendedWindow } from './perf-helpers/layoutTestHelpers';

const PROJECT_ROOT = path.resolve(process.cwd());

// ============================================================================
// Test-local types
// ============================================================================

interface ClusterBboxResult {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  centerY: number;
}

interface ClusterBCenter {
  cx: number;
  centerY: number;
}

// ============================================================================
// Fixtures (fresh Electron instance per test — no vault)
// ============================================================================

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(
      path.join(os.tmpdir(), 'voicetree-polyomino-sep-test-')
    );

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`, // Fresh isolated userData — no vault auto-loads
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
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
      // Ignore shutdown errors — no vault was loaded
    }

    await electronApp.close();
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15000 });

    window.on('console', (msg) => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    window.on('pageerror', (error) => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');

    // Wait for Cytoscape instance (set in VoiceTreeGraphView after enableAutoLayout)
    await window.waitForFunction(
      () => (window as unknown as ExtendedWindow).cytoscapeInstance !== undefined,
      { timeout: 15000 }
    );

    // Short pause to ensure enableAutoLayout event listeners are registered
    await window.waitForTimeout(500);

    await use(window);
  },
});

// ============================================================================
// Tests
// ============================================================================

test.describe('Incremental Separation: New Cluster Nudged Apart with Minimal Movement', () => {

  /**
   * Cluster A (9 nodes, established full layout) + far1 isolated = 10 initial.
   * Cluster B (3 new nodes) placed at cluster A's center → guaranteed bbox overlap.
   * 3 new / 13 total = 23% < 30% → incremental path fires.
   * Asserts: no overlap, < 200px per-node movement, centroid preserved, far1 unmoved.
   */
  test('overlapping new cluster separated with minimal movement to existing cluster', async ({ appWindow }) => {
    test.setTimeout(90000);

    // -----------------------------------------------------------------------
    // PHASE 1: Add initial graph → full layout (hasRunInitialLayout → true)
    // -----------------------------------------------------------------------
    console.log('=== PHASE 1: Add 10 initial nodes (9-node cluster A + far1 isolated) ===');

    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('cytoscapeInstance not available');
      cy.add([
        // Cluster A: 9 nodes in a 3×3 grid, 200px apart
        { group: 'nodes', data: { id: 'a1' }, position: { x: 0,   y: 0   } },
        { group: 'nodes', data: { id: 'a2' }, position: { x: 200, y: 0   } },
        { group: 'nodes', data: { id: 'a3' }, position: { x: 400, y: 0   } },
        { group: 'nodes', data: { id: 'a4' }, position: { x: 0,   y: 200 } },
        { group: 'nodes', data: { id: 'a5' }, position: { x: 200, y: 200 } },
        { group: 'nodes', data: { id: 'a6' }, position: { x: 400, y: 200 } },
        { group: 'nodes', data: { id: 'a7' }, position: { x: 0,   y: 400 } },
        { group: 'nodes', data: { id: 'a8' }, position: { x: 200, y: 400 } },
        { group: 'nodes', data: { id: 'a9' }, position: { x: 400, y: 400 } },
        // far1: isolated node far away — should be unaffected by incremental separation
        { group: 'nodes', data: { id: 'far1' }, position: { x: 5000, y: 5000 } },
        // Cluster A intra-edges (grid pattern: horizontal + vertical)
        { group: 'edges', data: { id: 'e-a12', source: 'a1', target: 'a2' } },
        { group: 'edges', data: { id: 'e-a23', source: 'a2', target: 'a3' } },
        { group: 'edges', data: { id: 'e-a45', source: 'a4', target: 'a5' } },
        { group: 'edges', data: { id: 'e-a56', source: 'a5', target: 'a6' } },
        { group: 'edges', data: { id: 'e-a78', source: 'a7', target: 'a8' } },
        { group: 'edges', data: { id: 'e-a89', source: 'a8', target: 'a9' } },
        { group: 'edges', data: { id: 'e-a14', source: 'a1', target: 'a4' } },
        { group: 'edges', data: { id: 'e-a47', source: 'a4', target: 'a7' } },
        { group: 'edges', data: { id: 'e-a25', source: 'a2', target: 'a5' } },
        { group: 'edges', data: { id: 'e-a58', source: 'a5', target: 'a8' } },
        { group: 'edges', data: { id: 'e-a36', source: 'a3', target: 'a6' } },
        { group: 'edges', data: { id: 'e-a69', source: 'a6', target: 'a9' } },
      ]);
      console.log('[Test] Added 10 initial nodes (9-node grid cluster A + far1 isolated)');
    });

    console.log('=== PHASE 1: Wait for full layout (R-tree pack → Cola → fit) ===');
    const preInitialBounds = await captureNodeBounds(appWindow);
    expect(preInitialBounds.length).toBe(10);
    const preInitialSnapshot = JSON.stringify(
      preInitialBounds.map((b) => [Math.round(b.x), Math.round(b.y)])
    );
    await waitForLayoutStable(
      appWindow, preInitialSnapshot,
      'Phase 1: waiting for full layout (R-tree pack → Cola → fit)',
    );

    const postInitialBounds = await captureNodeBounds(appWindow);
    expect(postInitialBounds.length).toBe(10);
    console.log('[Test] Initial layout complete. Post-initial positions:');
    for (const b of postInitialBounds) {
      console.log(`  ${b.id}: (${b.x.toFixed(0)}, ${b.y.toFixed(0)})`);
    }

    // -----------------------------------------------------------------------
    // PHASE 2: Add cluster B overlapping cluster A → incremental path
    // 3 new / 13 total = 23% < 30% → runLocalCola → separateOverlappingComponents
    // -----------------------------------------------------------------------
    console.log('=== PHASE 2: Read cluster A bbox, position cluster B at center ===');

    const clusterABbox = await appWindow.evaluate((): ClusterBboxResult => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('cytoscapeInstance not available');
      const nodeIds = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9'];
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const id of nodeIds) {
        const n = cy.getElementById(id);
        if (n.length === 0) continue;
        const x = n.position('x'), y = n.position('y');
        const hw = Math.max(n.width(), 40) / 2, hh = Math.max(n.height(), 30) / 2;
        minX = Math.min(minX, x - hw); maxX = Math.max(maxX, x + hw);
        minY = Math.min(minY, y - hh); maxY = Math.max(maxY, y + hh);
      }
      return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
    });

    console.log(
      `[Test] Cluster A bbox: [${clusterABbox.minX.toFixed(0)}, ${clusterABbox.minY.toFixed(0)},` +
      ` ${clusterABbox.maxX.toFixed(0)}, ${clusterABbox.maxY.toFixed(0)}]` +
      ` center=(${clusterABbox.cx.toFixed(0)}, ${clusterABbox.centerY.toFixed(0)})`
    );

    // Cluster B centered at cluster A's bbox center — overlap is guaranteed regardless of
    // node sizes. No edges to cluster A → disconnected component → componentsOverlap fires.
    await appWindow.evaluate(
      ({ cx, centerY }: ClusterBCenter) => {
        const cyInstance = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cyInstance) throw new Error('cytoscapeInstance not available');
        cyInstance.add([
          { group: 'nodes', data: { id: 'b1' }, position: { x: cx - 75,  y: centerY       } },
          { group: 'nodes', data: { id: 'b2' }, position: { x: cx + 75,  y: centerY       } },
          { group: 'nodes', data: { id: 'b3' }, position: { x: cx,       y: centerY + 120 } },
          // Intra-cluster edges only — no edges to cluster A → separate component
          { group: 'edges', data: { id: 'e-b12', source: 'b1', target: 'b2' } },
          { group: 'edges', data: { id: 'e-b23', source: 'b2', target: 'b3' } },
        ]);
        console.log('[Test] Added cluster B (b1,b2,b3) at cluster A center — bbox overlap guaranteed');
      },
      { cx: clusterABbox.cx, centerY: clusterABbox.centerY },
    );

    // Snapshot right after add, before the 300ms debounce fires
    const preSepBounds = await captureNodeBounds(appWindow);
    expect(preSepBounds.length).toBe(13);
    const preSepSnapshot = JSON.stringify(
      preSepBounds.map((b) => [Math.round(b.x), Math.round(b.y)])
    );

    console.log('[Test] Pre-separation snapshot captured. Waiting for incremental layout...');
    await waitForLayoutStable(
      appWindow, preSepSnapshot,
      'Phase 2: waiting for incremental layout (local Cola → separateOverlappingComponents)',
    );

    console.log('=== Capture and log post-separation positions ===');
    const finalBounds = await captureNodeBounds(appWindow);
    expect(finalBounds.length).toBe(13);
    for (const b of finalBounds) {
      console.log(`  ${b.id}: (${b.x.toFixed(0)}, ${b.y.toFixed(0)})`);
    }

    const clusterAFinal = finalBounds.filter((n) => n.id.startsWith('a'));
    const clusterBFinal = finalBounds.filter((n) => n.id.startsWith('b'));
    const farFinal      = finalBounds.find((n) => n.id === 'far1');
    expect(clusterAFinal.length).toBe(9);
    expect(clusterBFinal.length).toBe(3);
    expect(farFinal).toBeDefined();

    // -----------------------------------------------------------------------
    // ASSERTION a: No overlap — component bboxes separated (gap >= 0)
    // -----------------------------------------------------------------------
    const bboxA = computeBbox(clusterAFinal);
    const bboxB = computeBbox(clusterBFinal);
    console.log(`Cluster A bbox: [${bboxA.minX.toFixed(0)}, ${bboxA.minY.toFixed(0)}, ${bboxA.maxX.toFixed(0)}, ${bboxA.maxY.toFixed(0)}]`);
    console.log(`Cluster B bbox: [${bboxB.minX.toFixed(0)}, ${bboxB.minY.toFixed(0)}, ${bboxB.maxX.toFixed(0)}, ${bboxB.maxY.toFixed(0)}]`);
    const finalGap = bboxGap(bboxA, bboxB);
    console.log(`Gap between clusters: ${finalGap.toFixed(0)}px (expect >= 0)`);
    expect(finalGap).toBeGreaterThanOrEqual(0);
    console.log('✓ No overlap between cluster A and cluster B bboxes');

    // -----------------------------------------------------------------------
    // ASSERTION b: Minimal movement — each cluster A node moved < 200px
    // -----------------------------------------------------------------------
    const postInitialABounds = postInitialBounds.filter((n) => n.id.startsWith('a'));
    for (const preBound of postInitialABounds) {
      const postBound = clusterAFinal.find((n) => n.id === preBound.id);
      expect(postBound).toBeDefined();
      if (!postBound) continue;
      const dist = Math.sqrt(
        Math.pow(postBound.x - preBound.x, 2) + Math.pow(postBound.y - preBound.y, 2)
      );
      console.log(`  ${preBound.id}: moved ${dist.toFixed(0)}px`);
      expect(dist, `${preBound.id} should move < 200px (incremental, not full rebuild)`).toBeLessThan(200);
    }
    console.log('✓ All cluster A nodes moved < 200px');

    // -----------------------------------------------------------------------
    // ASSERTION c: Centroid preservation — cluster A center moved < 150px
    // -----------------------------------------------------------------------
    const preCentroid = {
      x: postInitialABounds.reduce((s, n) => s + n.x, 0) / postInitialABounds.length,
      y: postInitialABounds.reduce((s, n) => s + n.y, 0) / postInitialABounds.length,
    };
    const postCentroid = {
      x: clusterAFinal.reduce((s, n) => s + n.x, 0) / clusterAFinal.length,
      y: clusterAFinal.reduce((s, n) => s + n.y, 0) / clusterAFinal.length,
    };
    const centroidDist = Math.sqrt(
      Math.pow(postCentroid.x - preCentroid.x, 2) + Math.pow(postCentroid.y - preCentroid.y, 2)
    );
    console.log(`Cluster A centroid shift: ${centroidDist.toFixed(0)}px`);
    expect(centroidDist, 'Cluster A centroid should move < 150px').toBeLessThan(150);
    console.log('✓ Cluster A centroid preserved within 150px');

    // -----------------------------------------------------------------------
    // ASSERTION d: New cluster positioned — b-nodes not at Infinity or NaN
    // -----------------------------------------------------------------------
    for (const b of clusterBFinal) {
      console.log(`  ${b.id}: (${b.x.toFixed(0)}, ${b.y.toFixed(0)})`);
      expect(isFinite(b.x), `${b.id}.x should be finite`).toBe(true);
      expect(isFinite(b.y), `${b.id}.y should be finite`).toBe(true);
      expect(isNaN(b.x), `${b.id}.x should not be NaN`).toBe(false);
      expect(isNaN(b.y), `${b.id}.y should not be NaN`).toBe(false);
    }
    console.log('✓ All cluster B nodes have finite positions');

    // -----------------------------------------------------------------------
    // ASSERTION e: Far isolated node unaffected — far1 moved < 20px
    // (non-overlapping component must stay put after separation)
    // -----------------------------------------------------------------------
    const postInitialFar = postInitialBounds.find((n) => n.id === 'far1');
    expect(postInitialFar).toBeDefined();
    if (postInitialFar && farFinal) {
      const farDist = Math.sqrt(
        Math.pow(farFinal.x - postInitialFar.x, 2) + Math.pow(farFinal.y - postInitialFar.y, 2)
      );
      console.log(`far1: moved ${farDist.toFixed(0)}px (expect < 20px)`);
      expect(farDist, 'far1 should not move — non-overlapping component stays put').toBeLessThan(20);
      console.log('✓ Far isolated node unaffected by incremental separation');
    }

    console.log('');
    console.log('=== SUMMARY ===');
    console.log(`  Final gap (A vs B): ${finalGap.toFixed(0)}px (was overlapping)`);
    console.log(`  Cluster A centroid shift: ${centroidDist.toFixed(0)}px`);
    console.log('✅ INCREMENTAL SEPARATION E2E TEST PASSED');
  });
});

export { test };
