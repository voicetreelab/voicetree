import { test as base, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type { Core as CytoscapeCore } from 'cytoscape';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { ElectronAPI } from '@/shell/electron';

const PROJECT_ROOT = path.resolve(process.cwd());

export interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

export const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  testVaultPath: string;
  tempUserDataPath: string;
}>({
  testVaultPath: async ({}, use) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-edit-path-test-'));

    const writeVault = path.join(tempDir, 'write-vault');
    await fs.mkdir(writeVault, { recursive: true });
    await fs.writeFile(
      path.join(writeVault, 'node-a.md'),
      '# Node A\n\nThis is node A in write-vault.'
    );

    const readVault = path.join(tempDir, 'read-vault');
    await fs.mkdir(readVault, { recursive: true });
    await fs.writeFile(
      path.join(readVault, 'node-b.md'),
      '# Node B\n\nThis is node B in read-vault.'
    );

    await fs.mkdir(path.join(tempDir, 'renamed-vault'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'new-write-vault'), { recursive: true });

    await use(tempDir);

    await fs.rm(tempDir, { recursive: true, force: true });
  },

  tempUserDataPath: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-edit-path-userdata-'));
    await use(tempUserDataPath);
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  electronApp: async ({ testVaultPath, tempUserDataPath }, use) => {
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: testVaultPath }, null, 2), 'utf8');
    console.log('[Edit Path Test] Created config to auto-load:', testVaultPath);

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
        const api = (window as unknown as ExtendedWindow).electronAPI;
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
