import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  WEBAPP_ROOT,
  robustElectronTeardown,
  resolveGraphDaemonNodeBin,
  expectNoCriticalElectronErrors,
  type ElectronDiagnostics
} from './electron-smoke-helpers';

test.describe('Electron CI Launch Fallback', () => {
  test('starts Electron and renders the project selection window', async () => {
    test.setTimeout(process.env.CI ? 45000 : 30000);

    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-launch-ci-'));
    const diagnostics: ElectronDiagnostics = { mainOutput: [], rendererErrors: [] };
    let electronApp: ElectronApplication | undefined;
    let appWindow: Page | undefined;

    try {
      // Seed an empty saved-project list so the launched app deterministically
      // boots into the project selection screen instead of auto-opening a project.
      await fs.writeFile(
        path.join(tempUserDataPath, 'projects.json'),
        JSON.stringify([], null, 2),
        'utf8'
      );

      const ciFlags = process.env.CI
        ? ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader']
        : [];

      electronApp = await electron.launch({
        args: [
          ...ciFlags,
          '--remote-debugging-port=0',
          path.join(WEBAPP_ROOT, 'dist-electron/main/index.js'),
          `--user-data-dir=${tempUserDataPath}`
        ],
        env: {
          ...process.env,
          NODE_ENV: 'test',
          HEADLESS_TEST: '1',
          MINIMIZE_TEST: '1',
          VOICETREE_PERSIST_STATE: '1',
          ENABLE_PLAYWRIGHT_DEBUG: '0',
          VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(),
        },
        timeout: 30000
      });

      // Capture main-process stdout/stderr so native ABI mismatches, daemon
      // startup failures, or devtools bind collisions surface as a failed
      // assertion rather than hiding behind a UI-render timeout.
      const electronProcess = electronApp.process();
      electronProcess?.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        diagnostics.mainOutput.push(text);
        console.log(`[MAIN STDOUT] ${text.trim()}`);
      });
      electronProcess?.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        diagnostics.mainOutput.push(text);
        console.error(`[MAIN STDERR] ${text.trim()}`);
      });

      appWindow = await electronApp.firstWindow({ timeout: 15000 });
      appWindow.on('console', msg => {
        console.log(`BROWSER [${msg.type()}]:`, msg.text());
      });
      appWindow.on('pageerror', error => {
        diagnostics.rendererErrors.push(error.message);
        console.error('PAGE ERROR:', error.message);
      });

      // The Electron window opens on about:blank before navigating to the
      // packaged renderer. Wait for the real URL before asserting DOM content.
      await appWindow.waitForURL(/index\.html$/, { timeout: 15000 });
      await appWindow.waitForLoadState('domcontentloaded');

      // Black-box assertion that the project selection screen actually mounted:
      // header, subtitle, and the always-rendered "Open existing folder" action
      // affordance. All three are state-independent (no race against scanning
      // vs empty vs discovered substates) and together rule out a half-rendered
      // page that merely contains the word "Voicetree".
      await expect(appWindow.locator('h1', { hasText: 'Voicetree' }))
        .toBeVisible({ timeout: 15000 });
      await expect(appWindow.getByText('Select a project to open'))
        .toBeVisible();
      await expect(appWindow.locator('button:has-text("Open existing folder")'))
        .toBeVisible();

      expectNoCriticalElectronErrors(diagnostics);
    } finally {
      if (electronApp) {
        await robustElectronTeardown(electronApp);
      }
      await fs.rm(tempUserDataPath, { recursive: true, force: true });
    }
  });
});
