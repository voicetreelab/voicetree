import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type { Core as CytoscapeCore } from 'cytoscape';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ElectronAPI } from '@/shell/electron';
import { getNodeTitle, type GraphNode } from '@vt/graph-model';
import { robustElectronTeardown, safeStopFileWatching, pollForCytoscape, pollForCytoscapeNodes } from './electron-smoke-helpers';

const PROJECT_ROOT = path.resolve(process.cwd());

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

async function seedProject(projectPath: string): Promise<string> {
  const writeFolderPath = path.join(projectPath, 'voicetree');
  await fs.mkdir(writeFolderPath, { recursive: true });
  await fs.mkdir(path.join(projectPath, '.voicetree'), { recursive: true });
  await fs.writeFile(
    path.join(writeFolderPath, 'Root.md'),
    '# Root\n\nThis is the initial watched project node.\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(projectPath, '.voicetree', 'positions.json'),
    JSON.stringify({
      'Root.md': { x: 100, y: 100 },
    }),
    'utf8',
  );
  return writeFolderPath;
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
  writeFolderPath: string;
}>({
  projectPath: async ({}, use) => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-project-system-'));
    await use(projectPath);
    await fs.rm(projectPath, { recursive: true, force: true });
  },

  writeFolderPath: async ({ projectPath }, use) => {
    const writeFolderPath = await seedProject(projectPath);
    await use(writeFolderPath);
  },

  electronApp: async ({ projectPath, writeFolderPath }, use) => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-app-system-'));
    const savedProject = {
      id: 'project-file-watcher-system',
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
        projectConfig: {
          [projectPath]: {
            writeFolderPath,
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

    await safeStopFileWatching(electronApp);
    await robustElectronTeardown(electronApp);
    await fs.rm(userDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp, projectPath }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15_000 });
    await window.waitForLoadState('domcontentloaded');
    const openResult = await window.evaluate(async (dir) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      const response = await api.main.openProject(dir);
      return { writeFolderPath: response.writeFolderPath };
    }, projectPath);
    expect(openResult.writeFolderPath, 'openProject returned no writeFolderPath').toBeTruthy();
    await pollForCytoscape(window, 30_000);
    await pollForCytoscapeNodes(window, 1, 20_000);
    await use(window);
  },
});

test('keeps Electron UI, graph state, and project files converged after a disk change', async ({ appWindow, writeFolderPath }) => {
  test.setTimeout(60_000);

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
    path.join(writeFolderPath, 'Created From Disk.md'),
    '# Created From Disk\n\nThis node arrived through the watched project boundary.\n',
    'utf8',
  );

  await expect.poll(async () => {
    return await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      return cy?.nodes().some(node => node.data('label') === 'Created From Disk') ?? false;
    });
  }, { message: 'Waiting for Created From Disk node', timeout: 10_000, intervals: [250, 500, 1000, 2000] }).toBe(true);

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
