/**
 * BEHAVIORAL SPEC: Markdown table rendering in floating editors
 *
 * Verifies:
 * 1. GFM tables render as HTML tables in the real Electron floating editor
 * 2. Existing render blocks (for example blockquotes) still render
 * 3. Moving the cursor into the table switches back to raw pipe markdown for editing
 * 4. Moving the cursor back out restores the rendered table
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { EditorView } from '@codemirror/view';

const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');
const TEST_FILE_NAME = 'table-rendering-fixture.md';
const TEST_NODE_LABEL = 'Table Rendering Fixture';
const TEST_CONTENT = `# Table Rendering Fixture

| Name | Value |
| --- | --- |
| Alpha | Beta |

> Existing blockquote rendering should still work.`;

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: {
    main: {
      stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
      getGraph: () => Promise<{ nodes: Record<string, { label?: string }> } | undefined>;
    };
  };
}

interface CodeMirrorElement extends HTMLElement {
  cmView?: { view: EditorView };
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: [async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-table-rendering-userdata-'));
    const watchedFolder = path.join(tempUserDataPath, 'table-rendering-project');
    const vaultPath = path.join(watchedFolder, 'voicetree');

    await fs.mkdir(watchedFolder, { recursive: true });
    await fs.cp(FIXTURE_VAULT_PATH, vaultPath, { recursive: true });
    await fs.writeFile(path.join(vaultPath, TEST_FILE_NAME), TEST_CONTENT, 'utf8');

    const projectsPath = path.join(tempUserDataPath, 'projects.json');
    const savedProject = {
      id: 'table-rendering-project-id',
      path: watchedFolder,
      name: 'table-rendering-project',
      type: 'folder',
      lastOpened: Date.now(),
      voicetreeInitialized: true
    };
    await fs.writeFile(projectsPath, JSON.stringify([savedProject], null, 2), 'utf8');

    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: watchedFolder }, null, 2), 'utf8');

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
        VOICETREE_PERSIST_STATE: '1'
      },
      timeout: 15000
    });

    await use(electronApp);

    try {
      const page = await electronApp.firstWindow();
      await page.evaluate(async () => {
        const api = (window as ExtendedWindow).electronAPI;
        if (api) {
          await api.main.stopFileWatching();
        }
      });
      await page.waitForTimeout(300);
    } catch {
      console.log('Note: Could not stop file watching during cleanup');
    }

    await electronApp.close();
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  }, { timeout: 45000 }],

  appWindow: [async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();

    page.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    page.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
      console.error('Stack:', error.stack);
    });

    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('text=Recent Projects', { timeout: 10000 });
    await page.locator('button:has-text("table-rendering-project")').first().click();
    await page.waitForFunction(() => (window as ExtendedWindow).cytoscapeInstance, { timeout: 15000 });
    await page.waitForTimeout(1000);

    await use(page);
  }, { timeout: 30000 }]
});

test.describe('Markdown table rendering', () => {
  test('should render tables in floating editors and preserve edit-mode toggling', async ({ appWindow }) => {
    test.setTimeout(45000);

    const resolveFixtureNodeId = async (): Promise<string | null> => {
      return appWindow.evaluate(async ({ expectedLabel, expectedFileName }) => {
        const api = (window as ExtendedWindow).electronAPI;
        if (!api) return null;

        const graph = await api.main.getGraph();
        if (!graph) return null;

        for (const [id, node] of Object.entries(graph.nodes)) {
          if (id.endsWith(expectedFileName) || node.label === expectedLabel) {
            return id;
          }
        }

        return null;
      }, {
        expectedLabel: TEST_NODE_LABEL,
        expectedFileName: TEST_FILE_NAME
      });
    };

    await expect.poll(async () => {
      return (await resolveFixtureNodeId()) !== null;
    }, {
      message: 'Waiting for table-rendering fixture node to load',
      timeout: 20000
    }).toBe(true);

    const resolvedNodeId = await resolveFixtureNodeId();
    expect(resolvedNodeId).not.toBeNull();

    await appWindow.evaluate((nodeId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById(nodeId);
      if (node.length === 0) throw new Error(`Node ${nodeId} not found`);
      node.trigger('tap');
    }, resolvedNodeId);

    const editorWindowId = `window-${resolvedNodeId}-editor`;

    await expect.poll(async () => {
      return appWindow.evaluate((winId) => !!document.getElementById(winId), editorWindowId);
    }, {
      message: 'Waiting for editor window to open',
      timeout: 5000
    }).toBe(true);

    await expect.poll(async () => {
      return appWindow.evaluate((winId) => {
        const escapedWinId = CSS.escape(winId);
        return !!document.querySelector(`#${escapedWinId} .cm-markdoc-renderBlock table`);
      }, editorWindowId);
    }, {
      message: 'Waiting for rendered table widget',
      timeout: 5000
    }).toBe(true);

    const renderedState = await appWindow.evaluate((winId) => {
      const escapedWinId = CSS.escape(winId);
      const table = document.querySelector(`#${escapedWinId} .cm-markdoc-renderBlock table`);
      const blockquote = document.querySelector(`#${escapedWinId} .cm-markdoc-renderBlock blockquote`);

      return {
        hasTable: !!table,
        hasBlockquote: !!blockquote,
        tableText: table?.textContent ?? '',
        blockquoteText: blockquote?.textContent ?? ''
      };
    }, editorWindowId);

    expect(renderedState.hasTable).toBe(true);
    expect(renderedState.tableText).toContain('Alpha');
    expect(renderedState.hasBlockquote).toBe(true);
    expect(renderedState.blockquoteText).toContain('Existing blockquote rendering should still work.');

    await appWindow.locator(`[id="${editorWindowId}"]`).screenshot({
      path: 'e2e-tests/screenshots/markdown-table-rendered.png'
    });

    await appWindow.evaluate((winId) => {
      const escapedWinId = CSS.escape(winId);
      const editorElement = document.querySelector(`#${escapedWinId} .cm-content`) as CodeMirrorElement | null;
      const cmView = editorElement?.cmView?.view;
      if (!cmView) throw new Error('CodeMirror view not found');

      const doc = cmView.state.doc.toString();
      const tableStart = doc.indexOf('| Name | Value |');
      if (tableStart < 0) throw new Error('Table markdown not found in editor doc');

      cmView.dispatch({
        selection: { anchor: tableStart + 2 }
      });
    }, editorWindowId);

    await expect.poll(async () => {
      return appWindow.evaluate((winId) => {
        const escapedWinId = CSS.escape(winId);
        const hasRenderedTable = !!document.querySelector(`#${escapedWinId} .cm-markdoc-renderBlock table`);
        const editorElement = document.querySelector(`#${escapedWinId} .cm-content`) as HTMLElement | null;

        return {
          hasRenderedTable,
          rawMarkdownVisible: editorElement?.textContent?.includes('| Name | Value |') ?? false
        };
      }, editorWindowId);
    }, {
      message: 'Waiting for raw markdown table view when cursor enters table',
      timeout: 5000
    }).toEqual({
      hasRenderedTable: false,
      rawMarkdownVisible: true
    });

    await appWindow.locator(`[id="${editorWindowId}"]`).screenshot({
      path: 'e2e-tests/screenshots/markdown-table-raw-editing.png'
    });

    await appWindow.evaluate((winId) => {
      const escapedWinId = CSS.escape(winId);
      const editorElement = document.querySelector(`#${escapedWinId} .cm-content`) as CodeMirrorElement | null;
      const cmView = editorElement?.cmView?.view;
      if (!cmView) throw new Error('CodeMirror view not found');

      cmView.dispatch({
        selection: { anchor: 1 }
      });
    }, editorWindowId);

    await expect.poll(async () => {
      return appWindow.evaluate((winId) => {
        const escapedWinId = CSS.escape(winId);
        return !!document.querySelector(`#${escapedWinId} .cm-markdoc-renderBlock table`);
      }, editorWindowId);
    }, {
      message: 'Waiting for rendered table to return after cursor leaves table',
      timeout: 5000
    }).toBe(true);
  });
});

export { test };
