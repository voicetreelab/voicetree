import { test as base, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type { EditorView } from '@codemirror/view';
import type { Core as CytoscapeCore } from 'cytoscape';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { ElectronAPI } from '@/shell/electron';

export const PROJECT_ROOT = path.resolve(process.cwd());

export interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

export interface CodeMirrorElement extends HTMLElement {
  cmView?: { view: EditorView };
}

export const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  testProjectPath: string;
}>({
  electronApp: async ({}, use, testInfo) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-add-link-context-menu-'));

    const watchedFolder = path.join(tempUserDataPath, 'test-project');
    await fs.mkdir(watchedFolder, { recursive: true });

    const projectRoot = path.join(watchedFolder, 'voicetree');
    await fs.mkdir(projectRoot, { recursive: true });

    const sourceContent = `---
position:
  x: 100
  y: 100
---
# Source Node

This is the source node where we will add a link.

Some content here.
`;
    await fs.writeFile(path.join(projectRoot, 'source-node.md'), sourceContent, 'utf-8');

    const targetContent = `---
position:
  x: 300
  y: 100
---
# Target Node

This is the target node we will link to.
`;
    await fs.writeFile(path.join(projectRoot, 'target-node.md'), targetContent, 'utf-8');

    const anotherContent = `---
position:
  x: 200
  y: 200
---
# Another Node

This is another node in the graph.
`;
    await fs.writeFile(path.join(projectRoot, 'another-node.md'), anotherContent, 'utf-8');

    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: watchedFolder }, null, 2), 'utf8');
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
    });

    await window.waitForLoadState('domcontentloaded', { timeout: 60000 });
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 20000 });

    await window.waitForFunction(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return false;
      return cy.nodes().length >= 1;
    }, { timeout: 15000 });

    await window.waitForTimeout(500);

    await use(window);
  }
});
