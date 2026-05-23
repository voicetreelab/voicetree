/**
 * E2E TEST: R-tree Packing — Two Clusters 50,000px Apart
 *
 * BEHAVIORAL SPEC:
 * After integrating packComponents() into autoLayout.ts (Phase 2), when a graph
 * has two disconnected node clusters and runFullUltimateLayout() fires, the R-tree
 * packing step should pack components to within 500px
 * of each other, even if they started 50,000px apart.
 *
 * TEST FLOW:
 * 1. Launch Electron with fresh temp userData (no vault auto-loaded)
 * 2. Add two disconnected 3-node clusters directly via cy.add():
 *    - Cluster A: nodes at x=0..200, y=0..150 (near origin)
 *    - Cluster B: nodes at x=50000..50200, y=0..150 (50,000px away)
 * 3. onNodeAdd fires → debouncedRunLayout → runFullUltimateLayout (hasRunInitialLayout=false)
 * 4. R-tree packComponents() detects 2 disconnected components → packs them together
 * 5. Cola refines → cy.fit() frames the result
 * 7. Assert: gap < 500px, no node overlap, aspect ratio 0.3–3.0
 *
 * EDGE CASES:
 * - Single-node components (no intra-cluster edges)
 * - Very large vs very small components mixed
 *
 * SETUP:
 * - No vault required — nodes added directly to cy
 * - enableAutoLayout() is registered at app startup, so cy.add() triggers layout
 * - Build first: npx electron-vite build
 * - Config: playwright-electron.config.ts
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';

const PROJECT_ROOT = path.resolve(process.cwd());

// Type definitions
interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
}

interface NodeBounds {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ComponentBbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// Extend test with Electron app fixtures (fresh instance per test)
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-rbush-packing-test-'));

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}` // Fresh isolated userData — no vault auto-loads
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1'
      },
      timeout: 15000
    });

    await use(electronApp);

    // Graceful shutdown
    try {
      const window = await electronApp.firstWindow();
      await window.evaluate(async () => {
        const api = (window as unknown as { electronAPI?: { main?: { stopFileWatching?: () => Promise<void> } } }).electronAPI;
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

    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    window.on('pageerror', error => {
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
  }
});

// ============================================================================
// Helpers
// ============================================================================

/** Capture bounds of all non-context nodes in the graph. */
async function captureNodeBounds(appWindow: Page): Promise<NodeBounds[]> {
  return appWindow.evaluate((): NodeBounds[] => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) return [];
    // Use forEach on NodeCollection so TypeScript types `n` as NodeSingular (has .position())
    // filter().map() returns CollectionReturnValue whose map types n as SingularElementArgument
    // (EdgeSingular | NodeSingular), which lacks .position() — hence forEach pattern here.
    const result: NodeBounds[] = [];
    cy.nodes().forEach((n) => {
      if (n.data('isContextNode')) return;
      result.push({
        id: n.id(),
        x: n.position('x'),
        y: n.position('y'),
        // Use minimum 40px dimensions for headless Electron (CSS may not load node styles)
        w: Math.max(n.width(), 40),
        h: Math.max(n.height(), 30),
      });
    });
    return result;
  });
}

/** Compute the axis-aligned bounding box of a set of node bounds. */
function computeBbox(nodes: NodeBounds[]): ComponentBbox {
  return nodes.reduce(
    (bbox, n) => ({
      minX: Math.min(bbox.minX, n.x - n.w / 2),
      minY: Math.min(bbox.minY, n.y - n.h / 2),
      maxX: Math.max(bbox.maxX, n.x + n.w / 2),
      maxY: Math.max(bbox.maxY, n.y + n.h / 2),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );
}

/**
 * Signed gap between two axis-aligned bboxes.
 * Negative = overlap. Zero = touching. Positive = separated.
 */
function bboxGap(a: ComponentBbox, b: ComponentBbox): number {
  const xOverlap = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const yOverlap = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);

  // Fully overlapping in both axes → gap is the largest overlap axis (most negative)
  if (xOverlap >= 0 && yOverlap >= 0) return -Math.min(xOverlap, yOverlap);
  // Separated along one axis → gap is in that axis
  if (xOverlap < 0 && yOverlap < 0) return Math.sqrt(xOverlap * xOverlap + yOverlap * yOverlap);
  if (xOverlap < 0) return -xOverlap;
  return -yOverlap;
}

/**
 * Wait for layout to stabilize: positions must have changed from `initialSnapshot`
 * AND must stop changing for two consecutive polls.
 *
 * The R-tree pack + Cola + fit chain takes 3–6 seconds; we poll aggressively.
 */
async function waitForLayoutStable(appWindow: Page, initialSnapshot: string): Promise<void> {
  let lastSnapshot = '';

  await expect.poll(async () => {
    const bounds = await captureNodeBounds(appWindow);
    const snap = JSON.stringify(bounds.map((b) => [Math.round(b.x), Math.round(b.y)]));
    const changedFromInitial = snap !== initialSnapshot;
    const stoppedMoving = snap === lastSnapshot && lastSnapshot !== '';
    lastSnapshot = snap;
    return changedFromInitial && stoppedMoving;
  }, {
    message: 'Waiting for layout to run and stabilize (R-tree pack → Cola → fit)',
    timeout: 20000, // R-tree pack + Cola + fit = ~5-8s total
    intervals: [500, 500, 500, 1000, 1000, 1000, 1000, 1000],
  }).toBe(true);
}

// ============================================================================
// Tests
// ============================================================================

test.describe('R-tree Packing: Disconnected Components Get Packed Together', () => {

  /**
   * Main scenario: two 3-node clusters positioned 50,000px apart.
   * Verifies that after the full layout chain, clusters are packed within 500px.
   */
  test('two 3-node clusters 50,000px apart are packed to within 500px', async ({ appWindow }) => {
    test.setTimeout(90000); // R-tree pack + Cola + fit + polling buffer

    console.log('=== STEP 1: Add two disconnected 3-node clusters via cy.add() ===');
    // Cluster A: nodes near origin, connected to each other
    // Cluster B: nodes 50,000px to the right, connected to each other
    // No edges between A and B → two disconnected components
    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('cytoscapeInstance not available');

      cy.add([
        // Cluster A — 3 nodes in a triangle near origin
        { group: 'nodes', data: { id: 'a1' }, position: { x: 0, y: 0 } },
        { group: 'nodes', data: { id: 'a2' }, position: { x: 200, y: 0 } },
        { group: 'nodes', data: { id: 'a3' }, position: { x: 100, y: 150 } },
        // Cluster B — 3 nodes in a triangle 50,000px to the right
        { group: 'nodes', data: { id: 'b1' }, position: { x: 50000, y: 0 } },
        { group: 'nodes', data: { id: 'b2' }, position: { x: 50200, y: 0 } },
        { group: 'nodes', data: { id: 'b3' }, position: { x: 50100, y: 150 } },
        // Intra-cluster edges only (no inter-cluster edges → 2 components)
        { group: 'edges', data: { id: 'e-a12', source: 'a1', target: 'a2' } },
        { group: 'edges', data: { id: 'e-a23', source: 'a2', target: 'a3' } },
        { group: 'edges', data: { id: 'e-b12', source: 'b1', target: 'b2' } },
        { group: 'edges', data: { id: 'e-b23', source: 'b2', target: 'b3' } },
      ]);
      console.log('[Test] Added 6 nodes and 4 intra-cluster edges');
    });

    console.log('=== STEP 2: Capture initial positions (verify clusters are far apart) ===');
    const initialBounds = await captureNodeBounds(appWindow);
    expect(initialBounds.length).toBe(6);

    const clusterAInit = initialBounds.filter((n) => n.id.startsWith('a'));
    const clusterBInit = initialBounds.filter((n) => n.id.startsWith('b'));
    const initialGap = bboxGap(computeBbox(clusterAInit), computeBbox(clusterBInit));
    console.log(`Initial gap between clusters: ${initialGap.toFixed(0)}px (expect >10,000px)`);
    expect(initialGap).toBeGreaterThan(10000); // Sanity check: they really are far apart

    // Snapshot for layout-stable detection
    const initialSnapshot = JSON.stringify(initialBounds.map((b) => [Math.round(b.x), Math.round(b.y)]));

    console.log('=== STEP 3: Wait for runFullUltimateLayout to complete ===');
    // Triggered by cy.add() → onNodeAdd → debouncedRunLayout → runFullUltimateLayout
    // (hasRunInitialLayout=false on fresh app, so the first runLayout() uses the full chain)
    await waitForLayoutStable(appWindow, initialSnapshot);

    console.log('=== STEP 4: Capture and log post-layout positions ===');
    const finalBounds = await captureNodeBounds(appWindow);
    expect(finalBounds.length).toBe(6);

    for (const b of finalBounds) {
      console.log(`  ${b.id}: (${b.x.toFixed(0)}, ${b.y.toFixed(0)}) size=${b.w.toFixed(0)}×${b.h.toFixed(0)}`);
    }

    const clusterAFinal = finalBounds.filter((n) => n.id.startsWith('a'));
    const clusterBFinal = finalBounds.filter((n) => n.id.startsWith('b'));
    const bboxA = computeBbox(clusterAFinal);
    const bboxB = computeBbox(clusterBFinal);

    console.log(`Cluster A bbox: [${bboxA.minX.toFixed(0)},${bboxA.minY.toFixed(0)},${bboxA.maxX.toFixed(0)},${bboxA.maxY.toFixed(0)}]`);
    console.log(`Cluster B bbox: [${bboxB.minX.toFixed(0)},${bboxB.minY.toFixed(0)},${bboxB.maxX.toFixed(0)},${bboxB.maxY.toFixed(0)}]`);

    console.log('=== STEP 5: Assert clusters are packed to within 500px ===');
    const finalGap = bboxGap(bboxA, bboxB);
    console.log(`Final gap between component bboxes: ${finalGap.toFixed(0)}px`);
    expect(finalGap).toBeLessThan(500);
    console.log('✓ Clusters packed within 500px');

    console.log('=== STEP 6: Assert no node overlap (allow 5px tolerance) ===');
    for (let i = 0; i < finalBounds.length; i++) {
      for (let j = i + 1; j < finalBounds.length; j++) {
        const na = finalBounds[i];
        const nb = finalBounds[j];
        const nodeGap = bboxGap(
          { minX: na.x - na.w / 2, minY: na.y - na.h / 2, maxX: na.x + na.w / 2, maxY: na.y + na.h / 2 },
          { minX: nb.x - nb.w / 2, minY: nb.y - nb.h / 2, maxX: nb.x + nb.w / 2, maxY: nb.y + nb.h / 2 }
        );
        if (nodeGap < -5) {
          console.warn(`  OVERLAP: ${na.id} ↔ ${nb.id}, overlap=${Math.abs(nodeGap).toFixed(1)}px`);
        }
        expect(nodeGap).toBeGreaterThanOrEqual(-5); // 5px tolerance for rendering imprecision
      }
    }
    console.log('✓ No node overlap');

    console.log('=== STEP 7: Assert reasonable aspect ratio (0.3–3.0) ===');
    const globalBbox = computeBbox(finalBounds);
    const totalW = globalBbox.maxX - globalBbox.minX;
    const totalH = globalBbox.maxY - globalBbox.minY;
    const aspectRatio = totalW > 0 && totalH > 0
      ? Math.max(totalW, totalH) / Math.min(totalW, totalH)
      : 1;
    console.log(`Overall layout: ${totalW.toFixed(0)}w × ${totalH.toFixed(0)}h, aspect ratio: ${aspectRatio.toFixed(2)}`);
    expect(aspectRatio).toBeGreaterThanOrEqual(0.3);
    expect(aspectRatio).toBeLessThanOrEqual(3.0);
    console.log(`✓ Aspect ratio ${aspectRatio.toFixed(2)} within [0.3, 3.0]`);

    console.log('');
    console.log('=== SUMMARY ===');
    console.log(`  Initial gap: ${initialGap.toFixed(0)}px → Final gap: ${finalGap.toFixed(0)}px`);
    console.log(`  Layout: ${totalW.toFixed(0)}×${totalH.toFixed(0)}, aspect ratio: ${aspectRatio.toFixed(2)}`);
    console.log('');
    console.log('✅ R-TREE PACKING E2E TEST PASSED');
  });

  /**
   * Edge case: two isolated single-node components (no intra-cluster edges).
   * packComponents should handle zero-edge components gracefully.
   */
  test('single-node components 50,000px apart are packed to within 500px', async ({ appWindow }) => {
    test.setTimeout(90000);

    console.log('=== TEST: Single-node components pack correctly ===');

    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('cytoscapeInstance not available');

      cy.add([
        // Two isolated single-node components — no edges (no intra-cluster structure)
        { group: 'nodes', data: { id: 'solo1' }, position: { x: 0, y: 0 } },
        { group: 'nodes', data: { id: 'solo2' }, position: { x: 50000, y: 0 } },
      ]);
      console.log('[Test] Added 2 isolated single-node components');
    });

    const initialBounds = await captureNodeBounds(appWindow);
    expect(initialBounds.length).toBe(2);

    const initialGap = bboxGap(
      computeBbox(initialBounds.filter((n) => n.id === 'solo1')),
      computeBbox(initialBounds.filter((n) => n.id === 'solo2'))
    );
    console.log(`Initial gap: ${initialGap.toFixed(0)}px`);
    expect(initialGap).toBeGreaterThan(10000);

    const initialSnapshot = JSON.stringify(initialBounds.map((b) => [Math.round(b.x), Math.round(b.y)]));
    await waitForLayoutStable(appWindow, initialSnapshot);

    const finalBounds = await captureNodeBounds(appWindow);
    expect(finalBounds.length).toBe(2);

    const finalGap = bboxGap(
      computeBbox(finalBounds.filter((n) => n.id === 'solo1')),
      computeBbox(finalBounds.filter((n) => n.id === 'solo2'))
    );
    console.log(`Final gap: ${finalGap.toFixed(0)}px`);
    expect(finalGap).toBeLessThan(500);

    console.log('✅ Single-node component packing test PASSED');
  });

  /**
   * Edge case: a large 5-node cluster vs a small single-node cluster.
   * packComponents sorts by area descending (largest first), so the big cluster
   * is placed at origin and the small one is placed nearby.
   */
  test('large (5-node) and small (1-node) clusters 50,000px apart are packed to within 500px', async ({ appWindow }) => {
    test.setTimeout(90000);

    console.log('=== TEST: Large vs small component mixed sizes ===');

    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('cytoscapeInstance not available');

      cy.add([
        // Large cluster: 5 nodes spanning 400×200px
        { group: 'nodes', data: { id: 'big1' }, position: { x: 0, y: 0 } },
        { group: 'nodes', data: { id: 'big2' }, position: { x: 200, y: 0 } },
        { group: 'nodes', data: { id: 'big3' }, position: { x: 400, y: 0 } },
        { group: 'nodes', data: { id: 'big4' }, position: { x: 100, y: 200 } },
        { group: 'nodes', data: { id: 'big5' }, position: { x: 300, y: 200 } },
        // Small cluster: 1 isolated node 50,000px away
        { group: 'nodes', data: { id: 'small1' }, position: { x: 50000, y: 0 } },
        // Intra-cluster edges for large cluster
        { group: 'edges', data: { id: 'e-b12', source: 'big1', target: 'big2' } },
        { group: 'edges', data: { id: 'e-b23', source: 'big2', target: 'big3' } },
        { group: 'edges', data: { id: 'e-b14', source: 'big1', target: 'big4' } },
        { group: 'edges', data: { id: 'e-b45', source: 'big4', target: 'big5' } },
      ]);
      console.log('[Test] Added large cluster (5 nodes, 4 edges) + small cluster (1 isolated node)');
    });

    const initialBounds = await captureNodeBounds(appWindow);
    expect(initialBounds.length).toBe(6);

    const initialGap = bboxGap(
      computeBbox(initialBounds.filter((n) => n.id.startsWith('big'))),
      computeBbox(initialBounds.filter((n) => n.id.startsWith('small')))
    );
    console.log(`Initial gap: ${initialGap.toFixed(0)}px`);
    expect(initialGap).toBeGreaterThan(10000);

    const initialSnapshot = JSON.stringify(initialBounds.map((b) => [Math.round(b.x), Math.round(b.y)]));
    await waitForLayoutStable(appWindow, initialSnapshot);

    const finalBounds = await captureNodeBounds(appWindow);
    expect(finalBounds.length).toBe(6);

    const bigFinal = finalBounds.filter((n) => n.id.startsWith('big'));
    const smallFinal = finalBounds.filter((n) => n.id.startsWith('small'));
    const finalGap = bboxGap(computeBbox(bigFinal), computeBbox(smallFinal));
    console.log(`Final gap (large vs small cluster): ${finalGap.toFixed(0)}px`);
    expect(finalGap).toBeLessThan(500);

    for (const b of finalBounds) {
      console.log(`  ${b.id}: (${b.x.toFixed(0)}, ${b.y.toFixed(0)})`);
    }

    console.log('✅ Large vs small component packing test PASSED');
  });
});

export { test };
