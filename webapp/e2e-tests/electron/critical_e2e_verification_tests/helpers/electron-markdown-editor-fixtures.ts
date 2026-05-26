// Shared Playwright fixtures + helpers for the markdown-editor Electron specs.
// Extracted from electron-markdown-editors-crud-v2.spec.ts when the file
// crossed the 500-line ceiling. Each spec consumes `test`, type defs, and
// `expectFrontmatterShapePreserved` from here so behaviour is identical across
// the (now split) crud-v2 + external-sync specs.

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import {
  pollForCytoscape,
  resolveGraphDaemonNodeBin,
  robustElectronTeardown,
  safeStopFileWatching,
} from '@e2e/electron/critical_e2e_verification_tests/electron-smoke-helpers';

export const PROJECT_ROOT = path.resolve(process.cwd());

// FIXTURE_VAULT_PATH is the watched directory. The app uses a default
// vaultSuffix of 'voicetree' so files are in FIXTURE_VAULT_PATH/voicetree/,
// and node IDs include this prefix (e.g., "voicetree/2025-09-30/file.md").
export const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_real_large');

export interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: {
    main: {
      startFileWatching: (dir: string) => Promise<{ success: boolean; directory?: string; error?: string }>;
      stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
      getWatchStatus: () => Promise<{ isWatching: boolean; directory?: string }>;
    };
  };
}

export function expectFrontmatterShapePreserved(savedContent: string, originalContent: string): void {
  if (originalContent.startsWith('---\n')) {
    expect(savedContent).toMatch(/^---\n/);
    return;
  }
  expect(savedContent).not.toMatch(/^---\n/);
}

export const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  // Each test gets isolated userData to prevent state pollution.
  electronApp: [async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-editor-test-'));

    // Config file auto-loads the test vault; without it the graph never
    // populates the in-memory store.
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: FIXTURE_VAULT_PATH }, null, 2), 'utf8');

    const ciFlags = process.env.CI
      ? ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader']
      : [];
    const electronApp = await electron.launch({
      args: [
        ...ciFlags,
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`,
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
        VOICETREE_PERSIST_STATE: '1',
        VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(),
      },
    });

    await use(electronApp);

    // Stop file watching before teardown to avoid EPIPE noise from the
    // watcher logging after stdout closes.
    await safeStopFileWatching(electronApp);
    await robustElectronTeardown(electronApp);
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  }, { timeout: 45000 }],

  appWindow: [async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();

    page.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });
    page.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
      console.error('Stack:', error.stack);
    });

    await page.waitForLoadState('domcontentloaded');

    const hasErrors = await page.evaluate(() => {
      const errors: string[] = [];
      if (!document.querySelector('#root')) errors.push('No #root element');
      const errorText = document.body.textContent;
      if (errorText?.includes('Error') || errorText?.includes('error')) {
        errors.push(`Page contains error text: ${errorText.substring(0, 200)}`);
      }
      return errors;
    });

    if (hasErrors.length > 0) {
      console.error('Pre-initialization errors:', hasErrors);
    }

    await pollForCytoscape(page, 45000);
    // Allow the auto-load triggered by lastDirectory to finish.
    await page.waitForTimeout(500);

    await use(page);
  }, { timeout: 60000 }],
});

/**
 * Shared after-each: stops file watching before per-test cleanup so test
 * teardown doesn't race chokidar events into a closing window.
 */
export function registerStopFileWatchingAfterEach(): void {
  test.afterEach(async ({ appWindow }) => {
    try {
      await appWindow.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (api) {
          await api.main.stopFileWatching();
        }
      });
      await appWindow.waitForTimeout(200);
    } catch {
      // Window might already be closed; that's okay.
    }
  });
}
