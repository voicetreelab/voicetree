import { test as base, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { killOrphanVtGraphdDaemons } from '@vt/graph-db-client';

import { FIXTURE_VAULT_PATH, PERF_CONFIG, PROJECT_ROOT } from './config';
import type { ExtendedWindow } from './types';

export const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  mainInspectPort: number;
}>({
  mainInspectPort: async ({}, use) => {
    await use(PERF_CONFIG.inspectPort);
  },

  electronApp: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(
      path.join(os.tmpdir(), 'voicetree-500node-perf-test-')
    );

    const projectsPath = path.join(tempUserDataPath, 'projects.json');
    await fs.writeFile(
      projectsPath,
      JSON.stringify([{
        id: 'perf-test-project',
        path: FIXTURE_VAULT_PATH,
        name: 'example_small',
        type: 'folder',
        lastOpened: Date.now(),
        voicetreeInitialized: true,
      }], null, 2),
      'utf8'
    );

    const electronApp = await electron.launch({
      args: [
        `--inspect=${PERF_CONFIG.inspectPort}`,
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`,
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
        VOICETREE_PERSIST_STATE: '1',
      },
      timeout: 15000,
    });

    const mainStdout = electronApp.process().stdout;
    if (mainStdout) {
      mainStdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        for (const line of text.split('\n')) {
          if (line.startsWith('[load-timing]')) {
            console.log(line);
          }
        }
      });
    }

    await use(electronApp);

    try {
      const window = await electronApp.firstWindow();
      await window.evaluate(async () => {
        const api = (
          window as unknown as {
            electronAPI?: { main?: { stopFileWatching?: () => Promise<void> } };
          }
        ).electronAPI;
        if (api?.main?.stopFileWatching) {
          await api.main.stopFileWatching();
        }
      });
      await window.waitForTimeout(300);
    } catch {
      // Ignore shutdown errors
    }

    await electronApp.close();
    await fs.rm(tempUserDataPath, { recursive: true, force: true });

    const reaped = killOrphanVtGraphdDaemons();
    if (reaped.killed.length > 0) {
      console.log('[Perf Test] Reaped orphan vt-graphd daemons', reaped.killed);
    }
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15000 });

    window.on('console', (msg) => {
      const type = msg.type();
      const text = msg.text();
      if (type === 'warning' || type === 'error') {
        console.log(`BROWSER [${type}]:`, text);
      } else if (text.startsWith('[load-timing]')) {
        console.log(text);
      }
    });
    window.on('pageerror', (error) => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');

    await window.waitForSelector('text=Voicetree', { timeout: 10000 });
    const projectButton = window.locator('button:has-text("example_small")').first();
    await projectButton.click();
    console.log('[Perf Test] Clicked project to enter graph view');

    await window.waitForFunction(
      () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
      { timeout: 15000 }
    );
    await window.waitForTimeout(1000);

    await use(window);
  },
});
