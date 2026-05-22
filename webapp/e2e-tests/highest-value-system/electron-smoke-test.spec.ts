/**
 * SMOKE TEST for main.ts
 *
 * Pattern: launch Electron with --open-folder → wait for graph → assert.
 * --open-folder sets startupFolderOverride, which makes initialLoad() call
 * loadFolder() directly, bypassing project selection entirely.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { ChildProcess } from 'child_process';
import type { NodeSingular } from 'cytoscape';
import {
  WEBAPP_ROOT,
  type ElectronDiagnostics, type ExtendedWindow,
  resolveGraphDaemonNodeBin, stopSmokeGraphDaemonForVault,
  expectNoCriticalElectronErrors
} from './electron-smoke-helpers';

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const GRACEFUL_QUIT_MS = 3000;
const FORCE_KILL_WAIT_MS = 3000;

async function closeElectronAppForSmoke(
  electronApp: ElectronApplication,
  electronProcess: ChildProcess | null
): Promise<void> {
  try {
    await Promise.race([
      electronApp.evaluate(async ({ app }) => {
        app.quit();
      }),
      delay(GRACEFUL_QUIT_MS)
    ]);
  } catch {
    // The app may already be exiting.
  }

  if (!electronProcess || electronProcess.exitCode !== null || electronProcess.signalCode !== null) {
    return;
  }

  await Promise.race([
    new Promise<void>(resolve => electronProcess.once('exit', () => resolve())),
    delay(GRACEFUL_QUIT_MS)
  ]);

  if (electronProcess.exitCode !== null || electronProcess.signalCode !== null) {
    return;
  }

  if (electronProcess.pid) {
    try {
      process.kill(electronProcess.pid, 'SIGKILL');
    } catch {
      // Electron already exited.
    }
  }

  await Promise.race([
    new Promise<void>(resolve => electronProcess.once('exit', () => resolve())),
    delay(FORCE_KILL_WAIT_MS)
  ]);
}

// Extend test with Electron app
const test = base.extend<{
  fixtureVaultPath: string;
  tempUserDataPath: string;
  electronDiagnostics: ElectronDiagnostics;
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  fixtureVaultPath: async ({}, use) => {
    // macOS sun_path limit is 104 chars; the UDS socket binds at
    // `<vault>/.voicetree/vt.sock`. Keep the fixture path short enough that
    // /var/folders/<hash>/T/<mkdtemp>/.voicetree/vt.sock fits under the cap.
    const tempVaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-vault-'));
    await fs.writeFile(path.join(tempVaultPath, 'root.md'), [
      '# Smoke Root',
      '',
      'Links to [[first-child.md]] and [[second-child.md]].',
      ''
    ].join('\n'), 'utf8');
    await fs.writeFile(path.join(tempVaultPath, 'first-child.md'), [
      '# First Child',
      '',
      'Smoke fixture child node.',
      ''
    ].join('\n'), 'utf8');
    await fs.writeFile(path.join(tempVaultPath, 'second-child.md'), [
      '# Second Child',
      '',
      'Smoke fixture child node.',
      ''
    ].join('\n'), 'utf8');

    await use(tempVaultPath);

    await fs.rm(tempVaultPath, { recursive: true, force: true });
  },

  tempUserDataPath: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-smoke-test-'));
    await use(tempUserDataPath);
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  electronDiagnostics: async ({}, use) => {
    await use({ mainOutput: [], rendererErrors: [] });
  },

  electronApp: async ({ fixtureVaultPath, tempUserDataPath, electronDiagnostics }, use) => {
    // Pin writePath to vault root so the daemon indexes the fixture .md files
    // (without this, initializeProject creates a voicetree-{date} subfolder)
    await fs.writeFile(path.join(tempUserDataPath, 'voicetree-config.json'), JSON.stringify({
      vaultConfig: {
        [fixtureVaultPath]: { writePath: fixtureVaultPath, readPaths: [] }
      }
    }, null, 2), 'utf8');

    const graphDaemonNodeBin = resolveGraphDaemonNodeBin();
    console.log('[Smoke Test] vt-graphd Node:', graphDaemonNodeBin);

    const ciFlags = process.env.CI
      ? ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
      : [];

    const electronApp = await electron.launch({
      args: [
        ...ciFlags,
        path.join(WEBAPP_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`,
        '--open-folder', fixtureVaultPath
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        VOICETREE_PERSIST_STATE: '1',
        VT_GRAPHD_NODE_BIN: graphDaemonNodeBin,
        ENABLE_PLAYWRIGHT_DEBUG: '0'
      },
      timeout: 60000
    });

    const electronProcess = electronApp.process();
    const stdoutHandler = (chunk: Buffer) => {
      const text = chunk.toString();
      electronDiagnostics.mainOutput.push(text);
      console.log(`[MAIN STDOUT] ${text.trim()}`);
    };
    const stderrHandler = (chunk: Buffer) => {
      const text = chunk.toString();
      electronDiagnostics.mainOutput.push(text);
      console.error(`[MAIN STDERR] ${text.trim()}`);
    };
    electronProcess?.stdout?.on('data', stdoutHandler);
    electronProcess?.stderr?.on('data', stderrHandler);

    await use(electronApp);

    await closeElectronAppForSmoke(electronApp, electronProcess);
    electronProcess?.stdout?.off('data', stdoutHandler);
    electronProcess?.stderr?.off('data', stderrHandler);
    stopSmokeGraphDaemonForVault(fixtureVaultPath);
    console.log('[Smoke Test] Electron app closed');
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

    // --open-folder triggers auto-load: initialLoad() → loadFolder() → graph view.
    // Use timer-based polling (not rAF) — headless Electron on CI throttles
    // requestAnimationFrame, causing waitForFunction's default raf polling to
    // never observe cytoscapeInstance despite it being set.
    await expect.poll(async () => {
      return await window.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        return !!cy && !cy.destroyed();
      });
    }, {
      message: 'Waiting for Cytoscape to initialize via --open-folder auto-load',
      timeout: 30000,
      intervals: [250, 500, 1000, 2000]
    }).toBe(true);
    console.log('[Smoke Test] Graph view loaded via --open-folder auto-load');

    await use(window);
  }
});

test.describe('Smoke Test', () => {
  test.describe.configure({ timeout: process.env.CI ? 120000 : 60000 });

  test('should start app and load graph after project selection', async ({ appWindow, electronDiagnostics }) => {
    console.log('=== SMOKE TEST: Verify Electron app compiles, starts, and loads graph ===');

    const appReady = await appWindow.evaluate(() => {
      return !!(window as ExtendedWindow).cytoscapeInstance &&
             !!(window as ExtendedWindow).electronAPI;
    });
    expect(appReady).toBe(true);
    console.log('✓ App loaded successfully with graph view');

    await expect.poll(async () => {
      return await appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        return cy?.nodes().length ?? 0;
      });
    }, {
      message: 'Waiting for Cytoscape nodes to render',
      timeout: 45000,
      intervals: [500, 1000, 2000, 3000]
    }).toBeGreaterThan(2);
    console.log('✓ Cytoscape nodes loaded');

    const graph = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getGraph();
    });

    expect(graph).toBeDefined();
    expectNoCriticalElectronErrors(electronDiagnostics);
    const nodeCount = Object.keys(graph.nodes).length;
    console.log(`✓ Graph loaded into state with ${nodeCount} nodes`);
    expect(nodeCount).toBeGreaterThan(1);

    const cytoscapeState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return {
        nodeCount: cy.nodes().length,
        nodeLabels: cy.nodes().map((n: NodeSingular) => n.data('label')).slice(0, 3)
      };
    });

    console.log(`✓ Graph rendered in UI with ${cytoscapeState.nodeCount} nodes`);
    console.log('  Sample labels:', cytoscapeState.nodeLabels.join(', '));

    expect(cytoscapeState.nodeCount).toBeGreaterThan(2);

    const backButton = appWindow.locator('button[title="Back to project selection"]');
    await expect(backButton).toBeVisible({ timeout: 5000 });
    console.log('✓ Back button visible (confirms graph view with project selection integration)');

    expectNoCriticalElectronErrors(electronDiagnostics);
    console.log('✅ Smoke test passed!');
  });
});

export { test };
