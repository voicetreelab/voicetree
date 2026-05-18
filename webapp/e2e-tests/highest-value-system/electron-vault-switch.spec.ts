/**
 * Tier 2 black-box e2e: opens vault A through the "Open existing folder"
 * button on ProjectSelectionScreen, then switches to vault B through the
 * File menu — the actual paths a user takes.
 *
 * No preseeding: the userData dir starts empty (no voicetree-config.json,
 * no --open-folder). The only test affordance is monkey-patching the
 * native folder dialog to return the fixture vault paths, since Playwright
 * can't drive native OS dialogs.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import {
  WEBAPP_ROOT,
  type ElectronDiagnostics,
  resolveGraphDaemonNodeBin,
  stopSmokeGraphDaemonForVault,
  expectNoCriticalElectronErrors,
} from './electron-smoke-helpers';

type FixtureVaults = {
  readonly tempRoot: string;
  readonly vaultAPath: string;
  readonly vaultBPath: string;
};

async function writeFixtureVault(vaultPath: string, label: string): Promise<void> {
  await fs.mkdir(vaultPath, { recursive: true });
  await fs.writeFile(path.join(vaultPath, 'root.md'), [
    `# ${label} Root`,
    '',
    `Links to [[${label} First.md]] and [[${label} Second.md]].`,
    '',
  ].join('\n'), 'utf8');
  await fs.writeFile(path.join(vaultPath, `${label} First.md`), [
    `# ${label} First`,
    '',
    `First child in ${label}.`,
    '',
  ].join('\n'), 'utf8');
  await fs.writeFile(path.join(vaultPath, `${label} Second.md`), [
    `# ${label} Second`,
    '',
    `Second child in ${label}.`,
    '',
  ].join('\n'), 'utf8');
}

/**
 * Replace dialog.showOpenDialog in the main process so the next call returns
 * the given folder path without a real native picker. We can't simulate clicks
 * on a native OS dialog from Playwright; this is the conventional stub.
 */
async function stubFolderDialog(electronApp: ElectronApplication, folderPath: string): Promise<void> {
  await electronApp.evaluate(async ({ dialog }, returnPath) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [returnPath],
    })) as typeof dialog.showOpenDialog;
  }, folderPath);
}

/**
 * Click File → Open Folder... in the application menu. This is how a user
 * switches vaults while one is already loaded, and it's the path that exercises
 * the previousRoot-non-null branch in doLoadFolder where the original bug lived.
 */
async function clickFileOpenFolderMenu(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(async ({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    if (!menu) throw new Error('No application menu found');
    const fileMenu = menu.items.find(item => item.label === 'File');
    if (!fileMenu?.submenu) throw new Error('File menu not found');
    const openFolderItem = fileMenu.submenu.items.find(item => item.label === 'Open Folder...');
    if (!openFolderItem) throw new Error('"Open Folder..." menu item not found');
    openFolderItem.click();
  });
}

function expectNoVaultSwitchErrors(diagnostics: ElectronDiagnostics): void {
  expectNoCriticalElectronErrors(diagnostics);

  const criticalErrorPatterns = [
    /\[RPC Error\]/i,
    /Error invoking remote method/i,
    /No vault is currently open/i,
    /Watched directory not initialized/i,
  ];
  const criticalErrors = [...diagnostics.mainOutput, ...diagnostics.rendererErrors]
    .filter(line => criticalErrorPatterns.some(pattern => pattern.test(line)));

  expect(criticalErrors).toEqual([]);
}

const test = base.extend<{
  fixtureVaults: FixtureVaults;
  tempUserDataPath: string;
  electronDiagnostics: ElectronDiagnostics;
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  fixtureVaults: async ({}, use) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-ui-vault-switch-'));
    const vaultAPath = path.join(tempRoot, 'vault-a');
    const vaultBPath = path.join(tempRoot, 'vault-b');

    await writeFixtureVault(vaultAPath, 'Vault A');
    await writeFixtureVault(vaultBPath, 'Vault B');

    await use({ tempRoot, vaultAPath, vaultBPath });

    stopSmokeGraphDaemonForVault(vaultAPath);
    stopSmokeGraphDaemonForVault(vaultBPath);
    await fs.rm(tempRoot, { recursive: true, force: true });
  },

  tempUserDataPath: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-ui-vault-switch-data-'));
    await use(tempUserDataPath);
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  electronDiagnostics: async ({}, use) => {
    await use({ mainOutput: [], rendererErrors: [] });
  },

  electronApp: async ({ tempUserDataPath, electronDiagnostics }, use) => {
    const graphDaemonNodeBin = resolveGraphDaemonNodeBin();
    const ciFlags = process.env.CI
      ? ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
      : [];

    const electronApp = await electron.launch({
      args: [
        ...ciFlags,
        path.join(WEBAPP_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`,
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        VOICETREE_PERSIST_STATE: '1',
        VT_GRAPHD_NODE_BIN: graphDaemonNodeBin,
        ENABLE_PLAYWRIGHT_DEBUG: '0',
      },
      timeout: 60000,
    });

    const electronProcess = electronApp.process();
    electronProcess?.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      electronDiagnostics.mainOutput.push(text);
      console.log(`[MAIN STDOUT] ${text.trim()}`);
    });
    electronProcess?.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      electronDiagnostics.mainOutput.push(text);
      console.error(`[MAIN STDERR] ${text.trim()}`);
    });

    await use(electronApp);

    if (electronProcess?.pid) {
      try {
        process.kill(electronProcess.pid, 'SIGKILL');
      } catch {
        // Electron already exited.
      }
    }

    try {
      await Promise.race([
        electronApp.close(),
        new Promise(resolve => setTimeout(resolve, 5000)),
      ]);
    } catch {
      // Close may fail if already killed.
    }
  },

  appWindow: async ({ electronApp, electronDiagnostics }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15000 });

    window.on('console', msg => {
      if (msg.type() === 'error') {
        electronDiagnostics.rendererErrors.push(msg.text());
      }
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    window.on('pageerror', error => {
      electronDiagnostics.rendererErrors.push(error.message);
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');

    await use(window);
  },
});

test.describe('Electron Vault Switch via UI Tier 2', () => {
  test.describe.configure({ timeout: process.env.CI ? 180000 : 90000 });

  test('opens vault A via "Open existing folder", then switches to vault B via File menu', async ({
    appWindow,
    electronApp,
    fixtureVaults,
    electronDiagnostics,
  }) => {
    // Clean userData → app must boot to ProjectSelectionScreen.
    const openExistingFolderButton = appWindow.getByRole('button', { name: /open existing folder/i });
    await expect(openExistingFolderButton).toBeVisible({ timeout: 30000 });

    // Stub dialog → vault A. The button click triggers showFolderPicker in the
    // main process, which calls dialog.showOpenDialog.
    await stubFolderDialog(electronApp, fixtureVaults.vaultAPath);
    await openExistingFolderButton.click();

    // Graph view must render and the watch panel must show vault A's folder.
    // The watch-directory button (title attribute matches App.tsx FileWatchingPanel)
    // is the user-visible signal that vault A is the active project.
    const watchDirectoryButton = appWindow.locator(
      'button[title="Project root – agents spawn here by default"]',
    );
    const vaultAName = path.basename(fixtureVaults.vaultAPath);
    await expect(watchDirectoryButton).toContainText(vaultAName, { timeout: 60000 });

    // Switch vaults while A is loaded — this is the path where
    // doLoadFolder sees previousRoot=A and tries to save positions through
    // the daemon, which is what caused the original failure.
    await stubFolderDialog(electronApp, fixtureVaults.vaultBPath);
    await clickFileOpenFolderMenu(electronApp);

    // UI must swap to vault B. If the switch failed (the original bug), the
    // watch directory would stay on vault A and this assertion would time out.
    const vaultBName = path.basename(fixtureVaults.vaultBPath);
    await expect(watchDirectoryButton).toContainText(vaultBName, { timeout: 60000 });

    // No RPC errors or "vault not open" diagnostics around the switch.
    expectNoVaultSwitchErrors(electronDiagnostics);
  });
});
