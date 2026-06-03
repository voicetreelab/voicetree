import { test as base, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type { Core as CytoscapeCore } from 'cytoscape';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { HostAPI } from '@/shell/hostApi';

const PROJECT_ROOT = path.resolve(process.cwd());

export interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  hostAPI?: HostAPI;
}

export const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  testProjectPath: string;
  tempUserDataPath: string;
}>({
  testProjectPath: async ({}, use) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-edit-path-test-'));

    const writeProject = path.join(tempDir, 'write-project');
    await fs.mkdir(writeProject, { recursive: true });
    await fs.writeFile(
      path.join(writeProject, 'node-a.md'),
      '# Node A\n\nThis is node A in write-project.'
    );

    const readProject = path.join(tempDir, 'read-project');
    await fs.mkdir(readProject, { recursive: true });
    await fs.writeFile(
      path.join(readProject, 'node-b.md'),
      '# Node B\n\nThis is node B in read-project.'
    );

    await fs.mkdir(path.join(tempDir, 'renamed-project'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'new-write-project'), { recursive: true });

    await use(tempDir);

    await fs.rm(tempDir, { recursive: true, force: true });
  },

  tempUserDataPath: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-edit-path-userdata-'));
    await use(tempUserDataPath);
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  electronApp: async ({ testProjectPath, tempUserDataPath }, use) => {
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: testProjectPath }, null, 2), 'utf8');
    console.log('[Edit Path Test] Created config to auto-load:', testProjectPath);

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
      timeout: 10000
    });

    await use(electronApp);

    try {
      const window = await electronApp.firstWindow();
      await window.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).hostAPI;
        if (api) {
          await api.main.stopFileWatching();
        }
      });
      await window.waitForTimeout(300);
    } catch {
      console.log('Note: Could not stop file watching during cleanup');
    }

    await electronApp.close();
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 10000 });

    window.on('console', msg => {
      console.log(`[BROWSER ${msg.type()}]:`, msg.text());
    });

    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
    await window.waitForTimeout(1000);

    await use(window);
  }
});
