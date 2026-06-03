/**
 * BEHAVIORAL SPEC: "New voicetree" starts from a clean slate.
 *
 * Clicking the "New voicetree" button in the file-tree sidebar creates a fresh
 * dated folder, makes it the write folder, AND unloads everything that was
 * loaded before (the previous write folder plus any read folders). The graph
 * should therefore collapse from the previous project's nodes down to just the
 * freshly created (empty) voicetree.
 *
 * SETUP: a project with >10 markdown files at its root, opened with that root as
 * the write folder so the graph starts with >10 nodes.
 *
 * EXPECTED: after clicking "New voicetree", the graph has <2 nodes (the new
 * dated folder is empty — at most a single starter node).
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Core as CytoscapeCore } from 'cytoscape';
import { generateProjectOnDisk } from '@vt/perf-fixtures';
import {
  getCiElectronFlags,
  pollForCytoscape,
  pollForCytoscapeNodes,
  resolveGraphDaemonNodeBin,
  robustElectronTeardown,
} from './electron-smoke-helpers';

const PROJECT_ROOT: string = path.resolve(process.cwd());
// Generate a realistically-linked project. We seed well over 10 nodes and only
// require >10 to be visible, leaving margin for any folder collapsing.
const SEED_NODE_COUNT = 40;
const MIN_INITIAL_NODES = 12;

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
}

// Count content nodes only — the markdown files. Folder containers
// (`isFolderNode`) are UI scaffolding for unexpanded folders, not graph nodes,
// so a fresh voicetree (one starter node under a `voicetree-<date>/<day>/`
// path) has exactly one content node even though its two enclosing folders also
// appear in the projected graph.
function contentNodeCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    return (cy?.nodes() ?? []).filter((n: { data: (k: string) => unknown }) => !n.data('isFolderNode')).length;
  });
}

const test = base.extend<{
  projectPath: string;
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  // A realistically-linked project with SEED_NODE_COUNT nodes, so the graph loads
  // with well over 10 nodes once the root is the write folder.
  projectPath: async ({}, use): Promise<void> => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-new-voicetree-project-'));
    const project = path.join(tempDir, 'project');
    generateProjectOnDisk(project, SEED_NODE_COUNT);
    await use(project);
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  electronApp: async ({ projectPath }, use): Promise<void> => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-new-voicetree-userdata-'));

    await fs.writeFile(
      path.join(tempUserDataPath, 'projects.json'),
      JSON.stringify([{
        id: 'new-voicetree-clean-slate',
        path: projectPath,
        name: path.basename(projectPath),
        type: 'folder',
        lastOpened: Date.now(),
      }], null, 2),
      'utf8',
    );
    // Open the project root as the write folder so every seed file is loaded.
    await fs.writeFile(
      path.join(tempUserDataPath, 'voicetree-config.json'),
      JSON.stringify({
        lastDirectory: projectPath,
        projectConfig: { [projectPath]: { writeFolderPath: projectPath, readPaths: [] } },
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
        // at the seeded temp dir and auto-open the generated project on startup.
        VOICETREE_HOME_PATH: tempUserDataPath,
        VOICETREE_STARTUP_FOLDER: projectPath,
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
  test('clicking "New voicetree" collapses the graph from >10 nodes to <2', async ({ appWindow }) => {
    test.setTimeout(60000);

    // GIVEN: the seeded project is loaded — the graph holds >10 content nodes.
    await pollForCytoscapeNodes(appWindow, MIN_INITIAL_NODES, 30000);
    const initialContentNodes = await contentNodeCount(appWindow);
    expect(initialContentNodes).toBeGreaterThan(10);

    // WHEN: the user clicks the "New voicetree" button in the file-tree sidebar.
    const newVoicetreeButton = appWindow.getByRole('button', { name: 'New voicetree' });
    await expect(newVoicetreeButton).toBeVisible({ timeout: 15000 });
    // force: the live graph view animates continuously, so Playwright's "stable"
    // actionability wait never settles; visibility is asserted above.
    await newVoicetreeButton.click({ force: true });

    // THEN: every node from the previous project is unloaded, leaving only the
    // fresh voicetree's single starter node — a clean slate (<2 content nodes).
    await expect
      .poll(() => contentNodeCount(appWindow), {
        message: 'Waiting for the graph to collapse to the fresh voicetree (<2 content nodes)',
        timeout: 30000,
        intervals: [250, 500, 1000, 2000],
      })
      .toBeLessThan(2);
  });
});
