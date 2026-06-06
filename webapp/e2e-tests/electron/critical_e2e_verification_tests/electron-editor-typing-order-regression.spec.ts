import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type { Core as CytoscapeCore } from 'cytoscape';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { HostAPI } from '@/shell/hostApi';
import { robustElectronTeardown, safeStopFileWatching, pollForCytoscape, pollForCytoscapeNodes, pollForCondition } from './electron-smoke-helpers';
import {
  focusEditorInstance,
  getEditorInstanceId,
  readEditorValue,
  waitForEditorInstance,
} from './helpers/editor-instance';

const PROJECT_ROOT = path.resolve(process.cwd());

function idSelector(id: string): string {
  return `[id="${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

async function focusEditor(page: Page, editorWindowId: string, editorInstanceId: string): Promise<void> {
  await focusEditorInstance(page, editorInstanceId);
  await expect.poll(async () => {
    return page.evaluate((winId) => {
      const windowElement = document.getElementById(winId);
      windowElement?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      const editorElement = document.querySelector(`#${CSS.escape(winId)} .cm-content`);
      return document.activeElement === editorElement
        || Boolean(document.activeElement?.closest('.cm-editor'));
    }, editorWindowId);
  }, {
    message: 'Waiting for CodeMirror editor focus',
    timeout: 5_000,
  }).toBe(true);
}

function seededDelay(seed: number, minMs = 5, maxMs = 500): number {
  const value = Math.sin(seed) * 10_000;
  const fraction = value - Math.floor(value);
  return Math.round(minMs + fraction * (maxMs - minMs));
}

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  hostAPI?: HostAPI;
}

async function seedProject(projectPath: string): Promise<string> {
  const writeFolderPath = path.join(projectPath, 'voicetree');
  await fs.mkdir(writeFolderPath, { recursive: true });
  await fs.mkdir(path.join(projectPath, '.voicetree'), { recursive: true });
  await fs.writeFile(
    path.join(writeFolderPath, 'Typing Target.md'),
    '# Typing Target\n\nInitial content that will be replaced.\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(projectPath, '.voicetree', 'positions.json'),
    JSON.stringify({ 'Typing Target.md': { x: 100, y: 100 } }, null, 2),
    'utf8',
  );
  return writeFolderPath;
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
  projectPath: string;
  writeFolderPath: string;
}>({
  projectPath: async ({}, use) => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-editor-order-'));
    await use(projectPath);
    await fs.rm(projectPath, { recursive: true, force: true });
  },

  writeFolderPath: async ({ projectPath }, use) => {
    const writeFolderPath = await seedProject(projectPath);
    await use(writeFolderPath);
  },

  electronApp: async ({ projectPath, writeFolderPath }, use) => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-editor-order-app-'));
    const savedProject = {
      id: 'editor-typing-order-regression',
      path: projectPath,
      name: path.basename(projectPath),
      type: 'folder',
      lastOpened: Date.now(),
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
    // voicetree-config.json has lastDirectory set, so the app may auto-load the project
    // before the project selection screen is fully visible. Try detecting auto-load first.
    const openResult = await window.evaluate(async (dir) => {
      const api = (window as unknown as ExtendedWindow).hostAPI;
      if (!api) throw new Error('hostAPI not available');
      const response = await api.main.openProject(dir);
      return { writeFolderPath: response.writeFolderPath };
    }, projectPath);
    expect(openResult.writeFolderPath, 'openProject returned no writeFolderPath').toBeTruthy();
    await pollForCytoscape(window, 30_000);
    await pollForCytoscapeNodes(window, 1, 20_000);
    await pollForCondition(window, async () => {
      return await window.evaluate(async () => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        const bodyText = document.body.textContent ?? '';
        return Boolean(
          (cy?.nodes().length ?? 0) >= 1
            && !bodyText.includes('Loading Voicetree'),
        );
      });
    }, 'Waiting for graph view to settle after file watching start', 10_000);
    await window.waitForTimeout(1_000);
    await use(window);
  },
});

test.describe.configure({ timeout: 75_000 });

test('preserves character-by-character editor typing after autosave and file watcher settle', async ({ appWindow, writeFolderPath }) => {
  await expect.poll(async () => {
    return await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      return Boolean(cy?.nodes().some((node) => node.data('label') === 'Typing Target'));
    });
  }, { message: 'Waiting for Typing Target node', timeout: 10_000, intervals: [250, 500, 1000, 2000] }).toBe(true);

  const nodeId = await appWindow.evaluate(() => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not initialized');
    const target = cy.nodes().find((node) => node.data('label') === 'Typing Target');
    if (!target) throw new Error('Typing Target node not found');
    target.trigger('tap');
    return target.id();
  });

  const editorWindowId = `window-${nodeId}-editor`;
  const editorContent = appWindow.locator(`${idSelector(editorWindowId)} .cm-content`);
  await editorContent.waitFor({ state: 'visible', timeout: 5_000 });

  await expect.poll(async () => {
    return appWindow.evaluate((winId) => {
      const windowElement = document.getElementById(winId);
      windowElement?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      const editorElement = document.querySelector(`#${CSS.escape(winId)} .cm-content`);
      const editorFocused = document.activeElement === editorElement
        || Boolean(document.activeElement?.closest('.cm-editor'));
      return editorFocused;
    }, editorWindowId);
  }, {
    message: 'Waiting for CodeMirror editor focus',
    timeout: 5_000,
  }).toBe(true);

  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await appWindow.keyboard.press(`${modifier}+A`);

  const expectedContent = [
    'random saves should stay ordered',
    'across a couple of lines',
    'without moving letters around',
  ].join('\n');

  for (let i = 0; i < expectedContent.length; i++) {
    const character = expectedContent[i];
    await appWindow.evaluate((winId) => {
      document.getElementById(winId)?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    }, editorWindowId);
    if (character === '\n') {
      await appWindow.keyboard.press('Enter');
    } else {
      await appWindow.keyboard.insertText(character);
    }
    await appWindow.waitForTimeout(seededDelay(i + 1));

    if (character === ' ') {
      await appWindow.waitForTimeout(seededDelay(10_000 + i));
    }

    const expectedPrefix = expectedContent.slice(0, i + 1);
    await expect.poll(async () => {
      return appWindow.evaluate((winId) => {
        const editorElement = document.querySelector(`#${CSS.escape(winId)} .cm-content`) as HTMLElement | null;
        const text = editorElement?.innerText;
        return text === undefined ? null : text.replace(/\n$/, '');
      }, editorWindowId);
    }, {
      message: `Waiting for editor to preserve typed prefix through autosave cycle ${i + 1}`,
      timeout: 5_000,
    }).toBe(expectedPrefix);
  }

  await expect.poll(async () => {
    return appWindow.evaluate((winId) => {
      const editorElement = document.querySelector(`#${CSS.escape(winId)} .cm-content`) as HTMLElement | null;
      const text = editorElement?.innerText;
      return text === undefined ? null : text.replace(/\n$/, '');
    }, editorWindowId);
  }, {
    message: 'Waiting for CodeMirror to contain the exact typed document',
    timeout: 5_000,
  }).toBe(expectedContent);

  await appWindow.waitForTimeout(1_000);

  const settled = await appWindow.evaluate((winId) => {
    const editorElement = document.querySelector(`#${CSS.escape(winId)} .cm-content`) as HTMLElement | null;
    const text = editorElement?.innerText;
    return text === undefined ? null : text.replace(/\n$/, '');
  }, editorWindowId);
  expect(settled).toBe(expectedContent);

  const savedContent = await fs.readFile(path.join(writeFolderPath, 'Typing Target.md'), 'utf8');
  expect(savedContent).toBe(expectedContent);
});

test('merges external daemon SSE append while the editor is focused and typing', async ({ appWindow, writeFolderPath }) => {
  await appWindow.evaluate(async () => {
    const api = (window as unknown as ExtendedWindow).hostAPI;
    await api?.main.syncRendererSessionStateWithDaemon();
  });

  await expect.poll(async () => {
    return await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      return Boolean(cy?.nodes().some((node) => node.data('label') === 'Typing Target'));
    });
  }, { message: 'Waiting for Typing Target node', timeout: 10_000, intervals: [250, 500, 1000, 2000] }).toBe(true);

  const nodeId = await appWindow.evaluate(() => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not initialized');
    const target = cy.nodes().find((node) => node.data('label') === 'Typing Target');
    if (!target) throw new Error('Typing Target node not found');
    target.trigger('tap');
    return target.id();
  });

  const editorWindowId = `window-${nodeId}-editor`;
  const editorInstanceId = getEditorInstanceId(nodeId);
  const editorContent = appWindow.locator(`${idSelector(editorWindowId)} .cm-content`);
  await editorContent.waitFor({ state: 'visible', timeout: 5_000 });
  await waitForEditorInstance(appWindow, editorInstanceId);
  await focusEditorInstance(appWindow, editorInstanceId);

  await expect.poll(async () => {
    return appWindow.evaluate((winId) => {
      const windowElement = document.getElementById(winId);
      windowElement?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      const editorElement = document.querySelector(`#${CSS.escape(winId)} .cm-content`);
      const editorFocused = document.activeElement === editorElement
        || Boolean(document.activeElement?.closest('.cm-editor'));
      return editorFocused;
    }, editorWindowId);
  }, {
    message: 'Waiting for CodeMirror editor focus',
    timeout: 5_000,
  }).toBe(true);

  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await appWindow.keyboard.press(`${modifier}+A`);

  const userText = 'user is typing this while the daemon is active';
  const agentText = '## Agent Section\nagent wrote this';
  const typing = appWindow.keyboard.type(userText, { delay: 80 });

  await appWindow.waitForTimeout(500);
  await fs.appendFile(path.join(writeFolderPath, 'Typing Target.md'), `\n\n${agentText}\n`, 'utf8');
  await typing;
  await appWindow.waitForTimeout(1_000);

  await expect.poll(async () => {
    const text = await readEditorValue(appWindow, editorInstanceId);
    return text.includes(userText) && text.includes(agentText);
  }, {
    message: 'Waiting for focused editor to contain both user typing and external agent append',
    timeout: 10_000,
  }).toBe(true);

  await expect.poll(async () => {
    const content = await fs.readFile(path.join(writeFolderPath, 'Typing Target.md'), 'utf8');
    return content.includes(userText) && content.includes(agentText);
  }, {
    message: 'Waiting for file to contain both user typing and external agent append',
    timeout: 10_000,
  }).toBe(true);
});

test('applies non-append external filesystem replacements while the editor is focused', async ({ appWindow, writeFolderPath }) => {
  await appWindow.evaluate(async () => {
    const api = (window as unknown as ExtendedWindow).hostAPI;
    await api?.main.syncRendererSessionStateWithDaemon();
  });

  await expect.poll(async () => {
    return await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      return Boolean(cy?.nodes().some((node) => node.data('label') === 'Typing Target'));
    });
  }, { message: 'Waiting for Typing Target node', timeout: 10_000, intervals: [250, 500, 1000, 2000] }).toBe(true);

  const nodeId = await appWindow.evaluate(() => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not initialized');
    const target = cy.nodes().find((node) => node.data('label') === 'Typing Target');
    if (!target) throw new Error('Typing Target node not found');
    target.trigger('tap');
    return target.id();
  });

  const editorWindowId = `window-${nodeId}-editor`;
  const editorInstanceId = getEditorInstanceId(nodeId);
  const editorContent = appWindow.locator(`${idSelector(editorWindowId)} .cm-content`);
  await editorContent.waitFor({ state: 'visible', timeout: 5_000 });
  await waitForEditorInstance(appWindow, editorInstanceId);
  await focusEditor(appWindow, editorWindowId, editorInstanceId);

  const expectedEditorContent = '# Typing Target\n\nExternal filesystem replacement should win while focused.\n';
  await fs.writeFile(
    path.join(writeFolderPath, 'Typing Target.md'),
    `---\n---\n${expectedEditorContent}`,
    'utf8',
  );

  await expect.poll(async () => readEditorValue(appWindow, editorInstanceId), {
    message: 'Waiting for focused editor to accept external filesystem replacement',
    timeout: 10_000,
    intervals: [250, 500, 1000, 2000],
  }).toBe(expectedEditorContent);
});
