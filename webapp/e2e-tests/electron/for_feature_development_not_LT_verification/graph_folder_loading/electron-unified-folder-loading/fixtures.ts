import { test as base, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { ExtendedWindow, UnifiedFolderLoadingFixtures } from './types';

const PROJECT_ROOT = path.resolve(process.cwd());

export async function writeVaultConfig(
  userDataPath: string,
  testProjectPath: string,
  primaryVaultPath: string
): Promise<void> {
  const configPath = path.join(userDataPath, 'voicetree-config.json');
  await fs.writeFile(configPath, JSON.stringify({
    lastDirectory: testProjectPath,
    vaultConfig: {
      [testProjectPath]: {
        writeFolderPath: primaryVaultPath,
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

async function createProjectWithVaults(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-unified-loading-test-'));
  const primaryVault = path.join(tempDir, 'primary');
  const secondVault = path.join(tempDir, 'second-vault');

  await fs.mkdir(primaryVault, { recursive: true });
  await fs.mkdir(secondVault, { recursive: true });

  await fs.writeFile(
    path.join(primaryVault, 'initial-node.md'),
    '# Initial Node\n\nThis is the starting node in primary vault.'
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
    const tempDir = await createProjectWithVaults();
    await use(tempDir);
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  primaryVaultPath: async ({ testProjectPath }, use) => {
    await use(path.join(testProjectPath, 'primary'));
  },

  secondVaultPath: async ({ testProjectPath }, use) => {
    await use(path.join(testProjectPath, 'second-vault'));
  },

  electronApp: async ({ testProjectPath, tempUserDataPath, primaryVaultPath }, use) => {
    await writeVaultConfig(tempUserDataPath, testProjectPath, primaryVaultPath);

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
