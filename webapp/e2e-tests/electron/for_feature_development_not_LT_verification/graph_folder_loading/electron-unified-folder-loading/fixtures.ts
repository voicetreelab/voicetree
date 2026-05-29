import { test as base, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { ExtendedWindow, UnifiedFolderLoadingFixtures } from './types';

const PROJECT_ROOT = path.resolve(process.cwd());

export async function writeProjectConfig(
  userDataPath: string,
  testProjectPath: string,
  primaryProjectPath: string
): Promise<void> {
  const configPath = path.join(userDataPath, 'voicetree-config.json');
  await fs.writeFile(configPath, JSON.stringify({
    lastDirectory: testProjectPath,
    projectConfig: {
      [testProjectPath]: {
        writeFolderPath: primaryProjectPath,
        readPaths: []
      }
    }
  }, null, 2), 'utf8');
}

export async function launchElectronApp(userDataPath: string): Promise<ElectronApplication> {
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
    timeout: 15000
  });
}

export async function stopFileWatching(electronApp: ElectronApplication): Promise<void> {
  const window = await electronApp.firstWindow();
  await window.evaluate(async () => {
    const api = (window as unknown as ExtendedWindow).electronAPI;
    if (api) {
      await api.main.stopFileWatching();
    }
  });
  await window.waitForTimeout(300);
}

async function createProjectWithProjects(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-unified-loading-test-'));
  const primaryProject = path.join(tempDir, 'primary');
  const secondProject = path.join(tempDir, 'second-project');

  await fs.mkdir(primaryProject, { recursive: true });
  await fs.mkdir(secondProject, { recursive: true });

  await fs.writeFile(
    path.join(primaryProject, 'initial-node.md'),
    '# Initial Node\n\nThis is the starting node in primary project.'
  );

  return tempDir;
}

function logBrowserDiagnostics(window: Page): void {
  window.on('console', msg => {
    const text = msg.text();
    if (text.includes('[Unified Loading]') || text.includes('Error')) {
      console.log(`[${msg.type()}] ${text}`);
    }
  });

  window.on('pageerror', error => {
    console.error('PAGE ERROR:', error.message);
  });
}

export const test = base.extend<UnifiedFolderLoadingFixtures>({
  tempUserDataPath: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-unified-loading-userdata-'));
    await use(tempUserDataPath);
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  testProjectPath: async ({}, use) => {
    const tempDir = await createProjectWithProjects();
    await use(tempDir);
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  primaryProjectPath: async ({ testProjectPath }, use) => {
    await use(path.join(testProjectPath, 'primary'));
  },

  secondProjectPath: async ({ testProjectPath }, use) => {
    await use(path.join(testProjectPath, 'second-project'));
  },

  electronApp: async ({ testProjectPath, tempUserDataPath, primaryProjectPath }, use) => {
    await writeProjectConfig(tempUserDataPath, testProjectPath, primaryProjectPath);

    const electronApp = await launchElectronApp(tempUserDataPath);
    await use(electronApp);

    try {
      await stopFileWatching(electronApp);
    } catch {
      console.log('Note: Could not stop file watching during cleanup');
    }

    await electronApp.close();
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15000 });
    logBrowserDiagnostics(window);

    await window.waitForLoadState('domcontentloaded');
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 15000 });
    await window.waitForTimeout(1000);

    await use(window);
  }
});
