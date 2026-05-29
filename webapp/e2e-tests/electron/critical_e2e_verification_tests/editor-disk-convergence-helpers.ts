import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type { Core as CytoscapeCore, EdgeSingular } from 'cytoscape';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ElectronAPI } from '@/shell/electron';
import {
  focusEditorInstance,
  getEditorInstanceId,
  readEditorValue,
  tryReadEditorValue,
  waitForEditorInstance,
} from './helpers/editor-instance';
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

function idSelector(id: string): string {
  return `[id="${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

async function seedProject(projectPath: string): Promise<string> {
  const writeFolderPath = path.join(projectPath, 'voicetree');
  await fs.mkdir(writeFolderPath, { recursive: true });
  await fs.mkdir(path.join(projectPath, '.voicetree'), { recursive: true });
  await fs.writeFile(path.join(writeFolderPath, PARENT_FILENAME), INITIAL_PARENT_CONTENT, 'utf8');
  await fs.writeFile(
    path.join(projectPath, '.voicetree', 'positions.json'),
    JSON.stringify({ [PARENT_FILENAME]: { x: 120, y: 120 } }, null, 2),
    'utf8',
  );
  return writeFolderPath;
}

type EditorDiskConvergenceWorkerFixtures = {
  electronApp: ElectronApplication;
  appWindow: Page;
  projectPath: string;
  settingsSnapshot: unknown;
  writeFolderPath: string;
};

export const test = base.extend<Record<string, never>, EditorDiskConvergenceWorkerFixtures>({
  projectPath: [async ({}, use) => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-editor-disk-conv-'));
    await use(projectPath);
    await fs.rm(projectPath, { recursive: true, force: true });
  }, { scope: 'worker' }],

  writeFolderPath: [async ({ projectPath }, use) => {
    const writeFolderPath = await seedProject(projectPath);
    await use(writeFolderPath);
  }, { scope: 'worker' }],

  electronApp: [async ({ projectPath, writeFolderPath }, use) => {
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
        vaultConfig: { [projectPath]: { writeFolderPath, readPaths: [] } },
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
  }, { scope: 'worker' }],

  appWindow: [async ({ electronApp, projectPath }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15_000 });
    await window.waitForLoadState('domcontentloaded');

    const openResult = await window.evaluate(async (vault: string) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      const response = await api.main.openVault(vault);
      return { writeFolderPath: response.writeFolderPath };
    }, projectPath);
    expect(openResult.writeFolderPath, 'openVault returned no writeFolderPath').toBeTruthy();

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
  }, { scope: 'worker' }],

  settingsSnapshot: [async ({ appWindow }, use) => {
    const settings = await appWindow.evaluate(async () => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.loadSettings();
    });
    await use(settings);
  }, { scope: 'worker' }],
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
  const editorInstanceId = getEditorInstanceId(nodeId);
  await page.locator(`${idSelector(editorWindowId)} .cm-content`).waitFor({ state: 'visible', timeout: 5_000 });
  await waitForEditorInstance(page, editorInstanceId);
  await focusEditor(page, editorWindowId);
  return { nodeId, editorWindowId, nodeCountBefore };
}

export async function focusEditor(page: Page, editorWindowId: string): Promise<void> {
  const editorInstanceId = editorWindowId.replace(/^window-/, '');
  await page.evaluate((winId) => {
    document.getElementById(winId)?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  }, editorWindowId);
  await focusEditorInstance(page, editorInstanceId);
}

export async function readEditorText(page: Page, editorWindowId: string): Promise<string | null> {
  return tryReadEditorValue(page, editorWindowId.replace(/^window-/, ''));
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
      return readEditorValue(page, editorWindowId.replace(/^window-/, ''));
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

export async function closeAllEditorWindows(page: Page): Promise<void> {
  const openEditorCount = await page.locator('.cy-floating-window-editor').count();
  if (openEditorCount === 0) return;

  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>('.cy-floating-window-editor').forEach((editorWindow) => {
      editorWindow.dispatchEvent(new CustomEvent('traffic-light-close', { bubbles: true }));
    });
  });

  await expect.poll(async () => {
    return page.evaluate(() => document.querySelectorAll('.cy-floating-window-editor').length);
  }, {
    message: 'Waiting for all editor windows to close',
    timeout: 10_000,
    intervals: [100, 250, 500, 1000],
  }).toBe(0);
}

// Real DOM click on the traffic-light close button — exercises the
// button → onClick handler → close-logic wiring. Use this in tests that need
// to verify the button itself works (the dispatchEvent path bypasses the
// button entirely). Throws if the button isn't rendered, by design.
export async function clickEditorCloseButton(page: Page, editorWindowId: string): Promise<void> {
  await page.evaluate((winId) => {
    const button = document.querySelector(`#${CSS.escape(winId)} .traffic-light-close`) as HTMLButtonElement | null;
    if (!button) throw new Error(`traffic-light-close button not found on #${winId}`);
    button.click();
  }, editorWindowId);
}

export async function closeAllTerminalWindows(page: Page): Promise<void> {
  const openTerminalCount = await page.locator('.cy-floating-window-terminal').count();
  if (openTerminalCount === 0) return;

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

async function deleteGraphExtraMarkdownNodes(page: Page, writeFolderPath: string): Promise<readonly string[]> {
  return page.evaluate(async ({ parentNodeId, vaultPath }) => {
    const api = (window as unknown as ExtendedWindow).electronAPI;
    if (!api) throw new Error('electronAPI not available');
    await api.main.reconcileGraphWithDisk();
    const graph = await api.main.getGraph();
    const graphWithNodes = graph as { nodes?: Record<string, unknown> };
    const nodeIds = Object.keys(graphWithNodes.nodes ?? {}).filter((nodeId) => {
      return nodeId !== parentNodeId
        && nodeId.endsWith('.md')
        && (nodeId === vaultPath || nodeId.startsWith(`${vaultPath}/`));
    });
    if (nodeIds.length === 0) return [];

    await api.main.applyGraphDeltaToDBThroughMemUIAndEditorExposed(
      nodeIds.map((nodeId) => ({
        type: 'DeleteNode',
        nodeId,
        deletedNode: { _tag: 'None' },
      })) as never,
      false,
    );
    return nodeIds;
  }, {
    parentNodeId: path.join(writeFolderPath, PARENT_FILENAME),
    vaultPath: writeFolderPath,
  });
}

export async function deleteExtraVaultFiles(page: Page, writeFolderPath: string): Promise<void> {
  await deleteGraphExtraMarkdownNodes(page, writeFolderPath);

  const entries = await fs.readdir(writeFolderPath, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === PARENT_FILENAME) return;
    await fs.rm(path.join(writeFolderPath, entry.name), { force: true });
  }));
}

export async function deleteCtxNodesDir(writeFolderPath: string): Promise<void> {
  await fs.rm(path.join(writeFolderPath, 'ctx-nodes'), { recursive: true, force: true });
}

export async function resetSettings(page: Page, snapshot: unknown): Promise<void> {
  if (snapshot === undefined) {
    throw new Error('resetSettings requires an explicit settings snapshot');
  }
  await page.evaluate(async (settings) => {
    const api = (window as unknown as ExtendedWindow).electronAPI;
    if (!api) throw new Error('electronAPI not available');
    await api.main.saveSettings(settings);
  }, snapshot);
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

export async function waitForGraphReset(page: Page, label: string): Promise<void> {
  await expect.poll(async () => {
    return page.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return { hasCytoscape: false, labels: [], labeledNodeCount: 0 };
      const nodes = cy.nodes();
      const labels = nodes
        .map((node) => node.data('label'))
        .filter((nodeLabel): nodeLabel is string => typeof nodeLabel === 'string')
        .sort();
      return {
        hasCytoscape: true,
        labels,
        labeledNodeCount: labels.length,
      };
    });
  }, {
    message: `Waiting for graph to reset to only "${label}"`,
    timeout: 15_000,
    intervals: [200, 500, 1000, 2000],
  }).toEqual({
    hasCytoscape: true,
    labels: [label],
    labeledNodeCount: 1,
  });
}

export async function expectDiskMatches(
  writeFolderPath: string,
  filename: string,
  expected: string,
  timeout = 15_000,
): Promise<void> {
  await expect.poll(async () => {
    return fs.readFile(path.join(writeFolderPath, filename), 'utf8');
  }, {
    message: `Waiting for ${filename} on disk to match expected content`,
    timeout,
    intervals: [200, 500, 1000, 2000],
  }).toBe(expected);
}

export async function expectDiskContainsAll(
  writeFolderPath: string,
  filename: string,
  fragments: readonly string[],
  timeout = 15_000,
): Promise<void> {
  await expect.poll(async () => {
    const content = await fs.readFile(path.join(writeFolderPath, filename), 'utf8');
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
  writeFolderPath: string,
  fragment: string,
  timeout = 15_000,
): Promise<void> {
  await expect.poll(async () => {
    const contextDir = path.join(writeFolderPath, 'ctx-nodes');
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
