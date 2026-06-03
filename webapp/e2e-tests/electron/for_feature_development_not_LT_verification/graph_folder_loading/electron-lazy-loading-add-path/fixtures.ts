import { test as base, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { ExtendedWindow } from './types';
import {
  writeFileChangeReadProject,
  writeInitialFileChangeProject,
  writeInitialLinkedProject,
  writeLinkedReadProject
} from './test-data';

const PROJECT_ROOT = path.resolve(process.cwd());

type LazyLoadingFixtures = {
  electronApp: ElectronApplication;
  appWindow: Page;
  testDir: string;
  writeFolderPath: string;
  readPath: string;
};

async function createTempDirectory(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeProjectConfig(
  userDataPath: string,
  testDir: string,
  writeFolderPath: string,
  readPaths: string[]
): Promise<void> {
  const configPath = path.join(userDataPath, 'voicetree-config.json');
  await fs.writeFile(
    configPath,
    JSON.stringify({
      lastDirectory: testDir,
      projectConfig: {
        [testDir]: {
          writeFolderPath,
          readPaths
        }
      }
    }, null, 2),
    'utf8'
  );
}

async function launchElectronApp(userDataPath: string): Promise<ElectronApplication> {
  return await electron.launch({
    args: [
      path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
      `--user-data-dir=${userDataPath}`
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

async function closeAppAndRemoveUserData(electronApp: ElectronApplication, userDataPath: string): Promise<void> {
  await electronApp.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
}

async function loadGraphWindow(
  electronApp: ElectronApplication,
  attachWindowListeners: (window: Page) => void
): Promise<Page> {
  const window = await electronApp.firstWindow({ timeout: 10000 });
  attachWindowListeners(window);
  await window.waitForLoadState('domcontentloaded');
  await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
  await window.waitForTimeout(1000);
  return window;
}

function logLazyLoadingBrowserMessages(window: Page): void {
  window.on('console', msg => {
    const text = msg.text();
    if (text.includes('Lazy loaded') || text.includes('[loadFolder]') || text.includes('[handleFSEvent]')) {
      console.log(`[Browser] ${text}`);
    }
  });
}

function logFileChangeBrowserMessages(window: Page): void {
  window.on('console', msg => {
    const text = msg.text();
    if (
      text.includes('Lazy loaded') ||
      text.includes('[loadFolder]') ||
      text.includes('[handleFSEvent]') ||
      text.includes('resolveLinkedNodes') ||
      text.includes('resolveNewLinksToReadOnLinkPaths')
    ) {
      console.log(`[Browser] ${text}`);
    }
  });
}

function logFileChangeMainProcessMessages(electronApp: ElectronApplication): void {
  electronApp.process().stdout?.on('data', (data: Buffer) => {
    const text = data.toString();
    if (text.includes('resolveNewLinksToReadOnLinkPaths') || text.includes('[handleFSEvent]') || text.includes('[loadFolder]')) {
      console.log(`[Main] ${text.trim()}`);
    }
  });
  electronApp.process().stderr?.on('data', (data: Buffer) => {
    const text = data.toString();
    if (text.includes('resolveNewLinksToReadOnLinkPaths') || text.includes('[handleFSEvent]') || text.includes('[loadFolder]')) {
      console.log(`[Main STDERR] ${text.trim()}`);
    }
  });
}

export const test = base.extend<LazyLoadingFixtures>({
  testDir: async ({}, use) => {
    const tempDir = await createTempDirectory('voicetree-lazy-load-test-');
    await use(tempDir);
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  writeFolderPath: async ({ testDir }, use) => {
    const writeFolderPath = path.join(testDir, 'write-project');
    await fs.mkdir(writeFolderPath, { recursive: true });
    await writeInitialLinkedProject(writeFolderPath);
    await use(writeFolderPath);
  },

  readPath: async ({ testDir }, use) => {
    const readPath = path.join(testDir, 'read-project');
    await fs.mkdir(readPath, { recursive: true });
    await writeLinkedReadProject(readPath);
    await use(readPath);
  },

  electronApp: async ({ testDir, writeFolderPath }, use) => {
    const tempUserDataPath = await createTempDirectory('voicetree-lazy-load-userdata-');

    await writeProjectConfig(tempUserDataPath, testDir, writeFolderPath, []);
    console.log('[Lazy Load Test] Config created for:', testDir);

    const electronApp = await launchElectronApp(tempUserDataPath);
    await use(electronApp);

    try {
      await stopFileWatching(electronApp);
    } catch {
      console.log('Note: Could not stop file watching during cleanup');
    }

    await closeAppAndRemoveUserData(electronApp, tempUserDataPath);
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await loadGraphWindow(electronApp, page => {
      logLazyLoadingBrowserMessages(page);
      page.on('pageerror', error => {
        console.error('PAGE ERROR:', error.message);
      });
    });
    await use(window);
  }
});

export const testFileChange = base.extend<LazyLoadingFixtures>({
  testDir: async ({}, use) => {
    const tempDir = await createTempDirectory('voicetree-file-change-test-');
    await use(tempDir);
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  writeFolderPath: async ({ testDir }, use) => {
    const writeFolderPath = path.join(testDir, 'write-project');
    await fs.mkdir(writeFolderPath, { recursive: true });
    await writeInitialFileChangeProject(writeFolderPath);
    await use(writeFolderPath);
  },

  readPath: async ({ testDir }, use) => {
    const readPath = path.join(testDir, 'read-project');
    await fs.mkdir(readPath, { recursive: true });
    await writeFileChangeReadProject(readPath);
    await use(readPath);
  },

  electronApp: async ({ testDir, writeFolderPath, readPath }, use) => {
    const tempUserDataPath = await createTempDirectory('voicetree-file-change-userdata-');

    await writeProjectConfig(tempUserDataPath, testDir, writeFolderPath, [readPath]);
    console.log('[Test Setup] Config saved. testDir:', testDir, 'writeFolderPath:', writeFolderPath, 'readPath:', readPath);

    const electronApp = await launchElectronApp(tempUserDataPath);
    logFileChangeMainProcessMessages(electronApp);

    await use(electronApp);

    try {
      await stopFileWatching(electronApp);
    } catch {
      // ignore
    }

    await closeAppAndRemoveUserData(electronApp, tempUserDataPath);
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await loadGraphWindow(electronApp, logFileChangeBrowserMessages);
    await use(window);
  }
});
