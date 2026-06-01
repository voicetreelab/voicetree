/**
 * Tier 2 black-box e2e: opens project A through the "Open existing folder"
 * button on ProjectSelectionScreen, then switches to project B through the
 * File menu — the actual paths a user takes.
 *
 * No preseeding: the userData dir starts empty (no voicetree-config.json,
 * no --open-folder). The only test affordance is monkey-patching the
 * native folder dialog to return the fixture project paths, since Playwright
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
  stopSmokeGraphDaemonForProject,
  expectNoCriticalElectronErrors,
} from './electron-smoke-helpers';

type FixtureProjects = {
  readonly tempRoot: string;
  readonly projectAPath: string;
  readonly projectBPath: string;
};

async function writeFixtureProject(projectRoot: string, label: string): Promise<void> {
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(path.join(projectRoot, 'root.md'), [
    `# ${label} Root`,
    '',
    `Links to [[${label} First.md]] and [[${label} Second.md]].`,
    '',
  ].join('\n'), 'utf8');
  await fs.writeFile(path.join(projectRoot, `${label} First.md`), [
    `# ${label} First`,
    '',
    `First child in ${label}.`,
    '',
  ].join('\n'), 'utf8');
  await fs.writeFile(path.join(projectRoot, `${label} Second.md`), [
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
 * switches projects while one is already loaded, and it's the path that exercises
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

function expectNoProjectSwitchErrors(diagnostics: ElectronDiagnostics): void {
  expectNoCriticalElectronErrors(diagnostics);

  const criticalErrorPatterns = [
    /\[RPC Error\]/i,
    /Error invoking remote method/i,
    /No project is currently open/i,
    /Watched directory not initialized/i,
  ];
  const criticalErrors = [...diagnostics.mainOutput, ...diagnostics.rendererErrors]
    .filter(line => criticalErrorPatterns.some(pattern => pattern.test(line)));

  expect(criticalErrors).toEqual([]);
}

const test = base.extend<{
  fixtureProjects: FixtureProjects;
  tempUserDataPath: string;
  electronDiagnostics: ElectronDiagnostics;
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  fixtureProjects: async ({}, use) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-ui-project-switch-'));
    const projectAPath = path.join(tempRoot, 'project-a');
    const projectBPath = path.join(tempRoot, 'project-b');

    await writeFixtureProject(projectAPath, 'Project A');
    await writeFixtureProject(projectBPath, 'Project B');

    await use({ tempRoot, projectAPath, projectBPath });

    stopSmokeGraphDaemonForProject(projectAPath);
    stopSmokeGraphDaemonForProject(projectBPath);
    await fs.rm(tempRoot, { recursive: true, force: true });
  },

  tempUserDataPath: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-ui-project-switch-data-'));
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

test.describe('Electron Project Switch via UI Tier 2', () => {
  test.describe.configure({ timeout: process.env.CI ? 180000 : 90000 });

  test('opens project A via "Open existing folder", then switches to project B via File menu', async ({
    appWindow,
    electronApp,
    fixtureProjects,
    electronDiagnostics,
  }) => {
    // Clean userData → app must boot to ProjectSelectionScreen.
    const openExistingFolderButton = appWindow.getByRole('button', { name: /open existing folder/i });
    await expect(openExistingFolderButton).toBeVisible({ timeout: 30000 });

    // Stub dialog → project A. The button click triggers showFolderPicker in the
    // main process, which calls dialog.showOpenDialog.
    await stubFolderDialog(electronApp, fixtureProjects.projectAPath);
    await openExistingFolderButton.click();

    // Graph view must render and the watch panel must show project A's folder.
    // The watch-directory button (title attribute matches App.tsx FileWatchingPanel)
    // is the user-visible signal that project A is the active project.
    const watchDirectoryButton = appWindow.locator(
      'button[title="Project root – agents spawn here by default"]',
    );
    const projectAName = path.basename(fixtureProjects.projectAPath);
    await expect(watchDirectoryButton).toContainText(projectAName, { timeout: 60000 });

    // Switch projects while A is loaded — this is the path where
    // doLoadFolder sees previousRoot=A and tries to save positions through
    // the daemon, which is what caused the original failure.
    await stubFolderDialog(electronApp, fixtureProjects.projectBPath);
    await clickFileOpenFolderMenu(electronApp);

    // UI must swap to project B. If the switch failed (the original bug), the
    // watch directory would stay on project A and this assertion would time out.
    const projectBName = path.basename(fixtureProjects.projectBPath);
    await expect(watchDirectoryButton).toContainText(projectBName, { timeout: 60000 });

    // No RPC errors or "project not open" diagnostics around the switch.
    expectNoProjectSwitchErrors(electronDiagnostics);
  });
});
