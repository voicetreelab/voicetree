import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { ExtendedWindow, FolderManagementFixtures } from './types';

const PROJECT_ROOT = path.resolve(process.cwd());

export { expect };

async function createTestProject(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-folder-mgmt-test-'));

  await fs.writeFile(
    path.join(tempDir, 'root-node.md'),
    '# Root Node\n\nTest node in project root.'
  );

  const folders = ['notes', 'docs', 'archive', 'projects'];
  for (const folder of folders) {
    const folderPath = path.join(tempDir, folder);
    await fs.mkdir(folderPath, { recursive: true });
    await fs.writeFile(
      path.join(folderPath, `${folder}-node.md`),
      `# ${folder.charAt(0).toUpperCase() + folder.slice(1)} Node\n\nTest node in ${folder} folder.`
    );
  }

  const nestedPath = path.join(tempDir, 'projects', 'subproject');
  await fs.mkdir(nestedPath, { recursive: true });
  await fs.writeFile(
    path.join(nestedPath, 'nested-node.md'),
    '# Nested Node\n\nTest node in nested folder.'
  );

  return tempDir;
}

async function writeAutoLoadConfig(userDataPath: string, testProjectPath: string): Promise<string> {
  const configPath = path.join(userDataPath, 'voicetree-config.json');
  const notesPath = path.join(testProjectPath, 'notes');

  await fs.writeFile(configPath, JSON.stringify({
    lastDirectory: notesPath
  }, null, 2), 'utf8');

  return notesPath;
}

async function launchFolderManagementApp(
  testProjectPath: string,
  tempUserDataPath: string
): Promise<ElectronApplication> {
  const notesPath = await writeAutoLoadConfig(tempUserDataPath, testProjectPath);
  console.log('[Folder Management Test] Created config to auto-load:', notesPath);

  return await electron.launch({
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
    timeout: 15000
  });
}

async function stopFileWatching(electronApp: ElectronApplication): Promise<void> {
  const window = await electronApp.firstWindow();
  await window.evaluate(async () => {
    const api = (window as unknown as ExtendedWindow).hostAPI;
    if (api) {
      await api.main.stopFileWatching();
    }
  });
  await window.waitForTimeout(300);
}

function attachWindowDiagnostics(window: Page): void {
  window.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`[BROWSER ${msg.type()}]:`, msg.text());
    }
  });

  window.on('pageerror', error => {
    console.error('PAGE ERROR:', error.message);
  });
}

async function saveProjectForSelection(window: Page, folderPath: string, projectName: string): Promise<void> {
  await window.evaluate(async (params: { folderPath: string; projectName: string }) => {
    const api = (window as ExtendedWindow).hostAPI;
    if (!api) throw new Error('hostAPI not available');

    const project = {
      id: crypto.randomUUID(),
      path: params.folderPath,
      name: params.projectName,
      type: 'folder' as const,
      lastOpened: Date.now(),
    };
    await api.main.saveProject(project);
  }, { folderPath, projectName });
}

async function selectProjectFromPicker(window: Page, testProjectPath: string): Promise<void> {
  console.log('[appWindow] Project selection screen detected - adding test project');

  const notesPath = path.join(testProjectPath, 'notes');
  const projectName = 'test-folder-mgmt';

  await window.waitForFunction(() => !!(window as unknown as ExtendedWindow).hostAPI, { timeout: 5000 });
  await saveProjectForSelection(window, notesPath, projectName);

  console.log('[appWindow] Project saved, waiting for it to appear in list');
  await window.waitForTimeout(500);

  const projectButton = window.locator(`button:has-text("${projectName}")`);
  const projectVisible = await projectButton.isVisible({ timeout: 3000 }).catch(() => false);

  if (projectVisible) {
    console.log('[appWindow] Clicking on test project to select it');
    await projectButton.click();
  } else {
    console.log('[appWindow] Project not found in list, reloading and trying again');
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    const projectButtonRetry = window.locator(`button:has-text("${projectName}")`);
    await projectButtonRetry.click({ timeout: 5000 });
  }

  console.log('[appWindow] Project selected');
}

async function loadAppWindow(electronApp: ElectronApplication, testProjectPath: string): Promise<Page> {
  const window = await electronApp.firstWindow({ timeout: 15000 });
  attachWindowDiagnostics(window);

  await window.waitForLoadState('domcontentloaded');

  const isProjectSelection = await window
    .locator('text=Select a project to open')
    .isVisible({ timeout: 3000 })
    .catch(() => false);

  if (isProjectSelection) {
    await selectProjectFromPicker(window, testProjectPath);
  }

  await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 20000 });
  await window.waitForTimeout(1000);

  return window;
}

export const test = base.extend<FolderManagementFixtures>({
  testProjectPath: async ({}, use) => {
    const tempDir = await createTestProject();
    await use(tempDir);
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  tempUserDataPath: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-folder-mgmt-userdata-'));
    await use(tempUserDataPath);
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  electronApp: async ({ testProjectPath, tempUserDataPath }, use) => {
    const electronApp = await launchFolderManagementApp(testProjectPath, tempUserDataPath);
    await use(electronApp);

    try {
      await stopFileWatching(electronApp);
    } catch {
      console.log('Note: Could not stop file watching during cleanup');
    }

    await electronApp.close();
  },

  appWindow: async ({ electronApp, testProjectPath }, use) => {
    const window = await loadAppWindow(electronApp, testProjectPath);
    await use(window);
  }
});
