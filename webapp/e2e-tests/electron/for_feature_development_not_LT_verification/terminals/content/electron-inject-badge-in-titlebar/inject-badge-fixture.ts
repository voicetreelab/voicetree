import { test as base, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-inject-badge-test-'));

    // Create projects.json with a pre-saved project (required for project selection)
    const projectsPath = path.join(tempUserDataPath, 'projects.json');
    const savedProject = {
      id: 'inject-badge-test-project',
      path: FIXTURE_VAULT_PATH,
      name: 'example_small',
      type: 'folder',
      lastOpened: Date.now(),
      voicetreeInitialized: true
    };
    await fs.writeFile(projectsPath, JSON.stringify([savedProject], null, 2), 'utf8');

    // Legacy config for backwards compatibility
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: FIXTURE_VAULT_PATH }, null, 2), 'utf8');

    // Write settings.json with the echo command as a valid agent
    // (spawnTerminalWithContextNode validates commands against settings.agents)
    const settingsPath = path.join(tempUserDataPath, 'settings.json');
    await fs.writeFile(settingsPath, JSON.stringify({
      agents: [
        { name: 'TestEcho', command: 'echo INJECT_BADGE_TEST' }
      ]
    }, null, 2), 'utf8');
    console.log('[Test] Created config files for:', FIXTURE_VAULT_PATH);

    const electronApp = await electron.launch({
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

    await use(electronApp);

    try {
      const window = await electronApp.firstWindow();
      await window.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (api) {
          await api.main.stopFileWatching();
        }
      });
      await window.waitForTimeout(300);
    } catch {
      console.log('Note: Could not stop file watching during cleanup');
    }

    await electronApp.close();
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

    // Navigate through project selection screen
    await window.waitForSelector('text=Voicetree', { timeout: 10000 });
    console.log('[Test] Project selection screen loaded');

    // Wait for saved projects to appear and click to open
    await window.waitForSelector('text=Recent Projects', { timeout: 10000 });
    const projectButton = window.locator('button:has-text("example_small")').first();
    await projectButton.click();
    console.log('[Test] Clicked project to navigate to graph view');

    // Wait for cytoscape to initialize
    try {
      await window.waitForFunction(
        () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
        { timeout: 15000 }
      );
    } catch (error) {
      console.error('Failed to initialize cytoscape instance:', error);
      throw error;
    }

    await window.waitForTimeout(1000);

    await use(window);
  }
});

export { FIXTURE_VAULT_PATH, test };
export type { ExtendedWindow };
