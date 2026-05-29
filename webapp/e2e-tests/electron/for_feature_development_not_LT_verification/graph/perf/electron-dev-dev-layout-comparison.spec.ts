import { expect, test as base, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type { VTSettings } from '@vt/graph-model/settings';
import type { Core as CytoscapeCore, NodeSingular } from 'cytoscape';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { killOrphanVtGraphdDaemons } from '@vt/graph-db-client';

import { waitForLayoutStable } from './perf-helpers/layoutHelpers';

const PROJECT_ROOT: string = path.resolve(process.cwd());
const DEV_DEV_PROJECT_PATH: string = process.env.DEV_DEV_PROJECT_PATH
  ?? path.join(os.homedir(), 'repos', 'voicetree-public', 'dev-dev');
const LAYOUT_ENGINES = ['forceatlas2', 'combocombined', 'mindmap', 'webcola'] as const;

type LayoutEngine = typeof LAYOUT_ENGINES[number];

type DevDevWindow = Window & {
  readonly cytoscapeInstance?: CytoscapeCore;
  readonly electronAPI?: {
    readonly main?: {
      readonly startFileWatching?: (directoryPath?: string) => Promise<{ readonly success: boolean; readonly error?: string }>;
      readonly stopFileWatching?: () => Promise<void>;
      readonly getGraph?: () => Promise<{ readonly nodes?: Record<string, unknown>; readonly edges?: Record<string, unknown> }>;
      readonly loadSettings?: () => Promise<VTSettings>;
      readonly saveSettings?: (settings: VTSettings) => Promise<boolean>;
    };
  };
};

type GraphSummary = {
  readonly nodes: number;
  readonly edges: number;
  readonly finitePositionCount: number;
  readonly bounds: {
    readonly width: number;
    readonly height: number;
  };
};

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

  const childProcess = electronApp.process();
  if (childProcess.exitCode !== null) return;

  childProcess.kill('SIGTERM');
  await new Promise<void>(resolve => {
    const timeout = setTimeout(resolve, 5000);
    childProcess.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  if (childProcess.exitCode === null) {
    childProcess.kill('SIGKILL');
  }
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
    await use(await countMarkdownFiles(DEV_DEV_PROJECT_PATH));
  },

  electronApp: async ({}, use) => {
    const tempUserDataPath: string = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-dev-dev-layouts-'));

    await fs.writeFile(
      path.join(tempUserDataPath, 'projects.json'),
      JSON.stringify([{
        id: 'dev-dev-layout-comparison',
        path: DEV_DEV_PROJECT_PATH,
        name: 'dev-dev',
        type: 'folder',
        lastOpened: Date.now(),
        voicetreeInitialized: true,
      }], null, 2),
      'utf8'
    );

    await fs.writeFile(
      path.join(tempUserDataPath, 'voicetree-config.json'),
      JSON.stringify({
        lastDirectory: DEV_DEV_PROJECT_PATH,
        projectConfig: {
          [DEV_DEV_PROJECT_PATH]: {
            writeFolderPath: DEV_DEV_PROJECT_PATH,
            readPaths: [],
          },
        },
      }, null, 2),
      'utf8'
    );

    const electronApp: ElectronApplication = await electron.launch({
      args: [
        '--inspect=9232',
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
      },
      timeout: 30000,
    });

    await use(electronApp);

    try {
      const window = await electronApp.firstWindow();
      await window.evaluate(async () => {
        await (window as unknown as DevDevWindow).electronAPI?.main?.stopFileWatching?.();
      });
      await window.waitForTimeout(300);
    } catch {
      // Ignore teardown-only failures; closeElectronAppWithTimeout handles the process boundary.
    }

    await closeElectronAppWithTimeout(electronApp);
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
    killOrphanVtGraphdDaemons();
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 30000 });

    window.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'warning' || msg.type() === 'error') {
        console.log(`BROWSER [${msg.type()}]:`, text);
      }
    });
    window.on('pageerror', (error) => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('text=Voicetree', { timeout: 15000 });
    await window.locator('button:has-text("dev-dev")').first().click();

    const watchResult = await window.evaluate(async (projectPath) => {
      const api = (window as unknown as DevDevWindow).electronAPI;
      if (!api?.main?.startFileWatching) {
        throw new Error('electronAPI.main.startFileWatching is unavailable');
      }
      return api.main.startFileWatching(projectPath);
    }, DEV_DEV_PROJECT_PATH);
    expect(watchResult.success, watchResult.error ?? 'startFileWatching failed').toBe(true);

    await window.waitForFunction(
      () => Boolean((window as unknown as DevDevWindow).cytoscapeInstance),
      undefined,
      { timeout: 30000 }
    );

    await use(window);
  },
});

async function waitForLoadedGraph(appWindow: Page, markdownFileCount: number): Promise<void> {
  await expect
    .poll(
      async () => appWindow.evaluate((): number => {
        const cy = (window as unknown as DevDevWindow).cytoscapeInstance;
        return cy?.nodes().length ?? 0;
      }),
      {
        message: `Waiting for ${DEV_DEV_PROJECT_PATH} graph nodes to load`,
        timeout: 180000,
        intervals: [1000, 2000, 3000, 5000],
      }
    )
    .toBeGreaterThanOrEqual(Math.min(markdownFileCount, 50));
}

async function setLayoutEngine(appWindow: Page, engine: LayoutEngine): Promise<void> {
  await appWindow.evaluate(async (nextEngine) => {
    const api = (window as unknown as DevDevWindow).electronAPI?.main;
    if (!api?.loadSettings || !api.saveSettings) {
      throw new Error('settings API is unavailable');
    }
    const settings: VTSettings = await api.loadSettings();
    const currentLayout = settings.layoutConfig ? JSON.parse(settings.layoutConfig) as Record<string, unknown> : {};
    await api.saveSettings({
      ...settings,
      layoutConfig: JSON.stringify({ ...currentLayout, engine: nextEngine }, null, 2),
    });
  }, engine);
}

async function rerunLayout(appWindow: Page): Promise<void> {
  await appWindow.getByRole('button', { name: 'Tidy layout' }).click();
  await waitForLayoutStable(appWindow, 180000);
}

async function summarizeAndFit(appWindow: Page): Promise<GraphSummary> {
  return appWindow.evaluate((): GraphSummary => {
    const cy = (window as unknown as DevDevWindow).cytoscapeInstance;
    if (!cy) throw new Error('cytoscapeInstance is unavailable');

    cy.fit(cy.nodes(), 80);

    const nodes: readonly NodeSingular[] = cy.nodes().filter((node: NodeSingular) => !node.data('isContextNode')).toArray();
    const positions = nodes
      .map((node) => node.position())
      .filter((position) => Number.isFinite(position.x) && Number.isFinite(position.y));
    const xs = positions.map((position) => position.x);
    const ys = positions.map((position) => position.y);

    return {
      nodes: nodes.length,
      edges: cy.edges().length,
      finitePositionCount: positions.length,
      bounds: {
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      },
    };
  });
}

test.describe('dev-dev layout visual comparison', () => {
  test('opens dev-dev and screenshots each layout backend', async ({ appWindow, markdownFileCount }, testInfo) => {
    test.setTimeout(900000);

    await waitForLoadedGraph(appWindow, markdownFileCount);
    await waitForLayoutStable(appWindow, 180000);

    for (const engine of LAYOUT_ENGINES) {
      await setLayoutEngine(appWindow, engine);
      await rerunLayout(appWindow);

      const summary = await summarizeAndFit(appWindow);
      console.log(`[dev-dev layout comparison] ${engine}: ${JSON.stringify(summary)}`);

      expect(summary.nodes).toBeGreaterThanOrEqual(Math.min(markdownFileCount, 50));
      expect(summary.finitePositionCount).toBe(summary.nodes);
      expect(summary.bounds.width).toBeGreaterThan(100);
      expect(summary.bounds.height).toBeGreaterThan(100);

      await appWindow.screenshot({
        path: testInfo.outputPath(`dev-dev-${engine}.png`),
        fullPage: false,
      });
    }
  });
});
