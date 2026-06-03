import { expect, test as base, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type { VTSettings } from '@vt/graph-model/settings';
import type { Core as CytoscapeCore, NodeSingular, EdgeSingular } from 'cytoscape';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { killOrphanVtGraphdDaemons } from '@vt/graph-db-client';

import { scoreLayout } from '../../../../../src/shell/UI/cytoscape-graph-ui/graphviz/layout/quality/layoutQualityScore';
import { waitForLayoutStable } from './perf-helpers/layoutHelpers';
import {
  framesToJank,
  type EngineScorecard,
  type GraphGeometry,
  type LayoutPerformance,
} from './perf-helpers/layoutScorecard';

// ─────────────────────────────────────────────────────────────────────────────
// Layout-quality scorecard harness — the experiment driver.
//
// For each layout engine: set it, trigger "Tidy layout", wait for the layout to
// settle (timed), read REAL geometry from window.cytoscapeInstance, score it via
// the pure scoreLayout module, capture a SEPARATE performance block, screenshot
// the fit-to-viewport graph, and write a machine-readable scorecard JSON.
//
// Parameterized by env:
//   SCORECARD_VAULT_PATH    vault to load (default: voicetree-15-5, ~270 nodes)
//   SCORECARD_ENGINE        one engine, or "all" (default: webcola + forceatlas2)
//   SCORECARD_LAYOUT_CONFIG JSON object merged into settings.layoutConfig before
//                           each run (e.g. '{"nodeSpacing":160,"edgeLength":420}')
//                           — lets a fan-out score an arbitrary (engine, config).
//   SCORECARD_OUT_DIR       output dir for scorecard JSON + PNG
//   SCORECARD_LABEL         filename stem (default: the engine id); set a unique
//                           label to score several configs of one engine without
//                           overwriting (e.g. forceatlas2-tight).
//   SCORECARD_INSPECT_PORT  electron --inspect port (default 9233); give each
//                           concurrent worktree agent a distinct port.
// ─────────────────────────────────────────────────────────────────────────────

const PROJECT_ROOT: string = path.resolve(process.cwd());
const SCORECARD_VAULT_PATH: string = process.env.SCORECARD_VAULT_PATH
  ?? '/Users/bobbobby/repos/vtrepo/get_dev_healthy/extracted/voicetree-15-5';
const PROJECT_NAME = 'scorecard-vault';
const OUT_DIR: string = process.env.SCORECARD_OUT_DIR
  ?? path.join(PROJECT_ROOT, 'layout-scorecards');
const INSPECT_PORT = Number.parseInt(process.env.SCORECARD_INSPECT_PORT ?? '9233', 10);

const ALL_ENGINES = ['forceatlas2', 'combocombined', 'mindmap', 'webcola'] as const;
const BASELINE_ENGINES = ['webcola', 'forceatlas2'] as const;

function selectedEngines(): readonly string[] {
  const requested = process.env.SCORECARD_ENGINE?.trim();
  if (!requested || requested === 'all') {
    return requested === 'all' ? ALL_ENGINES : BASELINE_ENGINES;
  }
  return [requested];
}

// Extra layout-config fields (nodeSpacing, edgeLength, …) merged under the
// selected engine. Lets a fan-out score an arbitrary (engine, config) pair.
function customLayoutConfig(): Record<string, unknown> {
  const raw = process.env.SCORECARD_LAYOUT_CONFIG?.trim();
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SCORECARD_LAYOUT_CONFIG must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

const MIN_EXPECTED_NODES = 100;

type LayoutProbe = {
  frameTs: number[];
  layoutFirstStart: number | null;
  layoutLastStop: number | null;
  sampling: boolean;
  onStart: () => void;
  onStop: () => void;
};

type ScorecardWindow = Window & {
  readonly cytoscapeInstance?: CytoscapeCore;
  __layoutProbe?: LayoutProbe;
  readonly electronAPI?: {
    readonly main?: {
      readonly startFileWatching?: (directoryPath?: string) => Promise<{ readonly success: boolean; readonly error?: string }>;
      readonly stopFileWatching?: () => Promise<void>;
      readonly loadSettings?: () => Promise<VTSettings>;
      readonly saveSettings?: (settings: VTSettings) => Promise<boolean>;
    };
  };
};

// ── Electron launch boilerplate (mirrors electron-dev-dev-layout-comparison) ──

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
  const candidates: readonly (string | undefined)[] = [
    process.env.VT_GRAPHD_NODE_BIN,
    process.env.npm_node_execpath,
    process.execPath,
    existsSync(nvmNodeBin) ? nvmNodeBin : undefined,
    'node',
  ];
  return candidates.filter((candidate): candidate is string => Boolean(candidate)).find(canLoadNativeGraphDbModules) ?? process.execPath;
}

function builtAppEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RENDERER_URL;
  return env;
}

async function closeElectronAppWithTimeout(electronApp: ElectronApplication): Promise<void> {
  const closedGracefully: boolean = await Promise.race([
    electronApp.close().then(() => true).catch(() => true),
    new Promise<false>(resolve => setTimeout(() => resolve(false), 10_000)),
  ]);
  if (closedGracefully) return;
  const childProcess = await Promise.resolve()
    .then(() => electronApp.process())
    .catch(() => null);
  if (!childProcess) return;
  if (childProcess.exitCode !== null) return;
  childProcess.kill('SIGTERM');
  await new Promise<void>(resolve => {
    const timeout = setTimeout(resolve, 5000);
    childProcess.once('exit', () => { clearTimeout(timeout); resolve(); });
  });
  if (childProcess.exitCode === null) childProcess.kill('SIGKILL');
}

async function countMarkdownFiles(directoryPath: string): Promise<number> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const counts = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) return countMarkdownFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.md') ? 1 : 0;
  }));
  return counts.reduce((sum, count) => sum + count, 0);
}

const test = base.extend<{
  readonly electronApp: ElectronApplication;
  readonly appWindow: Page;
  readonly markdownFileCount: number;
}>({
  markdownFileCount: async ({}, use) => {
    await use(await countMarkdownFiles(SCORECARD_VAULT_PATH));
  },

  electronApp: async ({}, use) => {
    const tempUserDataPath: string = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-scorecard-'));
    await fs.writeFile(
      path.join(tempUserDataPath, 'projects.json'),
      JSON.stringify([{ id: 'scorecard', path: SCORECARD_VAULT_PATH, name: PROJECT_NAME, type: 'folder', lastOpened: Date.now() }], null, 2),
      'utf8',
    );
    // projectConfig.writeFolderPath = the vault root makes the app load ALL of
    // its .md files. Without it the app spins up a fresh voicetree-{date}
    // subfolder and only loads that (a handful of nodes).
    await fs.writeFile(
      path.join(tempUserDataPath, 'voicetree-config.json'),
      JSON.stringify({
        lastDirectory: SCORECARD_VAULT_PATH,
        projectConfig: { [SCORECARD_VAULT_PATH]: { writeFolderPath: SCORECARD_VAULT_PATH, readPaths: [] } },
      }, null, 2),
      'utf8',
    );
    await fs.writeFile(
      path.join(tempUserDataPath, 'settings.json'),
      JSON.stringify({ layoutConfig: JSON.stringify({ engine: 'webcola' }) }, null, 2),
      'utf8',
    );

    const electronApp: ElectronApplication = await electron.launch({
      args: [
        `--inspect=${INSPECT_PORT}`,
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`,
      ],
      env: {
        ...builtAppEnvironment(),
        NODE_ENV: 'test',
        HEADLESS_TEST: '0',
        MINIMIZE_TEST: '0',
        VOICETREE_PERSIST_STATE: '1',
        VOICETREE_DAEMON_LOAD_TIMEOUT_MS: '180000',
        VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(),
        // The app resolves its home (settings, recent projects, project config)
        // from VOICETREE_HOME_PATH — NOT Electron's --user-data-dir — so isolate
        // it to the seeded temp dir, then auto-open the vault straight into graph
        // view (getStartupProjectHint → 'open-folder'), skipping the picker.
        VOICETREE_HOME_PATH: tempUserDataPath,
        VOICETREE_STARTUP_FOLDER: SCORECARD_VAULT_PATH,
      },
      timeout: 30000,
    });

    await use(electronApp);

    try {
      const window = await electronApp.firstWindow();
      await window.evaluate(async () => {
        await (window as unknown as ScorecardWindow).electronAPI?.main?.stopFileWatching?.();
      });
      await window.waitForTimeout(300);
    } catch {
      // Teardown-only failures are handled by closeElectronAppWithTimeout.
    }
    await closeElectronAppWithTimeout(electronApp);
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
    killOrphanVtGraphdDaemons();
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 30000 });
    window.on('console', (msg) => {
      if (msg.type() === 'warning' || msg.type() === 'error') console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });
    window.on('pageerror', (error) => console.error('PAGE ERROR:', error.message));
    await window.waitForLoadState('domcontentloaded');

    // VOICETREE_STARTUP_FOLDER makes the app auto-open the vault straight into
    // graph view (daemon opens the project + starts graph sync) — no picker
    // click. startFileWatching was removed from the API; call it best-effort to
    // re-arm watching if present, otherwise the auto-open path already handled
    // loading.
    const watchResult = await window.evaluate(async (projectPath) => {
      const api = (window as unknown as ScorecardWindow).electronAPI?.main;
      if (!api?.startFileWatching) return { success: true } as { success: boolean; error?: string };
      return api.startFileWatching(projectPath);
    }, SCORECARD_VAULT_PATH);
    expect(watchResult.success, watchResult.error ?? 'startFileWatching failed').toBe(true);

    await window.waitForFunction(
      () => Boolean((window as unknown as ScorecardWindow).cytoscapeInstance),
      undefined,
      { timeout: 180000 },
    );

    await use(window);
  },
});

// ── Harness steps ────────────────────────────────────────────────────────────

async function waitForLoadedGraph(appWindow: Page, markdownFileCount: number): Promise<void> {
  await expect
    .poll(
      async () => appWindow.evaluate((): number => (window as unknown as ScorecardWindow).cytoscapeInstance?.nodes().length ?? 0),
      { message: `Waiting for ${SCORECARD_VAULT_PATH} graph to load`, timeout: 180000, intervals: [1000, 2000, 3000, 5000] },
    )
    .toBeGreaterThanOrEqual(Math.min(markdownFileCount, MIN_EXPECTED_NODES));
}

// Applies { ...current, ...extraConfig, engine } to settings.layoutConfig and
// returns the exact config object that was persisted (recorded in the scorecard
// so a fan-out knows which (engine, config) produced the score).
async function applyLayoutConfig(appWindow: Page, engine: string, extraConfig: Record<string, unknown>): Promise<Record<string, unknown>> {
  return appWindow.evaluate(async ({ nextEngine, extra }) => {
    const api = (window as unknown as ScorecardWindow).electronAPI?.main;
    if (!api?.loadSettings || !api.saveSettings) throw new Error('settings API is unavailable');
    const settings: VTSettings = await api.loadSettings();
    const currentLayout = settings.layoutConfig ? JSON.parse(settings.layoutConfig) as Record<string, unknown> : {};
    const merged = { ...currentLayout, ...extra, engine: nextEngine };
    await api.saveSettings({ ...settings, layoutConfig: JSON.stringify(merged, null, 2) });
    return merged;
  }, { nextEngine: engine, extra: extraConfig });
}

async function installPerfProbe(appWindow: Page): Promise<void> {
  await appWindow.evaluate(() => {
    const w = window as unknown as ScorecardWindow;
    const cy = w.cytoscapeInstance;
    if (!cy) throw new Error('cytoscapeInstance is unavailable');
    const probe: LayoutProbe = {
      frameTs: [], layoutFirstStart: null, layoutLastStop: null, sampling: true,
      onStart: () => { if (probe.layoutFirstStart === null) probe.layoutFirstStart = performance.now(); },
      onStop: () => { probe.layoutLastStop = performance.now(); },
    };
    const tick = (t: number): void => { probe.frameTs.push(t); if (probe.sampling) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    cy.on('layoutstart', probe.onStart);
    cy.on('layoutstop', probe.onStop);
    w.__layoutProbe = probe;
  });
}

async function readPerfProbe(appWindow: Page, timeToStableMs: number): Promise<LayoutPerformance> {
  const raw = await appWindow.evaluate(() => {
    const w = window as unknown as ScorecardWindow;
    const probe = w.__layoutProbe;
    const cy = w.cytoscapeInstance;
    if (!probe || !cy) return { frameTs: [] as number[], layoutWallClockMs: null as number | null };
    probe.sampling = false;
    cy.off('layoutstart', probe.onStart);
    cy.off('layoutstop', probe.onStop);
    const wall = (probe.layoutFirstStart !== null && probe.layoutLastStop !== null && probe.layoutLastStop >= probe.layoutFirstStart)
      ? probe.layoutLastStop - probe.layoutFirstStart : null;
    return { frameTs: probe.frameTs, layoutWallClockMs: wall };
  });
  return { layoutWallClockMs: raw.layoutWallClockMs, timeToStableMs, ...framesToJank(raw.frameTs) };
}

// Reads label-INCLUSIVE node bboxes (the footprint the scorer grades), the
// label-only rect as the title box, and edge endpoints — straight from the live
// Cytoscape instance. Node x/y are the bbox CENTER so the pure scorer
// reconstructs the exact label-inclusive box.
async function extractGeometry(appWindow: Page): Promise<GraphGeometry> {
  return appWindow.evaluate((): GraphGeometry => {
    const cy = (window as unknown as ScorecardWindow).cytoscapeInstance;
    if (!cy) throw new Error('cytoscapeInstance is unavailable');
    const leaves = cy.nodes()
      .filter((node: NodeSingular) => !node.data('isContextNode') && !node.isParent())
      .toArray() as NodeSingular[];
    const ids = new Set<string>(leaves.map((n) => n.id()));
    const nodes = leaves.map((node: NodeSingular) => {
      const bb = node.boundingBox({ includeLabels: true, includeOverlays: false, includeEdges: false });
      const lbl = node.boundingBox({ includeLabels: true, includeNodes: false, includeOverlays: false, includeEdges: false });
      const titleBox = lbl.w > 0 && lbl.h > 0 ? { x1: lbl.x1, y1: lbl.y1, x2: lbl.x2, y2: lbl.y2 } : undefined;
      return { id: node.id(), x: (bb.x1 + bb.x2) / 2, y: (bb.y1 + bb.y2) / 2, width: bb.w, height: bb.h, titleBox };
    });
    const edges = cy.edges().toArray()
      .map((edge: EdgeSingular) => ({ source: edge.source().id(), target: edge.target().id() }))
      .filter((edge) => ids.has(edge.source) && ids.has(edge.target));
    return { nodes, edges };
  });
}

async function fitAndScreenshot(appWindow: Page, screenshotPath: string): Promise<void> {
  await appWindow.evaluate(() => {
    const cy = (window as unknown as ScorecardWindow).cytoscapeInstance;
    if (cy) cy.fit(cy.nodes(), 80);
  });
  await appWindow.waitForTimeout(500);
  await appWindow.screenshot({ path: screenshotPath, fullPage: false });
}

test.describe('layout-quality scorecard', () => {
  test('scores each engine on the realistic vault and emits scorecard JSON + screenshot', async ({ appWindow, markdownFileCount }) => {
    test.setTimeout(1_200_000);
    await fs.mkdir(OUT_DIR, { recursive: true });

    await waitForLoadedGraph(appWindow, markdownFileCount);
    await waitForLayoutStable(appWindow, 180000);

    const extraConfig = customLayoutConfig();
    for (const engine of selectedEngines()) {
      const appliedConfig = await applyLayoutConfig(appWindow, engine, extraConfig);
      await installPerfProbe(appWindow);

      const startedAt = Date.now();
      await appWindow.getByRole('button', { name: 'Tidy layout' }).click();
      await waitForLayoutStable(appWindow, 180000);
      const performance: LayoutPerformance = await readPerfProbe(appWindow, Date.now() - startedAt);

      const geometry = await extractGeometry(appWindow);
      const quality = scoreLayout(geometry.nodes, geometry.edges);

      const label = process.env.SCORECARD_LABEL?.trim() || engine;
      const screenshotPath = path.join(OUT_DIR, `scorecard-${label}.png`);
      await fitAndScreenshot(appWindow, screenshotPath);

      const scorecard: EngineScorecard = {
        engine,
        layoutConfig: appliedConfig,
        vaultPath: SCORECARD_VAULT_PATH,
        nodeCount: geometry.nodes.length,
        edgeCount: geometry.edges.length,
        quality,
        performance,
        screenshotPath,
        capturedAtIso: new Date(startedAt).toISOString(),
      };
      await fs.writeFile(path.join(OUT_DIR, `scorecard-${label}.json`), JSON.stringify(scorecard, null, 2), 'utf8');

      console.log(`[scorecard] ${engine}: composite=${quality.composite.toFixed(4)} ` +
        `nodes=${scorecard.nodeCount} edges=${scorecard.edgeCount} ` +
        `timeToStable=${performance.timeToStableMs}ms wallClock=${performance.layoutWallClockMs ?? 'n/a'} ` +
        `longFrames=${performance.longFrameCount} avgFps=${performance.avgFps.toFixed(1)}`);
      console.log(`[scorecard] ${engine} pillars: ${JSON.stringify(quality.pillars)}`);

      expect(geometry.nodes.length, `vault must load > ${MIN_EXPECTED_NODES} nodes`).toBeGreaterThan(MIN_EXPECTED_NODES);
      expect(quality.composite).toBeGreaterThanOrEqual(0);
      expect(quality.composite).toBeLessThanOrEqual(1);
    }
  });
});
