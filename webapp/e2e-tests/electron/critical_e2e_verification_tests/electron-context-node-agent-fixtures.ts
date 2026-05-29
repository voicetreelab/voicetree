import { test as base, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';
import { robustElectronTeardown, resolveGraphDaemonNodeBin, safeStopFileWatching, pollForCytoscape } from './electron-smoke-helpers';

export const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_TEMPLATE_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');

export interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

export const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  fixtureVaultPath: string;
  fakeAgentBinPath: string;
}>({
  fixtureVaultPath: async ({}, use) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-ctx-agent-vault-'));
    const fixtureVaultPath = path.join(tempRoot, 'example_small');
    await fs.cp(FIXTURE_VAULT_TEMPLATE_PATH, fixtureVaultPath, { recursive: true });
    await use(fixtureVaultPath);
    await fs.rm(tempRoot, { recursive: true, force: true });
  },

  fakeAgentBinPath: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-ctx-agent-test-'));
    const fakeBinPath = path.join(tempUserDataPath, 'bin');
    await fs.mkdir(fakeBinPath, { recursive: true });
    await fs.writeFile(
      path.join(fakeBinPath, 'claude'),
      '#!/usr/bin/env bash\n' +
      'sleep 1\n' +
      'grep -o "SECRET_E2E_NEEDLE: [^ ]*" "$CONTEXT_NODE_PATH" | head -1\n' +
      'sleep 30\n',
      { encoding: 'utf8', mode: 0o755 },
    );
    await use(fakeBinPath);
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  electronApp: async ({ fixtureVaultPath, fakeAgentBinPath }, use) => {
    const tempUserDataPath = path.dirname(fakeAgentBinPath);

    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({
      lastDirectory: fixtureVaultPath,
      suffixes: {
        [fixtureVaultPath]: ''
      }
    }, null, 2), 'utf8');

    // Pre-seed settings.json with the grep-probe agent registered so the
    // daemon-side `resolveAgentCommand` accepts the spec's spawn command at
    // first boot. A renderer-side `saveSettings` from the spec cannot reach
    // the daemon's in-process settings cache (5 s TTL, separate process),
    // so the agent registration must be on-disk before the daemon loads.
    const settingsPath = path.join(tempUserDataPath, 'settings.json');
    await fs.writeFile(settingsPath, JSON.stringify({
      terminalSpawnPathRelativeToWatchedDirectory: '../',
    }, null, 2), 'utf8');

    const ciFlags = process.env.CI
      ? ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader']
      : [];
    const electronApp = await electron.launch({
      args: [
        ...ciFlags,
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`,
        '--open-folder',
        fixtureVaultPath,
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
        ENABLE_PLAYWRIGHT_DEBUG: '0',
        VOICETREE_PERSIST_STATE: '1',
        VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(),
        // Pin the app-support path to the temp user-data dir so the daemon
        // (a forked subprocess) reads the same settings.json the fixture
        // pre-seeded. Without this override the parent shell's
        // VOICETREE_HOME_PATH leaks into the test process and the daemon
        // never sees the grep-probe agent.
        VOICETREE_HOME_PATH: tempUserDataPath,
        // Fallback for runtime paths before the daemon has reported the
        // configured write folder.
        VOICETREE_VAULT_PATH: fixtureVaultPath,
        PATH: `${fakeAgentBinPath}${path.delimiter}${process.env.PATH ?? ''}`,
      },
      timeout: 10000
    });

    await use(electronApp);

    await safeStopFileWatching(electronApp);
    await robustElectronTeardown(electronApp);
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
