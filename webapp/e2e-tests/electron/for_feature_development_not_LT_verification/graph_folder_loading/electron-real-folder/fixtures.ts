import { test as base, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { ExtendedWindow, RealFolderFixtures } from './types';
import {
  deleteProjectFilesIfPresent,
  FIXTURE_PROJECT_PATH,
  INCREMENTAL_TEST_FILE_NAMES,
  PROJECT_ROOT
} from './fs-helpers';

export { expect };

export const test = base.extend<RealFolderFixtures>({
  electronApp: async ({}, use) => {
    // Create a temporary userData directory for this test (like smoke test does)
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-real-folder-test-'));

    // Write the config file to auto-load the test project (like smoke test does)
    // IMPORTANT: Set empty suffix so it uses the directory directly, not directory/voicetree
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({
      lastDirectory: FIXTURE_PROJECT_PATH,
      suffixes: {
        [FIXTURE_PROJECT_PATH]: '' // Empty suffix means use directory directly
      }
    }, null, 2), 'utf8');
    console.log('[Real Folder Test] Created config file to auto-load:', FIXTURE_PROJECT_PATH);

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}` // Use temp userData to isolate test config
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1' // Minimize window to avoid dialog popups
      },
      timeout: 10000 // Standard timeout for app launch
    });

    await use(electronApp);

    // Graceful shutdown: Stop file watching before closing app
    // This prevents EPIPE errors from file watcher trying to log after stdout closes
    try {
      const window = await electronApp.firstWindow();
      await window.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).hostAPI;
        if (api) {
          await api.main.stopFileWatching();
        }
      });
      // Wait for pending file system events to drain
      await window.waitForTimeout(300);
    } catch {
      // Window might already be closed, that's okay
      console.log('Note: Could not stop file watching during cleanup (window may be closed)');
    }

    await electronApp.close();
    console.log('[Real Folder Test] Electron app closed');

    // Cleanup temp directory
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 10000 });

    // Log console messages for debugging
    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    // Capture page errors
    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
      console.error('Stack:', error.stack);
    });

    await window.waitForLoadState('domcontentloaded');

    // Check for errors before waiting for cytoscapeInstance
    const hasErrors = await window.evaluate(() => {
      const errors: string[] = [];
      // Check if React rendered
      if (!document.querySelector('#root')) errors.push('No #root element');
      // Check if any error boundaries triggered
      const errorText = document.body.textContent;
      if (errorText?.includes('Error') || errorText?.includes('error')) {
        errors.push(`Page contains error text: ${errorText.substring(0, 200)}`);
      }
      return errors;
    });

    if (hasErrors.length > 0) {
      console.error('Pre-initialization errors:', hasErrors);
    }

    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });

    // Wait a bit longer to ensure graph is ready
    await window.waitForTimeout(1000);

    await use(window);
  }
});

test.afterEach(async ({ appWindow }) => {
  // Stop file watching BEFORE cleaning up files to prevent EPIPE errors
  try {
    await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).hostAPI;
      if (api) {
        await api.main.stopFileWatching();
      }
    });
    // Brief wait to let file watcher fully stop
    await appWindow.waitForTimeout(200);
  } catch {
    // Window might be closed, that's okay
  }

  await deleteProjectFilesIfPresent(INCREMENTAL_TEST_FILE_NAMES);
});
