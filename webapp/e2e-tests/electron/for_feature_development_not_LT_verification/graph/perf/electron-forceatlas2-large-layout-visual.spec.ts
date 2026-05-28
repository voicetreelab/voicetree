import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Core as CytoscapeCore, NodeSingular } from 'cytoscape';

import { waitForLayoutStable } from './perf-helpers/layoutHelpers';
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

async function waitForGraphNodes(appWindow: Page): Promise<void> {
  await expect
    .poll(
      async () => appWindow.evaluate((): number => {
        const cy: CytoscapeCore | undefined = (window as unknown as ExtendedWindow).cytoscapeInstance;
        return cy?.nodes().length ?? 0;
      }),
      {
        message: 'Waiting for realistic vault graph nodes to reach Cytoscape',
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

    try {
      await waitForGraphNodes(appWindow);
      await waitForLayoutStable(appWindow, 180000);
    } catch (error) {
      console.error('[ForceAtlas2 Visual] load diagnostics:', JSON.stringify(await collectLoadDiagnostics(appWindow), null, 2));
      throw error;
    }

    expect(await currentLayoutEngine(appWindow)).toBe('forceatlas2');

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
