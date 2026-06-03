/**
 * BEHAVIORAL SPEC: "New voicetree" starts from a clean slate.
 *
 * Clicking the "New voicetree" button in the file-tree sidebar creates a fresh
 * dated folder, makes it the write folder, AND unloads everything that was
 * loaded before — the previous write folder AND every separately-loaded read
 * folder. The graph collapses from the whole project down to just the freshly
 * created voicetree, and the text-to-tree (Python) backend is re-pointed at the
 * new write folder so dictated/typed text lands there rather than the old one.
 *
 * SETUP: a project with a write folder (`main/`) plus two independently-loaded
 * read folders (`readA/`, `readB/`), each holding several nodes — so the graph
 * starts with >10 content nodes spread across three distinct loaded folders.
 *
 * EXPECTED after clicking "New voicetree":
 *   1. none of the previously-loaded nodes survive (write + both read folders),
 *      leaving only the fresh voicetree's single starter node (<2 content nodes);
 *   2. the text-to-tree backend is notified of the new write folder.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { HostAPI } from '@/shell/hostApi';
import { generateProjectOnDisk } from '@vt/perf-fixtures';
import {
  getCiElectronFlags,
  pollForCytoscape,
  pollForCytoscapeNodes,
  resolveGraphDaemonNodeBin,
  robustElectronTeardown,
} from './electron-smoke-helpers';

const PROJECT_ROOT: string = path.resolve(process.cwd());
const WRITE_NODE_COUNT = 12;
const READ_NODE_COUNT = 8;
const MIN_TOTAL_NODES = 20;

interface ProjectLayout {
  readonly root: string;
  readonly writeFolder: string;
  readonly readFolders: readonly string[];
}

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  hostAPI?: HostAPI;
}

// Content nodes only — the markdown files. Folder containers (`isFolderNode`)
// are UI scaffolding for unexpanded folders, not graph nodes, so a fresh
// voicetree (one starter node under `voicetree-<date>/<day>/`) has exactly one
// content node even though its two enclosing folders also appear in the graph.
function contentNodeIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    return (cy?.nodes() ?? [])
      .filter((n: { data: (k: string) => unknown }) => !n.data('isFolderNode'))
      .map((n: { id: () => string }) => n.id());
  });
}

function resolveWriteFolderPath(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const result: unknown = await (window as unknown as ExtendedWindow).hostAPI!.main.getWriteFolderPath();
    if (result && typeof result === 'object' && '_tag' in result) {
      const opt = result as { _tag: string; value?: string };
      return opt._tag === 'Some' ? (opt.value ?? null) : null;
    }
    return (result as string | null) ?? null;
  });
}

async function loadedDirectories(backendPort: number): Promise<string[]> {
  const res = await fetch(`http://127.0.0.1:${backendPort}/loaded-directories`);
  const body = (await res.json()) as { directories: string[] };
  return body.directories;
}

const test = base.extend<{
  project: ProjectLayout;
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  // A project root containing a write folder plus two independent read folders,
  // each a self-contained set of linked nodes.
  project: async ({}, use): Promise<void> => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-new-voicetree-project-'));
    const root = path.join(tempDir, 'project');
    await fs.mkdir(path.join(root, '.voicetree'), { recursive: true });
    await fs.writeFile(path.join(root, '.voicetree', 'positions.json'), '{}', 'utf8');

    const writeFolder = path.join(root, 'main');
    const readFolders = [path.join(root, 'readA'), path.join(root, 'readB')];
    generateProjectOnDisk(writeFolder, WRITE_NODE_COUNT);
    for (const readFolder of readFolders) generateProjectOnDisk(readFolder, READ_NODE_COUNT);

    await use({ root, writeFolder, readFolders });
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  electronApp: async ({ project }, use): Promise<void> => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-new-voicetree-userdata-'));

    await fs.writeFile(
      path.join(tempUserDataPath, 'projects.json'),
      JSON.stringify([{
        id: 'new-voicetree-clean-slate',
        path: project.root,
        name: path.basename(project.root),
        type: 'folder',
        lastOpened: Date.now(),
      }], null, 2),
      'utf8',
    );
    // Open `main/` as the write folder; read folders are loaded at runtime below.
    await fs.writeFile(
      path.join(tempUserDataPath, 'voicetree-config.json'),
      JSON.stringify({
        lastDirectory: project.root,
        projectConfig: { [project.root]: { writeFolderPath: project.writeFolder, readPaths: [] } },
      }, null, 2),
      'utf8',
    );

    const electronApp = await electron.launch({
      args: [
        ...getCiElectronFlags(),
        '--remote-debugging-port=0',
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`,
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
        VOICETREE_PERSIST_STATE: '1',
        // The app resolves its home (settings, recent projects, project config)
        // from VOICETREE_HOME_PATH — NOT Electron's --user-data-dir — so point it
        // at the seeded temp dir and auto-open the project on startup.
        VOICETREE_HOME_PATH: tempUserDataPath,
        VOICETREE_STARTUP_FOLDER: project.root,
        VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(),
      },
      timeout: 15000,
    });

    await use(electronApp);

    await robustElectronTeardown(electronApp);
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp }, use): Promise<void> => {
    const page = await electronApp.firstWindow({ timeout: 15000 });
    page.on('console', (msg) => console.log(`BROWSER [${msg.type()}]:`, msg.text()));
    page.on('pageerror', (error) => console.error('PAGE ERROR:', error.message));
    await page.waitForLoadState('domcontentloaded');
    // VOICETREE_STARTUP_FOLDER auto-opens the project on startup — wait for the graph.
    await pollForCytoscape(page, 30000);
    await use(page);
  },
});

test.describe('New voicetree clean slate', () => {
  test('clicking "New voicetree" unloads the write folder and all read folders, and re-points the backend', async ({ appWindow, project }) => {
    test.setTimeout(90000);

    const backendPort: number = await appWindow.evaluate(
      () => (window as unknown as ExtendedWindow).hostAPI!.main.getBackendPort(),
    );

    // GIVEN: the write folder (main/) is loaded on startup, then the user loads
    // two further read folders — three independently-loaded folders in all.
    for (const readFolder of project.readFolders) {
      await appWindow.evaluate(
        (folder: string) => (window as unknown as ExtendedWindow).hostAPI!.main.addReadPath(folder),
        readFolder,
      );
    }

    // All three folders are loaded: >10 content nodes, including nodes that came
    // specifically from each read folder.
    await pollForCytoscapeNodes(appWindow, MIN_TOTAL_NODES, 30000);
    const beforeIds: string[] = await contentNodeIds(appWindow);
    expect(beforeIds.length).toBeGreaterThan(10);
    for (const readFolder of project.readFolders) {
      expect(
        beforeIds.some((id) => id.startsWith(`${readFolder}/`)),
        `read folder ${readFolder} should have contributed nodes`,
      ).toBe(true);
    }

    // The backend was pointed at the original write folder on startup.
    const startupWriteFolder: string | null = await resolveWriteFolderPath(appWindow);
    expect(startupWriteFolder).toBe(project.writeFolder);
    expect(await loadedDirectories(backendPort)).toContain(project.writeFolder);

    // WHEN: the user clicks the "New voicetree" button in the file-tree sidebar.
    const newVoicetreeButton = appWindow.getByRole('button', { name: 'New voicetree' });
    await expect(newVoicetreeButton).toBeVisible({ timeout: 15000 });
    // force: the live graph view animates continuously, so Playwright's "stable"
    // actionability wait never settles; visibility is asserted above.
    await newVoicetreeButton.click({ force: true });

    // THEN (1): every previously-loaded node — from the write folder and both
    // read folders — is unloaded, leaving only the fresh voicetree's starter node.
    await expect
      .poll(async () => {
        const ids = await contentNodeIds(appWindow);
        return ids.filter((id) => beforeIds.includes(id)).length;
      }, {
        message: 'Waiting for every previously-loaded node to unload',
        timeout: 30000,
        intervals: [250, 500, 1000, 2000],
      })
      .toBe(0);
    const remaining = await contentNodeIds(appWindow);
    expect(remaining.length).toBeLessThan(2);

    // THEN (2): the write folder switched to a brand-new dated folder under the
    // project root, and the text-to-tree backend was notified of it.
    const newWriteFolder: string | null = await resolveWriteFolderPath(appWindow);
    expect(newWriteFolder).not.toBe(project.writeFolder);
    expect(newWriteFolder).toEqual(expect.stringContaining(`${project.root}/`));

    await expect
      .poll(async () => (await loadedDirectories(backendPort)).at(-1), {
        message: 'Waiting for the backend to be notified of the new write folder',
        timeout: 30000,
        intervals: [250, 500, 1000, 2000],
      })
      .toBe(newWriteFolder);
  });
});
