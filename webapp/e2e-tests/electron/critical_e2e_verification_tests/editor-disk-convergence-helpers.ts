import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type { EditorView } from '@codemirror/view';
import type { Core as CytoscapeCore, EdgeSingular } from 'cytoscape';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ElectronAPI } from '@/shell/electron';
import {
  getCiElectronFlags,
  pollForCondition,
  pollForCytoscape,
  pollForCytoscapeNodes,
  resolveGraphDaemonNodeBin,
  robustElectronTeardown,
  safeStopFileWatching,
} from './electron-smoke-helpers';

const PROJECT_ROOT = path.resolve(process.cwd());

export const PARENT_TITLE = 'Convergence Target';
export const PARENT_FILENAME = `${PARENT_TITLE}.md`;
export const INITIAL_PARENT_CONTENT = `# ${PARENT_TITLE}\n\nInitial body.\n`;

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

async function seedProject(projectPath: string): Promise<string> {
  const writeFolder = path.join(projectPath, 'voicetree');
  await fs.mkdir(writeFolder, { recursive: true });
  await fs.mkdir(path.join(projectPath, '.voicetree'), { recursive: true });
  await fs.writeFile(path.join(writeFolder, PARENT_FILENAME), INITIAL_PARENT_CONTENT, 'utf8');
  await fs.writeFile(
    path.join(projectPath, '.voicetree', 'positions.json'),
    JSON.stringify({ [PARENT_FILENAME]: { x: 120, y: 120 } }, null, 2),
    'utf8',
  );
  return writeFolder;
}

export const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  projectPath: string;
  writeFolder: string;
}>({
  projectPath: async ({}, use) => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-editor-disk-conv-'));
    await use(projectPath);
    await fs.rm(projectPath, { recursive: true, force: true });
  },

  writeFolder: async ({ projectPath }, use) => {
    const writeFolder = await seedProject(projectPath);
    await use(writeFolder);
  },

  electronApp: async ({ projectPath, writeFolder }, use) => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-editor-disk-conv-app-'));
    await fs.writeFile(
      path.join(userDataPath, 'projects.json'),
      JSON.stringify([{
        id: 'editor-disk-convergence',
        path: projectPath,
        name: path.basename(projectPath),
        type: 'folder',
        lastOpened: Date.now(),
        voicetreeInitialized: true,
      }], null, 2),
      'utf8',
    );
    await fs.writeFile(
      path.join(userDataPath, 'voicetree-config.json'),
      JSON.stringify({
        lastDirectory: projectPath,
        vaultConfig: { [projectPath]: { writeFolder, readPaths: [] } },
      }, null, 2),
      'utf8',
    );

    const electronApp = await electron.launch({
      args: [
        ...getCiElectronFlags(),
        '--remote-debugging-port=0',
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${userDataPath}`,
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ENABLE_PLAYWRIGHT_DEBUG: '0',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
        VOICETREE_PERSIST_STATE: '1',
        VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(),
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

    let autoLoaded = false;
    try {
      await pollForCytoscape(window, 3_000);
      autoLoaded = true;
    } catch {
      // Fall through to manual project selection.
    }
    if (!autoLoaded) {
      await window.waitForSelector('text=Recent Projects', { timeout: 10_000 });
      await window.locator(`button:has-text("${path.basename(projectPath)}")`).first().click();
      const watchResult = await window.evaluate(async (dir) => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (!api) throw new Error('electronAPI not available');
        return await api.main.startFileWatching(dir);
      }, projectPath);
      expect(watchResult.success, 'startFileWatching failed').toBe(true);
    }

    await pollForCytoscape(window, 30_000);
    await pollForCytoscapeNodes(window, 1, 20_000);
    await pollForCondition(window, async () => {
      return await window.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        const bodyText = document.body.textContent ?? '';
        return Boolean((cy?.nodes().length ?? 0) >= 1 && !bodyText.includes('Loading Voicetree'));
      });
    }, 'Waiting for graph view to settle', 10_000);
    await window.waitForTimeout(1_000);
    await use(window);
  },
});

export async function waitForNode(page: Page, label: string, timeout = 10_000): Promise<void> {
  await expect.poll(async () => {
    return page.evaluate((lbl) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      return Boolean(cy?.nodes().some((n) => n.data('label') === lbl));
    }, label);
  }, { message: `Waiting for node "${label}"`, timeout, intervals: [250, 500, 1000, 2000] }).toBe(true);
}

export async function openEditorForLabel(
  page: Page,
  label: string,
): Promise<{ nodeId: string; editorWindowId: string; nodeCountBefore: number }> {
  await waitForNode(page, label);
  const { nodeId, nodeCountBefore } = await page.evaluate((lbl) => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not initialized');
    const target = cy.nodes().find((n) => n.data('label') === lbl);
    if (!target) throw new Error(`Node with label "${lbl}" not found`);
    target.select();
    target.trigger('tap');
    return { nodeId: target.id(), nodeCountBefore: cy.nodes().length };
  }, label);

  const editorWindowId = `window-${nodeId}-editor`;
  await page.locator(`${idSelector(editorWindowId)} .cm-content`).waitFor({ state: 'visible', timeout: 5_000 });
  await focusEditor(page, editorWindowId);
  return { nodeId, editorWindowId, nodeCountBefore };
}

export async function focusEditor(page: Page, editorWindowId: string): Promise<void> {
  await expect.poll(async () => {
    return page.evaluate((winId) => {
      document.getElementById(winId)?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      const editorElement = document.querySelector(`#${CSS.escape(winId)} .cm-content`) as CodeMirrorElement | null;
      editorElement?.cmView?.view.focus();
      return document.activeElement === editorElement
        || Boolean(document.activeElement?.closest('.cm-editor'));
    }, editorWindowId);
  }, { message: 'Waiting for CodeMirror editor focus', timeout: 5_000 }).toBe(true);
}

export async function readEditorText(page: Page, editorWindowId: string): Promise<string | null> {
  return page.evaluate((winId) => {
    const editorElement = document.querySelector(`#${CSS.escape(winId)} .cm-content`) as CodeMirrorElement | null;
    return editorElement?.cmView?.view.state.doc.toString() ?? null;
  }, editorWindowId);
}

export async function selectAllInEditor(page: Page): Promise<void> {
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+A`);
}

export async function replaceEditorContentWithKeyboard(
  page: Page,
  editorWindowId: string,
  content: string,
): Promise<void> {
  await selectAllInEditor(page);
  await page.keyboard.type(content, { delay: 1 });
  await expect.poll(async () => readEditorText(page, editorWindowId), {
    message: 'Waiting for keyboard input to reach the editor buffer',
    timeout: 3_000,
    intervals: [25, 50, 100, 200],
  }).toBe(content);
}

function seededDelay(seed: number, minMs = 5, maxMs = 500): number {
  const value = Math.sin(seed) * 10_000;
  const fraction = value - Math.floor(value);
  return Math.round(minMs + fraction * (maxMs - minMs));
}

export async function typeCharByCharVerifyingPrefix(
  page: Page,
  editorWindowId: string,
  content: string,
): Promise<void> {
  for (let i = 0; i < content.length; i++) {
    const character = content[i];
    await page.evaluate((winId) => {
      document.getElementById(winId)?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    }, editorWindowId);
    if (character === '\n') {
      await page.keyboard.press('Enter');
    } else {
      await page.keyboard.insertText(character);
    }
    await page.waitForTimeout(seededDelay(i + 1));
    if (character === ' ') {
      await page.waitForTimeout(seededDelay(10_000 + i));
    }
    const expectedPrefix = content.slice(0, i + 1);
    await expect.poll(async () => {
      return page.evaluate((winId) => {
        const el = document.querySelector(`#${CSS.escape(winId)} .cm-content`) as CodeMirrorElement | null;
        return el?.innerText?.replace(/\n$/, '') ?? null;
      }, editorWindowId);
    }, {
      message: `Waiting for editor to preserve typed prefix at char ${i + 1}`,
      timeout: 5_000,
    }).toBe(expectedPrefix);
  }
}

export async function closeEditorWindow(page: Page, editorWindowId: string): Promise<void> {
  await page.evaluate((winId) => {
    document.getElementById(winId)?.dispatchEvent(new CustomEvent('traffic-light-close', { bubbles: true }));
  }, editorWindowId);
}

export async function closeAllTerminalWindows(page: Page): Promise<void> {
  await page.locator('.cy-floating-window-terminal').first().waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
  await page.locator('.cy-floating-window-terminal .terminal-relay-status').first().waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
  await page.evaluate(async () => {
    const api = (window as unknown as ExtendedWindow).electronAPI;
    const terminalWindows = Array.from(document.querySelectorAll<HTMLElement>('.cy-floating-window-terminal'));
    const terminalIds = terminalWindows
      .map((tw) => tw.dataset.floatingWindowId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    await Promise.all(terminalIds.map((id) => api?.main.closeHeadlessAgent(id).catch(() => undefined)));
    terminalWindows.forEach((tw) => {
      tw.dispatchEvent(new CustomEvent('traffic-light-close', { bubbles: true }));
    });
  });
  await expect.poll(async () => {
    return page.evaluate(() => document.querySelectorAll('.cy-floating-window-terminal').length);
  }, {
    message: 'Waiting for spawned agent terminal windows to close',
    timeout: 10_000,
    intervals: [100, 250, 500, 1000],
  }).toBe(0);
}

export async function configureNoopAgent(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const api = (window as unknown as ExtendedWindow).electronAPI;
    if (!api) throw new Error('electronAPI not available');
    const currentSettings = await api.main.loadSettings();
    await api.main.saveSettings({
      ...currentSettings,
      defaultAgent: 'Noop Test Agent',
      agentPermissionModeChosen: true,
      agents: [{ name: 'Noop Test Agent', command: 'printf context-snapshot-test; exit' }],
    });
  });
}

export async function syncRendererSessionStateWithDaemon(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const api = (window as unknown as ExtendedWindow).electronAPI;
    await api?.main.syncRendererSessionStateWithDaemon();
  });
}

export async function expectDiskMatches(
  writeFolder: string,
  filename: string,
  expected: string,
  timeout = 15_000,
): Promise<void> {
  await expect.poll(async () => {
    return fs.readFile(path.join(writeFolder, filename), 'utf8');
  }, {
    message: `Waiting for ${filename} on disk to match expected content`,
    timeout,
    intervals: [200, 500, 1000, 2000],
  }).toBe(expected);
}

export async function expectDiskContainsAll(
  writeFolder: string,
  filename: string,
  fragments: readonly string[],
  timeout = 15_000,
): Promise<void> {
  await expect.poll(async () => {
    const content = await fs.readFile(path.join(writeFolder, filename), 'utf8');
    return fragments.every((frag) => content.includes(frag));
  }, {
    message: `Waiting for ${filename} on disk to contain [${fragments.join(', ')}]`,
    timeout,
    intervals: [200, 500, 1000, 2000],
  }).toBe(true);
}

export async function expectEditorMatches(
  page: Page,
  editorWindowId: string,
  expected: string,
  timeout = 15_000,
): Promise<void> {
  await expect.poll(async () => readEditorText(page, editorWindowId), {
    message: 'Waiting for editor content to match expected',
    timeout,
    intervals: [250, 500, 1000, 2000],
  }).toBe(expected);
}

export async function expectEditorContainsAll(
  page: Page,
  editorWindowId: string,
  fragments: readonly string[],
  timeout = 15_000,
): Promise<void> {
  await expect.poll(async () => {
    const text = await readEditorText(page, editorWindowId);
    if (text === null) return false;
    return fragments.every((frag) => text.includes(frag));
  }, {
    message: `Waiting for editor to contain [${fragments.join(', ')}]`,
    timeout,
    intervals: [250, 500, 1000, 2000],
  }).toBe(true);
}

export async function expectGraphHasEdgeTo(
  page: Page,
  sourceNodeId: string,
  targetLabel: string,
  timeout = 10_000,
): Promise<void> {
  await expect.poll(async () => {
    return page.evaluate(({ sId, tLabel }) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return false;
      const source = cy.getElementById(sId);
      const target = cy.nodes().find((n) => n.data('label') === tLabel);
      if (!target) return false;
      const targetId = target.id();
      return source.connectedEdges().some((e: EdgeSingular) => {
        return (e.source().id() === sId && e.target().id() === targetId)
          || (e.source().id() === targetId && e.target().id() === sId);
      });
    }, { sId: sourceNodeId, tLabel: targetLabel });
  }, {
    message: `Waiting for graph edge ${sourceNodeId} ↔ "${targetLabel}"`,
    timeout,
    intervals: [250, 500, 1000, 2000],
  }).toBe(true);
}

export async function expectNodeCountIncreasedAbove(
  page: Page,
  previousCount: number,
  timeout = 15_000,
): Promise<void> {
  await expect.poll(async () => {
    return page.evaluate((prev) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      return cy?.nodes().length ?? prev;
    }, previousCount);
  }, {
    message: `Waiting for cytoscape node count to grow above ${previousCount}`,
    timeout,
    intervals: [100, 250, 500, 1000],
  }).toBeGreaterThan(previousCount);
}

export async function expectDaemonNodeContains(
  page: Page,
  nodeId: string,
  fragment: string,
  timeout = 10_000,
): Promise<void> {
  await expect.poll(async () => {
    return page.evaluate(async ({ id }) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      const node = await api?.main.getNode(id);
      return node?.contentWithoutYamlOrLinks ?? null;
    }, { id: nodeId });
  }, {
    message: `Waiting for daemon node ${nodeId} content to contain "${fragment}"`,
    timeout,
    intervals: [100, 250, 500, 1000],
  }).toContain(fragment);
}

export async function expectContextNodeContains(
  writeFolder: string,
  fragment: string,
  timeout = 15_000,
): Promise<void> {
  await expect.poll(async () => {
    const contextDir = path.join(writeFolder, 'ctx-nodes');
    let entries: string[] = [];
    try {
      entries = await fs.readdir(contextDir);
    } catch {
      return '';
    }
    const contents = await Promise.all(
      entries
        .filter((e) => e.endsWith('.md'))
        .map((e) => fs.readFile(path.join(contextDir, e), 'utf8')),
    );
    return contents.join('\n');
  }, {
    message: `Waiting for ctx-nodes/ to contain "${fragment}"`,
    timeout,
    intervals: [100, 250, 500, 1000],
  }).toContain(fragment);
}

export { expect };
