import { test as base, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';
import { robustElectronTeardown, resolveGraphDaemonNodeBin, safeStopFileWatching, pollForCytoscape } from './electron-smoke-helpers';

export const PROJECT_ROOT = path.resolve(process.cwd());
export const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');

export interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

export const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-ctx-agent-test-'));

    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({
      lastDirectory: FIXTURE_VAULT_PATH,
      suffixes: {
        [FIXTURE_VAULT_PATH]: ''
      }
    }, null, 2), 'utf8');

    const ciFlags = process.env.CI
      ? ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader']
      : [];
    const electronApp = await electron.launch({
      args: [
        ...ciFlags,
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
        ENABLE_PLAYWRIGHT_DEBUG: '0',
        VOICETREE_PERSIST_STATE: '1',
        VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(),
        // Pin the runtime's tmux vault path to the fixture so per-terminal
        // log files land at `${FIXTURE_VAULT_PATH}/.voicetree/terminals/`
        // regardless of any host-shell `VOICETREE_VAULT_PATH` leak.
        VOICETREE_VAULT_PATH: FIXTURE_VAULT_PATH,
      },
      timeout: 10000
    });

    await use(electronApp);

    await safeStopFileWatching(electronApp);
    await robustElectronTeardown(electronApp);
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15000 });

    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });
    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');
    await pollForCytoscape(window, 30000);
    await window.waitForTimeout(1000);

    await use(window);
  }
});
