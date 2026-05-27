import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type { Core as CytoscapeCore } from 'cytoscape';
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
import {
  focusEditorInstance,
  getEditorInstanceId,
  readEditorValue,
  tryReadEditorValue,
  waitForEditorInstance,
} from './helpers/editor-instance';

const PROJECT_ROOT = path.resolve(process.cwd());
const PARENT_FILENAME = 'Parent Node.md';
const PARENT_TITLE = 'Parent Node';
const TYPED_MARKER = 'unsaved edit survives cmd n 48291';
const EXPECTED_PARENT_CONTENT = `# ${PARENT_TITLE}\n\n${TYPED_MARKER}\n`;
const CONTEXT_MARKER = 'agent context sees immediate edit 93017';
const EXPECTED_CONTEXT_PARENT_CONTENT = `# ${PARENT_TITLE}\n\n${CONTEXT_MARKER}\n`;

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

function idSelector(id: string): string {
  return `[id="${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

async function seedProject(projectPath: string): Promise<string> {
  const writeFolder = path.join(projectPath, 'voicetree');
  await fs.mkdir(writeFolder, { recursive: true });
  await fs.mkdir(path.join(projectPath, '.voicetree'), { recursive: true });
  await fs.writeFile(
    path.join(writeFolder, PARENT_FILENAME),
    `# ${PARENT_TITLE}\n\nOriginal body.\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(projectPath, '.voicetree', 'positions.json'),
    JSON.stringify({ [PARENT_FILENAME]: { x: 120, y: 120 } }, null, 2),
    'utf8',
  );
  return writeFolder;
}

async function focusEditor(page: Page, editorWindowId: string, editorInstanceId: string): Promise<void> {
  await focusEditorInstance(page, editorInstanceId);
  await expect.poll(async () => {
    return page.evaluate((winId) => {
      const windowElement = document.getElementById(winId);
      windowElement?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      const editorElement = document.querySelector(`#${CSS.escape(winId)} .cm-content`);
      return document.activeElement === editorElement ||
        Boolean(document.activeElement?.closest('.cm-editor'));
    }, editorWindowId);
  }, {
    message: 'Waiting for CodeMirror editor focus',
    timeout: 5_000,
    intervals: [50, 100, 250, 500],
  }).toBe(true);
}

async function closeEditorWindow(page: Page, editorWindowId: string): Promise<void> {
  await page.evaluate((winId) => {
    document.getElementById(winId)?.dispatchEvent(new CustomEvent('traffic-light-close', { bubbles: true }));
  }, editorWindowId);
}

async function closeAllTerminalWindows(page: Page): Promise<void> {
  await page.locator('.cy-floating-window-terminal').first().waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  await page.locator('.cy-floating-window-terminal .terminal-relay-status').first().waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  await page.evaluate(async () => {
    const api = (window as unknown as ExtendedWindow).electronAPI;
    const terminalWindows = Array.from(document.querySelectorAll<HTMLElement>('.cy-floating-window-terminal'));
    const terminalIds = terminalWindows
      .map(terminalWindow => terminalWindow.dataset.floatingWindowId)
      .filter((terminalId): terminalId is string => typeof terminalId === 'string' && terminalId.length > 0);

    await Promise.all(terminalIds.map(terminalId => api?.main.closeHeadlessAgent(terminalId).catch(() => undefined)));
    terminalWindows.forEach((terminalWindow) => {
      terminalWindow.dispatchEvent(new CustomEvent('traffic-light-close', { bubbles: true }));
    });
  });

  await expect.poll(async () => {
    return await page.evaluate(() => document.querySelectorAll('.cy-floating-window-terminal').length);
  }, {
    message: 'Waiting for spawned agent terminal windows to close',
    timeout: 10_000,
    intervals: [100, 250, 500, 1000],
  }).toBe(0);
}

async function readContextNodeFiles(writeFolder: string): Promise<string> {
  const contextDir = path.join(writeFolder, 'ctx-nodes');
  let entries: string[] = [];
  try {
    entries = await fs.readdir(contextDir);
  } catch {
    return '';
  }

  const contents = await Promise.all(
    entries
      .filter(entry => entry.endsWith('.md'))
      .map(async entry => fs.readFile(path.join(contextDir, entry), 'utf8')),
  );
  return contents.join('\n\n--- context file boundary ---\n\n');
}

async function openParentEditor(page: Page): Promise<{ readonly nodeId: string; readonly nodeCountBefore: number; readonly editorWindowId: string; readonly editorInstanceId: string }> {
  await expect.poll(async () => {
    return await page.evaluate((label) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      return Boolean(cy?.nodes().some(node => node.data('label') === label));
    }, PARENT_TITLE);
  }, {
    message: 'Waiting for parent node',
    timeout: 10_000,
    intervals: [250, 500, 1000, 2000],
  }).toBe(true);

  const { nodeId, nodeCountBefore } = await page.evaluate((label) => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not initialized');
    const target = cy.nodes().find(node => node.data('label') === label);
    if (!target) throw new Error(`Node with label ${label} not found`);
    target.select();
    target.trigger('tap');
    return {
      nodeId: target.id(),
      nodeCountBefore: cy.nodes().length,
    };
  }, PARENT_TITLE);

  const editorWindowId = `window-${nodeId}-editor`;
  const editorInstanceId = getEditorInstanceId(nodeId);
  const editorContent = page.locator(`${idSelector(editorWindowId)} .cm-content`);
  await editorContent.waitFor({ state: 'visible', timeout: 5_000 });
  await waitForEditorInstance(page, editorInstanceId);
  await focusEditor(page, editorWindowId, editorInstanceId);
  return { nodeId, nodeCountBefore, editorWindowId, editorInstanceId };
}

async function replaceEditorContentWithKeyboard(page: Page, editorInstanceId: string, content: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(content, { delay: 1 });

  await expect.poll(async () => readEditorValue(page, editorInstanceId), {
    message: 'Waiting for real keyboard input to reach the editor buffer',
    timeout: 3_000,
    intervals: [25, 50, 100, 200],
  }).toBe(content);
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  projectPath: string;
  writeFolder: string;
}>({
  projectPath: async ({}, use) => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-editor-child-'));
    await use(projectPath);
    await fs.rm(projectPath, { recursive: true, force: true });
  },

  writeFolder: async ({ projectPath }, use) => {
    const writeFolder = await seedProject(projectPath);
    await use(writeFolder);
  },

  electronApp: async ({ projectPath, writeFolder }, use) => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-editor-child-app-'));
    await fs.writeFile(
      path.join(userDataPath, 'projects.json'),
      JSON.stringify([
        {
          id: 'editor-edits-survive-create-child',
          path: projectPath,
          name: path.basename(projectPath),
          type: 'folder',
          lastOpened: Date.now(),
          voicetreeInitialized: true,
        },
      ], null, 2),
      'utf8',
    );
    await fs.writeFile(
      path.join(userDataPath, 'voicetree-config.json'),
      JSON.stringify({
        lastDirectory: projectPath,
        vaultConfig: {
          [projectPath]: {
            writeFolder,
            readPaths: [],
          },
        },
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

    const openResult = await window.evaluate(async (dir) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      const response = await api.main.openVault(dir);
      return { writeFolder: response.writeFolder };
    }, projectPath);
    expect(openResult.writeFolder, 'openVault returned no writeFolder').toBeTruthy();

    await pollForCytoscape(window, 30_000);
    await pollForCytoscapeNodes(window, 1, 20_000);
    await pollForCondition(window, async () => {
      return await window.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        const bodyText = document.body.textContent ?? '';
        return Boolean(
          (cy?.nodes().length ?? 0) >= 1 &&
          !bodyText.includes('Loading Voicetree'),
        );
      });
    }, 'Waiting for graph view to settle after file watching start', 10_000);
    await window.waitForTimeout(1_000);
    await use(window);
  },
});

test.describe.configure({ timeout: 90_000 });

test('typing in a parent editor survives immediate create-child shortcut', async ({ appWindow, writeFolder }) => {
  const { nodeId, nodeCountBefore, editorWindowId: parentEditorWindowId, editorInstanceId: parentEditorInstanceId } = await openParentEditor(appWindow);
  await replaceEditorContentWithKeyboard(appWindow, parentEditorInstanceId, EXPECTED_PARENT_CONTENT);

  await appWindow.waitForTimeout(75);
  await appWindow.keyboard.press('ControlOrMeta+n');

  await expect.poll(async () => {
    return await appWindow.evaluate((previousCount) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      return cy?.nodes().length ?? previousCount;
    }, nodeCountBefore);
  }, {
    message: 'Waiting for Cmd/Ctrl+N to create a child node',
    timeout: 15_000,
    intervals: [100, 250, 500, 1000],
  }).toBeGreaterThan(nodeCountBefore);

  const parentFilePath = path.join(writeFolder, PARENT_FILENAME);
  await expect.poll(async () => {
    return await fs.readFile(parentFilePath, 'utf8');
  }, {
    message: 'Waiting for parent file to keep the in-flight typed edit',
    timeout: 10_000,
    intervals: [100, 250, 500, 1000],
  }).toContain(TYPED_MARKER);

  await expect.poll(async () => {
    return await appWindow.evaluate(async ({ id }) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      const node = await api?.main.getNode(id);
      return node?.contentWithoutYamlOrLinks ?? null;
    }, { id: nodeId });
  }, {
    message: 'Waiting for daemon node content to keep the in-flight typed edit',
    timeout: 10_000,
    intervals: [100, 250, 500, 1000],
  }).toContain(TYPED_MARKER);

  await closeEditorWindow(appWindow, parentEditorWindowId);
  await appWindow.locator(idSelector(parentEditorWindowId)).waitFor({ state: 'detached', timeout: 5_000 });

  await appWindow.evaluate((id) => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not initialized');
    const parent = cy.getElementById(id);
    parent.select();
    parent.trigger('tap');
  }, nodeId);

  const editorContent = appWindow.locator(`${idSelector(parentEditorWindowId)} .cm-content`);
  await editorContent.waitFor({ state: 'visible', timeout: 5_000 });
  await waitForEditorInstance(appWindow, parentEditorInstanceId);
  await expect.poll(async () => tryReadEditorValue(appWindow, parentEditorInstanceId), {
    message: 'Waiting for reopened parent editor to show the typed edit',
    timeout: 5_000,
    intervals: [100, 250, 500],
  }).toContain(TYPED_MARKER);
});

test('typing in a parent editor is included in an immediate agent context snapshot', async ({ appWindow, writeFolder }) => {
  await appWindow.evaluate(async () => {
    const api = (window as unknown as ExtendedWindow).electronAPI;
    if (!api) throw new Error('electronAPI not available');
    const currentSettings = await api.main.loadSettings();
    await api.main.saveSettings({
      ...currentSettings,
      defaultAgent: 'Noop Test Agent',
      agentPermissionModeChosen: true,
      agents: [
        {
          name: 'Noop Test Agent',
          command: 'printf context-snapshot-test; exit',
        },
      ],
    });
  });

  const { editorInstanceId } = await openParentEditor(appWindow);
  await replaceEditorContentWithKeyboard(appWindow, editorInstanceId, EXPECTED_CONTEXT_PARENT_CONTENT);

  await appWindow.waitForTimeout(75);
  await appWindow.keyboard.press('ControlOrMeta+Enter');

  await expect.poll(async () => readContextNodeFiles(writeFolder), {
    message: 'Waiting for agent context node to include the in-flight typed edit',
    timeout: 15_000,
    intervals: [100, 250, 500, 1000],
  }).toContain(CONTEXT_MARKER);

  await closeAllTerminalWindows(appWindow);
});
