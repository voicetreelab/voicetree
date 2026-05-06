import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type { Core as CytoscapeCore } from 'cytoscape';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ElectronAPI } from '@/shell/electron';
import type { GraphNode } from '@vt/graph-model/pure/graph';
import { getNodeTitle } from '@vt/graph-model/pure/graph/markdown-parsing';
import { robustElectronTeardown, resolveGraphDaemonNodeBin, getCiElectronFlags } from './electron-smoke-helpers';

const PROJECT_ROOT = path.resolve(process.cwd());

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

async function seedProject(projectPath: string): Promise<string> {
  const writePath = path.join(projectPath, 'voicetree');
  await fs.mkdir(writePath, { recursive: true });
  await fs.mkdir(path.join(projectPath, '.voicetree'), { recursive: true });
  await fs.writeFile(
    path.join(writePath, 'Root.md'),
    '# Root\n\nThis is the initial watched vault node.\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(projectPath, '.voicetree', 'positions.json'),
    JSON.stringify({
      'Root.md': { x: 100, y: 100 },
    }),
    'utf8',
  );
  return writePath;
}

function resolveGraphdNodeBin(): string | undefined {
  const candidates: readonly string[] = [
    process.env.VT_GRAPHD_NODE_BIN,
    process.env.npm_node_execpath,
    process.execPath,
    ...((process.env.PATH ?? '').split(path.delimiter).map((entry) => path.join(entry, 'node'))),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => {
    if (!existsSync(candidate)) return false;
    try {
      return execFileSync(candidate, ['-p', 'process.versions.modules'], { encoding: 'utf8' }).trim() === '127';
    } catch {
      return false;
    }
  }) ?? process.env.VT_GRAPHD_NODE_BIN ?? process.env.npm_node_execpath ?? process.execPath;
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  projectPath: string;
  writePath: string;
}>({
  projectPath: async ({}, use) => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-project-system-'));
    await use(projectPath);
    await fs.rm(projectPath, { recursive: true, force: true });
  },

  writePath: async ({ projectPath }, use) => {
    const writePath = await seedProject(projectPath);
    await use(writePath);
  },

  electronApp: async ({ projectPath, writePath }, use) => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-app-system-'));
    const savedProject = {
      id: 'vault-file-watcher-system',
      path: projectPath,
      name: path.basename(projectPath),
      type: 'folder',
      lastOpened: Date.now(),
      voicetreeInitialized: true,
    };
    await fs.writeFile(path.join(userDataPath, 'projects.json'), JSON.stringify([savedProject], null, 2), 'utf8');
    await fs.writeFile(
      path.join(userDataPath, 'voicetree-config.json'),
      JSON.stringify({
        lastDirectory: projectPath,
        vaultConfig: {
          [projectPath]: {
            writePath,
            readPaths: [],
          },
        },
      }, null, 2),
      'utf8',
    );

    const ciFlags = process.env.CI
      ? ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader']
      : [];
    const electronApp = await electron.launch({
      args: [
        ...ciFlags,
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${userDataPath}`,
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
        VOICETREE_PERSIST_STATE: '1',
        VT_GRAPHD_NODE_BIN: resolveGraphdNodeBin(),
      },
      timeout: 15_000,
    });

    await use(electronApp);

    try {
      const window = await electronApp.firstWindow();
      await window.evaluate(async () => {
        await (window as unknown as ExtendedWindow).electronAPI?.main.stopFileWatching();
      });
    } catch {
      // The app may already be closed after a failed launch.
    }
    await robustElectronTeardown(electronApp);
    await fs.rm(userDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp, projectPath }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15_000 });
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('text=Recent Projects', { timeout: 10_000 });
    await window.locator(`button:has-text("${path.basename(projectPath)}")`).first().click();
    await window.waitForFunction(
      () => Boolean((window as unknown as ExtendedWindow).cytoscapeInstance),
      { timeout: 15_000 },
    );
    await window.waitForFunction(
      () => ((window as unknown as ExtendedWindow).cytoscapeInstance?.nodes().length ?? 0) >= 1,
      { timeout: 10_000 },
    );
    await use(window);
  },
});

test('keeps Electron UI, graph state, and vault files converged after a disk change', async ({ appWindow, writePath }) => {
  test.setTimeout(30_000);

  const initial = await appWindow.evaluate(async () => {
    const api = (window as unknown as ExtendedWindow).electronAPI;
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!api || !cy) throw new Error('Electron graph boundary is unavailable');
    const graph = await api.main.getGraph();
    return {
      graphNodeCount: Object.keys(graph.nodes).length,
      uiLabels: cy.nodes().map(node => String(node.data('label'))),
    };
  });

  expect(initial.graphNodeCount).toBeGreaterThanOrEqual(1);
  expect(initial.uiLabels).toContain('Root');

  await fs.writeFile(
    path.join(writePath, 'Created From Disk.md'),
    '# Created From Disk\n\nThis node arrived through the watched vault boundary.\n',
    'utf8',
  );

  await appWindow.waitForFunction(
    () => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      return cy?.nodes().some(node => node.data('label') === 'Created From Disk') ?? false;
    },
    { timeout: 10_000 },
  );

  const convergedGraphAndUi = await appWindow.evaluate(async () => {
    const api = (window as unknown as ExtendedWindow).electronAPI;
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!api || !cy) throw new Error('Electron graph boundary is unavailable');
    const graph = await api.main.getGraph();
    return {
      graphNodes: Object.values(graph.nodes),
      uiLabels: cy.nodes().map(node => String(node.data('label'))),
    };
  });
  const converged = {
    graphLabels: convergedGraphAndUi.graphNodes.map((node: GraphNode) => getNodeTitle(node)),
    uiLabels: convergedGraphAndUi.uiLabels,
  };

  expect(converged.graphLabels).toContain('Created From Disk');
  expect(converged.uiLabels).toContain('Created From Disk');
  expect(converged.uiLabels.length).toBeGreaterThan(initial.uiLabels.length);
  await expect(appWindow.locator('button[title="Back to project selection"]')).toBeVisible();
});
