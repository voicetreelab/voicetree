import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type { Core as CytoscapeCore } from 'cytoscape';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { ElectronAPI } from '@/shell/electron';

export interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

export const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  testProjectPath: string;
}>({
  electronApp: async ({}, use, testInfo) => {
    const PROJECT_ROOT = path.resolve(process.cwd());
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-two-path-focus-test-'));
    const watchedFolder = path.join(tempUserDataPath, 'test-project');
    const projectRoot = path.join(watchedFolder, 'voicetree');

    await fs.mkdir(projectRoot, { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'initial.md'), '# Initial Node\n\nThis is the initial node.', 'utf-8');
    await fs.writeFile(
      path.join(tempUserDataPath, 'voicetree-config.json'),
      JSON.stringify({ lastDirectory: watchedFolder }, null, 2),
      'utf8'
    );

    console.log('[Test] Watched folder:', watchedFolder);
    console.log('[Test] Project path (with suffix):', projectRoot);
    (testInfo as unknown as { projectRoot: string }).projectRoot = projectRoot;

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
      timeout: 30000
    });

    await use(electronApp);

    try {
      const window = await electronApp.firstWindow();
      await window.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (api) {
          await api.main.stopFileWatching();
        }
      });
      await window.waitForTimeout(300);
    } catch {
      console.log('[Test] Could not stop file watching during cleanup');
    }

    await electronApp.close();
    console.log('[Test] Electron app closed');

    await fs.rm(tempUserDataPath, { recursive: true, force: true });
    console.log('[Test] Cleaned up temp directory');
  },

  testProjectPath: async ({}, use, testInfo) => {
    await use((testInfo as unknown as { projectRoot: string }).projectRoot);
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();

    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
      console.error('Stack:', error.stack);
    });

    await window.waitForLoadState('domcontentloaded', { timeout: 60000 });

    const hasErrors = await window.evaluate(() => {
      const errors: string[] = [];
      if (!document.querySelector('#root')) errors.push('No #root element');
      const errorText = document.body.textContent;
      if (errorText?.includes('Error') || errorText?.includes('error')) {
        errors.push(`Page contains error text: ${errorText.substring(0, 200)}`);
      }
      return errors;
    });

    if (hasErrors.length > 0) {
      console.error('Pre-initialization errors:', hasErrors);
    }

    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 20000 });
    await window.waitForTimeout(500);

    await use(window);
  }
});

export async function prepareGraphForHotkeys(appWindow: Page): Promise<void> {
  await expect.poll(async () => {
    return appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return 0;
      return cy.nodes().length;
    });
  }, {
    message: 'Waiting for graph to load nodes',
    timeout: 15000
  }).toBeGreaterThan(0);

  console.log('[Test] Graph loaded');

  await appWindow.waitForFunction(() => {
    const loadingText = document.body.innerText;
    return !loadingText.includes('Loading...');
  }, { timeout: 10000 }).catch(() => {
    console.log('[Test] Warning: Loading indicator still present');
  });

  await appWindow.evaluate(() => {
    const container = document.getElementById('cy');
    container?.focus();
  });
  await appWindow.waitForTimeout(200);
}

export async function pressCreateNodeHotkey(appWindow: Page): Promise<void> {
  await appWindow.keyboard.press(process.platform === 'darwin' ? 'Meta+n' : 'Control+n');
}

export async function clickEditorContent(appWindow: Page, editorId: string): Promise<void> {
  await appWindow.locator(`#${escapeSelectorId(editorId)} .cm-content`).click({ force: true });
  await appWindow.waitForTimeout(300);
}

export function escapeSelectorId(id: string): string {
  return id.replace(/[/.]/g, '\\$&');
}

export { expect };
