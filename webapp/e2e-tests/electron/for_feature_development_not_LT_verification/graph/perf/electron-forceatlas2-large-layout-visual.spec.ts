import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Core as CytoscapeCore, NodeSingular } from 'cytoscape';

import {
  collectLoadDiagnostics,
  REALISTIC_PERF_NODE_COUNT,
  test,
  type ExtendedWindow,
} from './electron-500-node-realistic-perf/fixtures';

type LayoutSettings = {
  readonly layoutConfig?: string;
};

type LayoutSettingsWindow = ExtendedWindow & {
  readonly electronAPI?: {
    readonly main?: ExtendedWindow['electronAPI']['main'] & {
      readonly loadSettings?: () => Promise<LayoutSettings>;
      readonly stopFileWatching?: () => Promise<void>;
    };
  };
};

type LayoutVisualSummary = {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly finitePositionCount: number;
  readonly uniqueRoundedPositionCount: number;
  readonly bounds: {
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
    readonly width: number;
    readonly height: number;
  };
  readonly visibleRenderedNodeCount: number;
};

const SETTINGS_SAVE_TIMEOUT_MS = 5000;

type GraphSampleSnapshot = { readonly nodeCount: number; readonly positions: string };

function sampleGraph(appWindow: Page): Promise<GraphSampleSnapshot> {
  return appWindow.evaluate((): GraphSampleSnapshot => {
    const cy: CytoscapeCore | undefined = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) return { nodeCount: 0, positions: '' };
    const leaves: NodeSingular[] = cy
      .nodes()
      .filter((node: NodeSingular) => !node.data('isContextNode') && !node.isParent())
      .toArray();
    const positions: string = leaves
      .map((node: NodeSingular) => `${node.id()}:${Math.round(node.position('x'))},${Math.round(node.position('y'))}`)
      .sort()
      .join('|');
    return { nodeCount: leaves.length, positions };
  });
}

// The realistic project streams in via the daemon, so the graph keeps growing
// and re-laying-out for a while; a naive "two equal snapshots" check can fire
// during a streaming lull (mid-load) and sample a half-laid-out graph. This
// waits until the node count has held steady AND leaf positions are unchanged
// across several consecutive samples — a genuinely settled layout. When
// `mustDifferFrom` is given (e.g. the pre-"Tidy" snapshot), stability is only
// counted once positions have actually changed from it, so we never mistake the
// not-yet-started state for a settled re-layout. Returns the settled positions.
async function waitForGraphFullySettled(
  appWindow: Page,
  timeoutMs: number,
  mustDifferFrom?: string,
): Promise<string> {
  const deadline: number = Date.now() + timeoutMs;
  const intervalMs = 2500;
  const requiredStableSamples = 4;
  const minNodeCount: number = Math.min(REALISTIC_PERF_NODE_COUNT, 500);
  let lastCount = -1;
  let lastCountChangeAt: number = Date.now();
  let lastPositions = '';
  let stableSamples = 0;
  let diverged: boolean = mustDifferFrom === undefined;
  while (Date.now() < deadline) {
    const snapshot: GraphSampleSnapshot = await sampleGraph(appWindow);
    if (!diverged && snapshot.positions !== '' && snapshot.positions !== mustDifferFrom) diverged = true;
    if (snapshot.nodeCount !== lastCount) {
      lastCount = snapshot.nodeCount;
      lastCountChangeAt = Date.now();
      stableSamples = 0;
    } else if (snapshot.positions !== '' && snapshot.positions === lastPositions && diverged) {
      stableSamples += 1;
    } else {
      stableSamples = 0;
    }
    lastPositions = snapshot.positions;
    const countSettled: boolean = snapshot.nodeCount >= minNodeCount && Date.now() - lastCountChangeAt > 5000;
    if (countSettled && stableSamples >= requiredStableSamples) return lastPositions;
    await appWindow.waitForTimeout(intervalMs);
  }
  throw new Error(`Graph did not settle within ${timeoutMs}ms (lastCount=${lastCount}, stableSamples=${stableSamples}, diverged=${diverged})`);
}

async function waitForGraphNodes(appWindow: Page): Promise<void> {
  await expect
    .poll(
      async () => appWindow.evaluate((): number => {
        const cy: CytoscapeCore | undefined = (window as unknown as ExtendedWindow).cytoscapeInstance;
        return cy?.nodes().length ?? 0;
      }),
      {
        message: 'Waiting for realistic project graph nodes to reach Cytoscape',
        timeout: 180000,
        intervals: [2000, 3000, 5000, 5000, 5000],
      }
    )
    .toBeGreaterThanOrEqual(Math.min(REALISTIC_PERF_NODE_COUNT, 500));
}

async function currentLayoutConfig(appWindow: Page): Promise<Record<string, unknown> | null> {
  return appWindow.evaluate(async (): Promise<Record<string, unknown> | null> => {
    const settings: LayoutSettings | undefined = await (window as unknown as LayoutSettingsWindow)
      .electronAPI
      ?.main
      ?.loadSettings
      ?.();
    if (!settings?.layoutConfig) return null;
    const parsed: unknown = JSON.parse(settings.layoutConfig);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  });
}

async function currentLayoutEngine(appWindow: Page): Promise<string | null> {
  const parsed: Record<string, unknown> | null = await currentLayoutConfig(appWindow);
  const engine: unknown = parsed?.engine;
  return typeof engine === 'string' ? engine : null;
}

async function currentLayoutNodeSpacing(appWindow: Page): Promise<number | null> {
  const parsed: Record<string, unknown> | null = await currentLayoutConfig(appWindow);
  const nodeSpacing: unknown = parsed?.nodeSpacing;
  return typeof nodeSpacing === 'number' ? nodeSpacing : null;
}

async function expectSavedLayoutNodeSpacing(appWindow: Page, nodeSpacing: number): Promise<void> {
  await expect
    .poll(
      () => currentLayoutNodeSpacing(appWindow),
      {
        message: `Waiting for settings auto-save to persist nodeSpacing ${nodeSpacing}`,
        timeout: SETTINGS_SAVE_TIMEOUT_MS,
        intervals: [100, 200, 300, 500],
      }
    )
    .toBe(nodeSpacing);
}

async function expectSavedLayoutEngine(appWindow: Page, engine: string): Promise<void> {
  await expect
    .poll(
      () => currentLayoutEngine(appWindow),
      {
        message: `Waiting for settings auto-save to persist layout engine ${engine}`,
        timeout: SETTINGS_SAVE_TIMEOUT_MS,
        intervals: [100, 200, 300, 500],
      }
    )
    .toBe(engine);
}

type OverlapSummary = {
  readonly leafNodeCount: number;
  readonly overlapCount: number;
  readonly worstOverlapArea: number;
  readonly samples: readonly string[];
};

// Counts pairs of LEAF nodes whose true label-inclusive bounding boxes overlap
// by more than `epsilon` on BOTH axes. Compound parent nodes are excluded: in
// Cytoscape a parent's box encloses its children by design (containment, not a
// layout overlap), and the ForceAtlas2 finisher only positions leaf nodes.
// Label-inclusive boxes match exactly what the finisher separates, so this is
// the faithful check of the no-overlap goal — not a relaxed circular proxy.
async function summarizeOverlaps(appWindow: Page, epsilon: number): Promise<OverlapSummary> {
  return appWindow.evaluate((tolerance: number): OverlapSummary => {
    const cy: CytoscapeCore | undefined = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('cytoscapeInstance is unavailable');
    const nodes: NodeSingular[] = cy
      .nodes()
      .filter((node: NodeSingular) => !node.data('isContextNode') && !node.isParent())
      .toArray();
    const boxes = nodes.map((node: NodeSingular) => ({
      id: node.id(),
      box: node.boundingBox({ includeLabels: true, includeOverlays: false, includeEdges: false }),
    }));
    const samples: string[] = [];
    let overlapCount = 0;
    let worstOverlapArea = 0;
    for (let left = 0; left < boxes.length; left += 1) {
      for (let right = left + 1; right < boxes.length; right += 1) {
        const a = boxes[left].box;
        const b = boxes[right].box;
        const overlapX = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
        const overlapY = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
        if (overlapX > tolerance && overlapY > tolerance) {
          overlapCount += 1;
          const area = overlapX * overlapY;
          worstOverlapArea = Math.max(worstOverlapArea, area);
          if (samples.length < 10) {
            samples.push(`${boxes[left].id} vs ${boxes[right].id}: ${overlapX.toFixed(0)}x${overlapY.toFixed(0)}px`);
          }
        }
      }
    }
    return { leafNodeCount: nodes.length, overlapCount, worstOverlapArea, samples };
  }, epsilon);
}

async function summarizeVisualLayout(appWindow: Page): Promise<LayoutVisualSummary> {
  return appWindow.evaluate((): LayoutVisualSummary => {
    const cy: CytoscapeCore | undefined = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('cytoscapeInstance is unavailable');

    cy.fit(cy.nodes(), 80);

    const nodes: NodeSingular[] = cy
      .nodes()
      .filter((node: NodeSingular) => !node.data('isContextNode'))
      .toArray();
    const finitePositions: Array<{ readonly x: number; readonly y: number }> = nodes
      .map((node: NodeSingular) => node.position())
      .filter((position: { readonly x: number; readonly y: number }) => (
        Number.isFinite(position.x) && Number.isFinite(position.y)
      ));
    const xs: number[] = finitePositions.map((position) => position.x);
    const ys: number[] = finitePositions.map((position) => position.y);
    const minX: number = Math.min(...xs);
    const maxX: number = Math.max(...xs);
    const minY: number = Math.min(...ys);
    const maxY: number = Math.max(...ys);
    const uniqueRoundedPositionCount: number = new Set(
      finitePositions.map((position) => `${Math.round(position.x)},${Math.round(position.y)}`)
    ).size;
    const visibleRenderedNodeCount: number = nodes.filter((node: NodeSingular) => {
      const rendered = node.renderedPosition();
      return rendered.x >= 0
        && rendered.y >= 0
        && rendered.x <= window.innerWidth
        && rendered.y <= window.innerHeight;
    }).length;

    return {
      nodeCount: nodes.length,
      edgeCount: cy.edges().length,
      finitePositionCount: finitePositions.length,
      uniqueRoundedPositionCount,
      bounds: {
        minX,
        maxX,
        minY,
        maxY,
        width: maxX - minX,
        height: maxY - minY,
      },
      visibleRenderedNodeCount,
    };
  });
}

async function openAdvancedSettings(appWindow: Page): Promise<void> {
  await appWindow.getByRole('button', { name: 'Settings' }).click();
  await appWindow.getByRole('button', { name: 'Advanced' }).click();
  await expect(appWindow.getByText('Layout Config')).toBeVisible();
}

async function closeSettingsAndStopWatching(appWindow: Page): Promise<void> {
  await appWindow.locator('#window-settings-editor .traffic-light-close').click();
  await appWindow.evaluate(async (): Promise<void> => {
    await (window as unknown as LayoutSettingsWindow).electronAPI?.main?.stopFileWatching?.();
  });
}

test.describe('ForceAtlas2 large graph visual layout', () => {
  test('lays out a large realistic graph and exposes all layout settings controls', async ({ appWindow }, testInfo) => {
    test.setTimeout(900000);

    let layoutSettleMs = 0;
    try {
      await waitForGraphNodes(appWindow);
      // Initial hydration applies graph-model/fallback positions WITHOUT running
      // a layout backend (autoLayout: `!hasRunInitialLayout` → no engine). Wait
      // for that to settle, then explicitly trigger the configured ForceAtlas2
      // engine via the "Tidy layout" control (→ runFullUltimateLayout → FA2 +
      // rectangular finisher) and time how long THAT takes to settle.
      const hydratedPositions: string = await waitForGraphFullySettled(appWindow, 180000);

      expect(await currentLayoutEngine(appWindow)).toBe('forceatlas2');

      await appWindow.getByRole('button', { name: 'Tidy layout' }).click();
      const settleStart = Date.now();
      await waitForGraphFullySettled(appWindow, 180000, hydratedPositions);
      layoutSettleMs = Date.now() - settleStart;
    } catch (error) {
      console.error('[ForceAtlas2 Visual] load diagnostics:', JSON.stringify(await collectLoadDiagnostics(appWindow), null, 2));
      throw error;
    }

    const summary: LayoutVisualSummary = await summarizeVisualLayout(appWindow);
    console.log('[ForceAtlas2 Visual] layout summary:', JSON.stringify(summary, null, 2));

    const screenshotPath: string = testInfo.outputPath('forceatlas2-large-layout.png');
    await appWindow.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`[ForceAtlas2 Visual] screenshot: ${screenshotPath}`);

    expect(summary.nodeCount).toBeGreaterThanOrEqual(Math.min(REALISTIC_PERF_NODE_COUNT, 500));
    expect(summary.edgeCount).toBeGreaterThan(0);
    expect(summary.finitePositionCount).toBe(summary.nodeCount);
    expect(summary.uniqueRoundedPositionCount).toBeGreaterThan(summary.nodeCount * 0.4);
    expect(summary.bounds.width).toBeGreaterThan(1000);
    expect(summary.bounds.height).toBeGreaterThan(1000);
    expect(summary.visibleRenderedNodeCount).toBeGreaterThan(summary.nodeCount * 0.8);

    // ── THE GOAL: the settled ForceAtlas2 layout has NO overlapping cards ──
    // The rectangular VPSC finisher resolves FA2's point-mass overlaps to
    // convergence, so zero leaf-node bounding boxes intersect (1px tolerates
    // only sub-pixel render noise). Before this fix the same fixture left
    // hundreds of overlapping cards (see runLayoutAdapter.scaling.test.ts:
    // n=500 → 203 overlaps before, 0 after).
    const overlaps: OverlapSummary = await summarizeOverlaps(appWindow, 1);
    console.log('[ForceAtlas2 Visual] overlap summary:', JSON.stringify(overlaps, null, 2));
    expect(
      overlaps.overlapCount,
      `expected zero overlapping leaf bounding boxes, found ${overlaps.overlapCount}; samples: ${overlaps.samples.join('; ')}`,
    ).toBe(0);

    // ── Performance budget: layout must settle quickly on the large graph ──
    // ForceAtlas2 keeps barnesHut:true / preventOverlap:false, so global
    // placement stays O(n log n); the finisher is sub-quadratic VPSC (proven by
    // the doubling test in runLayoutAdapter.scaling.test.ts). A 60s settle
    // ceiling on the 500-node fixture is a catastrophic-regression guard — an
    // accidental O(n^2) all-pairs finisher would blow far past it at scale.
    console.log(`[ForceAtlas2 Visual] layout settled in ${layoutSettleMs}ms (${summary.nodeCount} nodes)`);
    expect(layoutSettleMs, `layout settle time ${layoutSettleMs}ms exceeded budget`).toBeLessThan(60000);

    await openAdvancedSettings(appWindow);

    for (const [label, engine] of [
      ['ForceAtlas2', 'forceatlas2'],
      ['ComboCombined', 'combocombined'],
      ['Mindmap', 'mindmap'],
      ['WebCoLA', 'webcola'],
    ] as const) {
      await appWindow.getByLabel(label).click();
      await expectSavedLayoutEngine(appWindow, engine);
    }

    const textArea = appWindow.locator('#window-settings-editor textarea').first();
    await textArea.fill(JSON.stringify({ engine: 'mindmap', nodeSpacing: 160, edgeLength: 420 }, null, 2));
    await expectSavedLayoutEngine(appWindow, 'mindmap');
    await expectSavedLayoutNodeSpacing(appWindow, 160);

    await closeSettingsAndStopWatching(appWindow);
  });
});
