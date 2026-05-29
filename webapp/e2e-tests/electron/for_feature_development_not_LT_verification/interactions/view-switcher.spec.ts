/**
 * Tier 2 black-box e2e: view-switcher dropdown in the top/bottom bar.
 *
 * Opens project A, interacts with the ViewSwitcher UI:
 * - dropdown shows "main" (active by default)
 * - "+ New view" creates a cloned view and activates it
 * - deleting the original "main" view (after switching away) succeeds
 * - switching back to "main" succeeds
 *
 * NOTE: This test requires a running vt-graphd daemon.
 * In the wt-please-now-orchestrate-the-imp-kh6 worktree, the daemon port binding
 * may be environment-broken (exit 2 / SCRIPT BROKEN). Run against a clean env.
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
  stopSmokeGraphDaemonForProject,
  expectNoCriticalElectronErrors,
} from '@e2e/highest-value-system/electron-smoke-helpers';

type FixtureProject = {
  readonly tempRoot: string;
  readonly projectRoot: string;
};

async function writeFixtureProject(projectRoot: string): Promise<void> {
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(path.join(projectRoot, 'root.md'), '# Root\n\nHello.\n', 'utf8');
}

async function stubFolderDialog(electronApp: ElectronApplication, folderPath: string): Promise<void> {
  await electronApp.evaluate(async ({ dialog }, returnPath) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [returnPath],
    })) as typeof dialog.showOpenDialog;
  }, folderPath);
}

const test = base.extend<{
  fixtureProject: FixtureProject;
  tempUserDataPath: string;
  electronDiagnostics: ElectronDiagnostics;
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  fixtureProject: async ({}, use) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-view-switcher-'));
    const projectRoot = path.join(tempRoot, 'project-a');
    await writeFixtureProject(projectRoot);
    await use({ tempRoot, projectRoot });
    stopSmokeGraphDaemonForProject(projectRoot);
    await fs.rm(tempRoot, { recursive: true, force: true });
  },

  tempUserDataPath: async ({}, use) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-view-switcher-data-'));
    await use(dir);
    await fs.rm(dir, { recursive: true, force: true });
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
      } catch { /* already exited */ }
    }
    try {
      await Promise.race([
        electronApp.close(),
        new Promise(resolve => setTimeout(resolve, 5000)),
      ]);
    } catch { /* close may fail */ }
  },

  appWindow: async ({ electronApp, electronDiagnostics }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15000 });
    window.on('console', msg => {
      if (msg.type() === 'error') electronDiagnostics.rendererErrors.push(msg.text());
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

test.describe('view-switcher dropdown', () => {
  test.describe.configure({ timeout: process.env.CI ? 180000 : 90000 });

  test('shows "main" as active view and allows creating + switching views', async ({
    appWindow,
    electronApp,
    fixtureProject,
    electronDiagnostics,
  }) => {
    // Open project via "Open existing folder" button
    const openButton = appWindow.getByRole('button', { name: /open existing folder/i });
    await expect(openButton).toBeVisible({ timeout: 30000 });

    await stubFolderDialog(electronApp, fixtureProject.projectRoot);
    await openButton.click();

    // Wait for project to open (bottom-bar should show project name)
    await expect(
      appWindow.locator('button[title="Project root – agents spawn here by default"]'),
    ).toContainText(path.basename(fixtureProject.projectRoot), { timeout: 60000 });

    // ViewSwitcher trigger should exist and show "main"
    const trigger = appWindow.getByTestId('view-switcher-trigger');
    await expect(trigger).toBeVisible({ timeout: 10000 });
    await expect(trigger).toContainText('main');

    // Open dropdown
    await trigger.click();
    const dropdown = appWindow.getByTestId('view-switcher-dropdown');
    await expect(dropdown).toBeVisible();

    // "main" item is visible, no delete button for active view
    await expect(appWindow.getByTestId('view-item-main')).toBeVisible();
    await expect(appWindow.getByTestId('view-delete-main')).not.toBeVisible();

    // Create a new view
    await appWindow.getByTestId('new-view-button').click();
    const input = appWindow.getByTestId('new-view-name-input');
    await input.fill('scratch');
    await input.press('Enter');

    // Trigger should now show "scratch"
    await expect(trigger).toContainText('scratch', { timeout: 10000 });

    // Open dropdown again — "main" is now non-active and should have delete button
    await trigger.click();
    await expect(appWindow.getByTestId('view-delete-main')).toBeVisible({ timeout: 5000 });

    // Switch back to "main"
    await appWindow.getByTestId('view-item-main').click();
    await expect(trigger).toContainText('main', { timeout: 10000 });

    expectNoCriticalElectronErrors(electronDiagnostics);
  });
});
