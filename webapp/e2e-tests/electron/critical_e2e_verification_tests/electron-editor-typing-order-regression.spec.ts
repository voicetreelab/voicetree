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

function idSelector(id: string): string {
  return `[id="${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

function seededDelay(seed: number, minMs = 5, maxMs = 500): number {
  const value = Math.sin(seed) * 10_000;
  const fraction = value - Math.floor(value);
  return Math.round(minMs + fraction * (maxMs - minMs));
}

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

interface CodeMirrorElement extends HTMLElement {
  cmView?: { view: EditorView };
}

async function seedProject(projectPath: string): Promise<string> {
  const writePath = path.join(projectPath, 'voicetree');
  await fs.mkdir(writePath, { recursive: true });
  await fs.mkdir(path.join(projectPath, '.voicetree'), { recursive: true });
  await fs.writeFile(
    path.join(writePath, 'Typing Target.md'),
    '# Typing Target\n\nInitial content that will be replaced.\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(projectPath, '.voicetree', 'positions.json'),
    JSON.stringify({ 'Typing Target.md': { x: 100, y: 100 } }, null, 2),
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
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-editor-order-'));
    await use(projectPath);
    await fs.rm(projectPath, { recursive: true, force: true });
  },

  writePath: async ({ projectPath }, use) => {
    const writePath = await seedProject(projectPath);
    await use(writePath);
  },

  electronApp: async ({ projectPath, writePath }, use) => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-editor-order-app-'));
    const savedProject = {
      id: 'editor-typing-order-regression',
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
    await electronApp.close();
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

test.describe.configure({ timeout: 75_000 });

test('preserves character-by-character editor typing after autosave and file watcher settle', async ({ appWindow, writePath }) => {
  const nodeId = await appWindow.evaluate(() => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not initialized');
    const target = cy.nodes().find((node) => node.data('label') === 'Typing Target');
    if (!target) throw new Error('Typing Target node not found');
    target.trigger('tap');
    return target.id();
  });

  const editorWindowId = `window-${nodeId}-editor`;
  await appWindow.waitForSelector(`${idSelector(editorWindowId)} .cm-content`, { timeout: 5_000 });

  await appWindow.evaluate((winId) => {
    const editorElement = document.querySelector(`#${CSS.escape(winId)} .cm-content`) as CodeMirrorElement | null;
    const view = editorElement?.cmView?.view;
    if (!view) throw new Error('CodeMirror view not found');
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
    view.focus();
  }, editorWindowId);

  await expect.poll(async () => {
    return appWindow.evaluate((winId) => {
      const editorElement = document.querySelector(`#${CSS.escape(winId)} .cm-content`) as CodeMirrorElement | null;
      const view = editorElement?.cmView?.view;
      if (!view) return null;
      const selection = view.state.selection.main;
      const editorFocused = document.activeElement === editorElement
        || Boolean(document.activeElement?.closest('.cm-editor'));
      return editorFocused && selection.from === 0 && selection.to === view.state.doc.length;
    }, editorWindowId);
  }, {
    message: 'Waiting for focused CodeMirror selection to cover the document',
    timeout: 5_000,
  }).toBe(true);

  const expectedContent = [
    'random saves should stay ordered',
    'across a couple of lines',
    'without moving letters around',
  ].join('\n');

  for (let i = 0; i < expectedContent.length; i++) {
    const character = expectedContent[i];
    await appWindow.keyboard.type(character);
    await appWindow.waitForTimeout(seededDelay(i + 1));

    if (character === ' ') {
      await appWindow.waitForTimeout(seededDelay(10_000 + i));
    }

    const expectedPrefix = expectedContent.slice(0, i + 1);
    await expect.poll(async () => {
      return appWindow.evaluate((winId) => {
        const editorElement = document.querySelector(`#${CSS.escape(winId)} .cm-content`) as CodeMirrorElement | null;
        return editorElement?.cmView?.view.state.doc.toString() ?? null;
      }, editorWindowId);
    }, {
      message: `Waiting for editor to preserve typed prefix through autosave cycle ${i + 1}`,
      timeout: 5_000,
    }).toBe(expectedPrefix);
  }

  await expect.poll(async () => {
    return appWindow.evaluate((winId) => {
      const editorElement = document.querySelector(`#${CSS.escape(winId)} .cm-content`) as CodeMirrorElement | null;
      return editorElement?.cmView?.view.state.doc.toString() ?? null;
    }, editorWindowId);
  }, {
    message: 'Waiting for CodeMirror to contain the exact typed document',
    timeout: 5_000,
  }).toBe(expectedContent);

  await appWindow.waitForTimeout(1_000);

  const settled = await appWindow.evaluate((winId) => {
    const editorElement = document.querySelector(`#${CSS.escape(winId)} .cm-content`) as CodeMirrorElement | null;
    return editorElement?.cmView?.view.state.doc.toString() ?? null;
  }, editorWindowId);
  expect(settled).toBe(expectedContent);

  const savedContent = await fs.readFile(path.join(writePath, 'Typing Target.md'), 'utf8');
  expect(savedContent).toContain(expectedContent);
  expect(savedContent).toMatch(/^---\n/);
});
