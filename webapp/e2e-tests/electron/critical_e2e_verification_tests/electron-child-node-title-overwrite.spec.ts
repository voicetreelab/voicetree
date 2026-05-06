/**
 * Regression test: creating a child node (cmd-n) must not overwrite
 * the parent node's unsaved title.
 *
 * Scenario:
 * 1. Open a node, type a title in its editor
 * 2. Before autosave fires (~300ms debounce), press cmd-n to create a child
 * 3. The parent's title must survive — both in graph model and on disk
 * 4. The wikilink edge to the child must also survive
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type { EditorView } from '@codemirror/view';
import type { Core as CytoscapeCore } from 'cytoscape';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ElectronAPI } from '@/shell/electron';

const PROJECT_ROOT = path.resolve(process.cwd());

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

interface CodeMirrorElement extends HTMLElement {
  cmView?: { view: EditorView };
}

function idSelector(id: string): string {
  return `[id="${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

async function seedVault(vaultPath: string): Promise<void> {
  await fs.mkdir(vaultPath, { recursive: true });
  await fs.writeFile(
    path.join(vaultPath, 'parent-node.md'),
    '# \n',
    'utf8',
  );
}

function resolveGraphdNodeBin(): string | undefined {
  const requiredModules = process.versions.modules;
  const candidates: readonly string[] = [
    process.env.VT_GRAPHD_NODE_BIN,
    process.env.npm_node_execpath,
    process.execPath,
    ...((process.env.PATH ?? '').split(path.delimiter).map((entry) => path.join(entry, 'node'))),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => {
    if (!existsSync(candidate)) return false;
    try {
      return execFileSync(candidate, ['-p', 'process.versions.modules'], { encoding: 'utf8' }).trim() === requiredModules;
    } catch {
      return false;
    }
  }) ?? process.env.VT_GRAPHD_NODE_BIN ?? process.env.npm_node_execpath ?? process.execPath;
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  vaultPath: string;
}>({
  vaultPath: async ({}, use) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-child-title-'));
    const vaultPath = path.join(tempRoot, 'vault');
    await seedVault(vaultPath);
    await use(vaultPath);
    await fs.rm(tempRoot, { recursive: true, force: true });
  },

  electronApp: async ({ vaultPath }, use) => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-child-title-app-'));
    const savedProject = {
      id: 'child-title-overwrite-regression',
      path: vaultPath,
      name: 'child-title-test',
      type: 'folder',
      lastOpened: Date.now(),
      voicetreeInitialized: true,
    };

    await fs.writeFile(path.join(userDataPath, 'projects.json'), JSON.stringify([savedProject], null, 2), 'utf8');
    await fs.writeFile(
      path.join(userDataPath, 'voicetree-config.json'),
      JSON.stringify({
        vaultConfig: {
          [vaultPath]: {
            writePath: vaultPath,
            readPaths: [],
          },
        },
      }, null, 2),
      'utf8',
    );

    const electronApp = await electron.launch({
      args: [
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
      timeout: 30_000,
    });

    await use(electronApp);

    try {
      const window = await electronApp.firstWindow();
      await window.evaluate(async () => {
        await (window as unknown as ExtendedWindow).electronAPI?.main.stopFileWatching();
      });
    } catch {
      // App may already be closed
    }
    await electronApp.close();
    await fs.rm(userDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp, vaultPath }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15_000 });
    await window.waitForLoadState('domcontentloaded');

    // Use startFileWatching directly (more reliable than clicking project button)
    try {
      await window.waitForSelector('text=Recent Projects', { timeout: 5_000 });
      await window.locator('button:has-text("child-title-test")').first().click();
    } catch {
      await window.evaluate(async (vault: string) => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (!api) throw new Error('electronAPI not available');
        await api.main.startFileWatching(vault);
      }, vaultPath);
    }

    await window.waitForFunction(
      () => Boolean((window as unknown as ExtendedWindow).cytoscapeInstance),
      undefined,
      { timeout: 15_000 },
    );

    await expect.poll(async () => {
      return window.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        return cy?.nodes().length ?? 0;
      });
    }, {
      message: 'Waiting for graph nodes',
      timeout: 30_000,
      intervals: [500, 1000, 2000],
    }).toBeGreaterThanOrEqual(1);

    await window.waitForTimeout(1_000);
    await use(window);
  },
});

test.describe.configure({ timeout: 90_000 });

test('parent node title survives rapid child creation via cmd-n', async ({ appWindow, vaultPath }) => {
  // 1. Find, select, and tap the parent node to open its editor
  const nodeId = await appWindow.evaluate(() => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not initialized');
    const target = cy.nodes().first();
    if (!target || target.length === 0) {
      throw new Error(`No nodes in graph. Node count: ${cy.nodes().length}`);
    }
    target.select();
    target.trigger('tap');
    return target.id();
  });

  const editorWindowId = `window-${nodeId}-editor`;
  const editorContent = appWindow.locator(`${idSelector(editorWindowId)} .cm-content`);
  await editorContent.waitFor({ state: 'visible', timeout: 10_000 });

  // 2. Focus the editor
  await expect.poll(async () => {
    return appWindow.evaluate((winId) => {
      const windowElement = document.getElementById(winId);
      windowElement?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      const editorElement = document.querySelector(`#${CSS.escape(winId)} .cm-content`) as CodeMirrorElement | null;
      return document.activeElement === editorElement
        || Boolean(document.activeElement?.closest('.cm-editor'));
    }, editorWindowId);
  }, {
    message: 'Waiting for CodeMirror editor focus',
    timeout: 5_000,
  }).toBe(true);

  // 3. Set title content via CodeMirror dispatch with userEvent (arms autosave debounce)
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  const typedTitle = '# My Important Title';

  await appWindow.evaluate(({ winId, content }) => {
    const editorElement = document.querySelector(`#${CSS.escape(winId)} .cm-content`) as CodeMirrorElement | null;
    if (!editorElement?.cmView?.view) throw new Error('CodeMirror view not found');
    const view = editorElement.cmView.view;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
      userEvent: 'input',
    });
  }, { winId: editorWindowId, content: typedTitle });

  await expect.poll(async () => {
    return appWindow.evaluate((winId) => {
      const editorElement = document.querySelector(`#${CSS.escape(winId)} .cm-content`) as CodeMirrorElement | null;
      return editorElement?.cmView?.view.state.doc.toString() ?? null;
    }, editorWindowId);
  }, {
    message: 'Waiting for typed title in editor',
    timeout: 3_000,
  }).toBe(typedTitle);

  // 4. Create a child node via IPC (same write path as cmd-n) — BEFORE autosave fires.
  //    We use the IPC API directly because Electron's default menu intercepts cmd-n
  //    in headless test mode. The race condition being tested is in the write path,
  //    not the keyboard shortcut.
  const childNodeId = await appWindow.evaluate(async (parentId) => {
    const api = (window as unknown as ExtendedWindow).electronAPI;
    if (!api) throw new Error('electronAPI not available');

    const graph = await api.main.getGraph();
    const parentNode = graph.nodes[parentId];
    if (!parentNode) throw new Error(`Parent node ${parentId} not found in graph`);

    const childId = parentId.replace(/\.md$/, '') + '_0.md';
    const delta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          kind: 'leaf' as const,
          absoluteFilePathIsID: childId,
          outgoingEdges: [],
          contentWithoutYamlOrLinks: '# ',
          nodeUIMetadata: {
            color: { _tag: 'None' },
            position: { _tag: 'Some', value: { x: 300, y: 300 } },
            additionalYAMLProps: new Map(),
            isContextNode: false,
          },
        },
        previousNode: { _tag: 'None' },
      },
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          ...parentNode,
          outgoingEdges: [...parentNode.outgoingEdges, { targetId: childId }],
        },
        previousNode: { _tag: 'Some', value: parentNode },
      },
    ];

    await api.main.applyGraphDeltaToDBThroughMemUIAndEditorExposed(delta);
    return childId;
  }, nodeId);

  // 5. Wait for the child node to appear in the graph
  await expect.poll(async () => {
    return appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      return cy?.nodes().length ?? 0;
    });
  }, {
    message: 'Waiting for child node to appear in graph',
    timeout: 10_000,
  }).toBeGreaterThanOrEqual(2);

  // 6. Allow autosave + file watcher to settle
  await appWindow.waitForTimeout(2_000);

  // 7. CRITICAL: Parent node in graph model still has the title
  const parentGraphContent = await appWindow.evaluate(async (nId) => {
    const api = (window as unknown as ExtendedWindow).electronAPI;
    if (!api) throw new Error('electronAPI not available');
    const graph = await api.main.getGraph();
    const node = graph.nodes[nId];
    return node?.contentWithoutYamlOrLinks ?? null;
  }, nodeId);

  expect(parentGraphContent).toContain('My Important Title');

  // 8. CRITICAL: Parent file on disk still has the title
  const parentFilePath = path.join(vaultPath, 'parent-node.md');
  const diskContent = await fs.readFile(parentFilePath, 'utf8');
  expect(diskContent).toContain('My Important Title');

  // 9. CRITICAL: Parent editor still has the title
  const editorText = await appWindow.evaluate((winId) => {
    const editorElement = document.querySelector(`#${CSS.escape(winId)} .cm-content`) as CodeMirrorElement | null;
    return editorElement?.cmView?.view.state.doc.toString() ?? null;
  }, editorWindowId);
  expect(editorText).toContain('My Important Title');

  // 10. Wikilink edge to child exists in graph
  const parentEdges = await appWindow.evaluate(async (nId) => {
    const api = (window as unknown as ExtendedWindow).electronAPI;
    if (!api) throw new Error('electronAPI not available');
    const graph = await api.main.getGraph();
    const node = graph.nodes[nId];
    return node?.outgoingEdges?.length ?? 0;
  }, nodeId);
  expect(parentEdges).toBeGreaterThanOrEqual(1);

  // 11. Wikilink edge is also on disk
  expect(diskContent).toMatch(/\[\[.*\]\]/);
});
