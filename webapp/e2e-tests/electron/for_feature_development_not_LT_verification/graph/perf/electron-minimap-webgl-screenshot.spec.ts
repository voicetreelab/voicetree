/**
 * Electron E2E test: Verify the cytoscape-navigator minimap renders with WebGL
 *
 * Uses the real Electron app (not headless browser) so WebGL is available and
 * the minimap thumbnail actually renders graph content via cy.png().
 *
 * IMPORTANT: This test uses MINIMIZE_TEST=0 because the GPU compositor needs a
 * visible window to produce real frames for cy.png() inside the navigator's
 * throttled onRender handler.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';

const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: {
    main: {
      stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
      startFileWatching: (dir: string) => Promise<{ success: boolean; directory: string }>;
      saveProject: (project: {
        id: string; path: string; name: string;
        type: 'folder'; lastOpened: number; voicetreeInitialized: boolean;
      }) => Promise<void>;
    };
  };
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: [async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-minimap-test-'));

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        // Window must be visible for the GPU compositor to produce real frames.
        // Without this, environment-config.ts defaults MINIMIZE_TEST=1 in test mode
        // which calls mainWindow.hide(), preventing cy.png() from producing data
        // inside the navigator's throttled onRender handler.
        MINIMIZE_TEST: '0',
        VOICETREE_PERSIST_STATE: '1',
      },
      timeout: 10000
    });

    await use(electronApp);

    try {
      const page = await electronApp.firstWindow();
      await page.evaluate(async () => {
        const api = (window as ExtendedWindow).electronAPI;
        if (api) {
          await api.main.stopFileWatching();
        }
      });
      await page.waitForTimeout(300);
    } catch {
      console.log('Note: Could not stop file watching during cleanup');
    }

    await electronApp.close();
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  }, { timeout: 30000 }],

  appWindow: [async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    page.on('console', msg => console.log(`BROWSER [${msg.type()}]:`, msg.text()));
    await page.waitForLoadState('domcontentloaded');

    // App starts on ProjectSelectionScreen — programmatically save a project
    // and start file watching to trigger the onWatchingStarted auto-switch
    await page.evaluate(async (vaultPath) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');

      await api.main.saveProject({
        id: 'minimap-test-project',
        path: vaultPath,
        name: 'Minimap Test',
        type: 'folder',
        lastOpened: Date.now(),
        voicetreeInitialized: true,
      });

      await api.main.startFileWatching(vaultPath);
    }, FIXTURE_VAULT_PATH);

    // Wait for cytoscape to initialize (graph view loaded)
    await page.waitForFunction(
      () => (window as ExtendedWindow).cytoscapeInstance,
      { timeout: 15000 }
    );
    await page.waitForTimeout(500);

    await use(page);
  }, { timeout: 25000 }]
});

test('minimap should render graph thumbnail in Electron with WebGL', async ({ appWindow }) => {
  test.setTimeout(30000);

  // Wait for graph nodes to load from the fixture vault
  await appWindow.waitForFunction(() => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    return cy && cy.nodes().length >= 2;
  }, { timeout: 10000 });

  // Fit graph to trigger initial render
  await appWindow.evaluate(() => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (cy) {
      cy.fit(undefined, 50);
    }
  });

  // Wait for layout animation + navigator's throttled render handler (rerenderDelay: 100ms)
  await appWindow.waitForTimeout(2000);

  // Verify minimap is visible
  const navigatorEl = appWindow.locator('.cytoscape-navigator');
  await expect(navigatorEl).toBeVisible();

  // Verify WebGL is active
  const webglActive = await appWindow.evaluate(() => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (!cy) return false;
    const renderer = (cy as unknown as { renderer: () => { webgl?: boolean } }).renderer();
    return !!renderer.webgl;
  });
  expect(webglActive).toBe(true);

  // Trigger a pan to produce render events for the navigator's thumbnail handler
  await appWindow.evaluate(() => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (cy) {
      const pan = cy.pan();
      cy.pan({ x: pan.x + 10, y: pan.y });
      cy.pan(pan);
    }
  });
  await appWindow.waitForTimeout(500);

  // Verify the navigator thumbnail has image data.
  // The initializeNavigatorMinimap fix emits cy.emit('resize') when the navigator
  // transitions from hidden→visible, refreshing the navigator's cached panelWidth/
  // panelHeight so cy.png({scale: ...}) produces valid data.
  const imgSrc = await appWindow.evaluate(() => {
    const img = document.querySelector('.cytoscape-navigator img') as HTMLImageElement | null;
    return img?.getAttribute('src')?.substring(0, 50) ?? null;
  });
  expect(imgSrc).not.toBeNull();
  expect(imgSrc).toContain('data:image/png');

  // Take screenshots for visual verification
  await navigatorEl.screenshot({
    path: 'e2e-tests/screenshots/minimap-webgl-electron-thumbnail.png',
  });
  await appWindow.screenshot({
    path: 'e2e-tests/screenshots/minimap-webgl-electron-full.png',
  });
});

export { test };
