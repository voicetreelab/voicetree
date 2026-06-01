import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import type { Core as CytoscapeCore } from 'cytoscape';
import { killOrphanVtGraphdDaemons } from '@vt/graph-db-client';

import { generateProjectOnDisk } from '@vt/perf-fixtures';

export const PROJECT_ROOT = path.resolve(process.cwd());
export const PERF_TRACES_DIR = path.join(PROJECT_ROOT, 'e2e-tests', 'perf-traces');
export const REALISTIC_PERF_NODE_COUNT = Number.parseInt(process.env.REALISTIC_PERF_NODE_COUNT ?? '500', 10);

export interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: {
    main?: {
      startFileWatching?: (directoryPath?: string) => Promise<{ success: boolean; directory?: string; error?: string }>;
      getGraph?: () => Promise<{ nodes?: Record<string, unknown>; edges?: Record<string, unknown> }>;
    };
  };
}

let mainInspectPort = 0;
let generatedProjectPath = '';

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

function builtAppEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RENDERER_URL;
  return env;
}

async function closeElectronAppWithTimeout(electronApp: ElectronApplication): Promise<void> {
  const closeTimeoutMs = 10000;
  const closedGracefully: boolean = await Promise.race([
    electronApp.close().then(() => true).catch(() => true),
    new Promise<false>(resolve => setTimeout(() => resolve(false), closeTimeoutMs)),
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

function stopTmuxServerForHome(voicetreeHomePath: string): void {
  const socketPath = path.join(voicetreeHomePath, 'tmux.sock');
  try {
    execFileSync('tmux', ['-S', socketPath, 'kill-server'], { stdio: 'ignore' });
  } catch {
    // tmux may not have been started for this run.
  }
}

export function getMainInspectPort(): number {
  return mainInspectPort;
}

export function getGeneratedProjectPath(): string {
  return generatedProjectPath;
}

export async function collectLoadDiagnostics(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async (projectRoot) => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    const api = (
      window as unknown as {
        electronAPI?: {
          main?: {
            getWatchStatus?: () => Promise<unknown>;
            getProjectPaths?: () => Promise<unknown>;
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
      projectPaths: await safeCall(api?.main?.getProjectPaths),
      graphNodeCount,
      graphEdgeCount,
    };
  }, generatedProjectPath);
}

export const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(
      path.join(os.tmpdir(), 'voicetree-realistic-perf-')
    );

    generatedProjectPath = path.join(tempUserDataPath, 'perf-test-project');
    generateProjectOnDisk(generatedProjectPath, REALISTIC_PERF_NODE_COUNT);
    console.log(`[Project Gen] Created ${REALISTIC_PERF_NODE_COUNT} nodes in ${generatedProjectPath}`);

    // Seed projects.json pointing at the generated project
    const projectsPath = path.join(tempUserDataPath, 'projects.json');
    await fs.writeFile(
      projectsPath,
      JSON.stringify([{
        id: 'realistic-perf-project',
        path: generatedProjectPath,
        name: 'perf-test-project',
        type: 'folder',
        lastOpened: Date.now(),
      }], null, 2),
      'utf8'
    );

    // Seed voicetree-config.json with project config so the app loads ALL .md files
    // Without this, the app creates a new voicetree-{date} subfolder and only loads that
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        lastDirectory: generatedProjectPath,
        projectConfig: {
          [generatedProjectPath]: {
            writeFolderPath: generatedProjectPath,
            readPaths: [],
          }
        }
      }, null, 2),
      'utf8'
    );

    // Seed settings.json with the ForceAtlas2 layout engine. The app resolves its
    // home (settings.json, recent projects, project config) from VOICETREE_HOME_PATH
    // — NOT Electron's --user-data-dir — so we point that at the isolated temp dir
    // below. Without this the app would read the developer's real ~/.voicetree
    // (showing their real projects and default 'cola' engine) and never reach the
    // generated graph under the ForceAtlas2 engine.
    const settingsPath = path.join(tempUserDataPath, 'settings.json');
    await fs.writeFile(
      settingsPath,
      JSON.stringify({
        layoutConfig: JSON.stringify({ engine: 'forceatlas2', nodeSpacing: 120, edgeLength: 350 }),
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
        ...builtAppEnvironment(),
        NODE_ENV: 'test',
        HEADLESS_TEST: '0',
        MINIMIZE_TEST: '0',
        VOICETREE_PERSIST_STATE: '1',
        VOICETREE_DAEMON_LOAD_TIMEOUT_MS: '180000',
        VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(),
        // Isolate app home to the seeded temp dir, and auto-open the generated
        // project on startup (getStartupProjectHint → 'open-folder') so we skip
        // the project picker entirely.
        VOICETREE_HOME_PATH: tempUserDataPath,
        VOICETREE_STARTUP_FOLDER: generatedProjectPath,
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

    await closeElectronAppWithTimeout(electronApp);
    stopTmuxServerForHome(tempUserDataPath);
    await fs.rm(tempUserDataPath, { recursive: true, force: true });

    // After the temp project is gone, any leftover vt-graphd daemons spawned by
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

    // VOICETREE_STARTUP_FOLDER makes the app auto-open the generated project
    // straight into graph view (daemon opens the project and starts graph sync),
    // so no project picker click and no manual file-watching kick are needed.
    // If the renderer still exposes startFileWatching, call it best-effort to
    // re-arm watching; otherwise the auto-open path has already handled it.
    console.log(`[Realistic Perf] App auto-opening startup folder (project=${generatedProjectPath}, nodes=${REALISTIC_PERF_NODE_COUNT})`);

    const watchResult: { success: boolean; error?: string } = await window.evaluate(async (projectPath) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api?.main?.startFileWatching) return { success: true };
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
