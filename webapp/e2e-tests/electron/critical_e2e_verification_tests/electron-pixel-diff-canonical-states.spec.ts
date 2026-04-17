/**
 * Pixel-diff harness for canonical UI states — V-L3-1 claim.
 * Verifies ≤1% pixel diff across N=8 canonical UI states after
 * the cytoscape-ui-decoupling epic (L0+L1+L2 migrations).
 *
 * States covered:
 *   01 project-selection-screen   05 zoom-2x
 *   02 graph-loaded               06 zoom-half
 *   03 single-selected            07 pan-offset
 *   04 multi-selected             08 fit-all
 *
 * Skipped (hover-editor, floating-terminal): too flaky for pixel-diff —
 * UI chrome depends on mouse position and async React state; N=8 ≥ min N=5.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');
const SCREENSHOT_OPTS = { maxDiffPixelRatio: 0.01 } as const;

interface ExtendedWindow {
  cytoscapeInstance?: {
    nodes: () => {
      length: number;
      first: () => { select: () => void };
      slice: (start: number, end: number) => { select: () => void };
      unselect: () => void;
    };
    zoom: (level: number) => void;
    pan: (pos: { x: number; y: number }) => void;
    center: () => void;
    fit: (eles?: unknown, padding?: number) => void;
  };
  electronAPI?: { main: { stopFileWatching: () => Promise<void> } };
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appPage: Page;
}>({
  electronApp: async ({}, use) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-pixel-diff-'));
    await fs.writeFile(
      path.join(tempDir, 'projects.json'),
      JSON.stringify([{
        id: 'pixel-diff-project',
        path: FIXTURE_VAULT_PATH,
        name: 'example_small',
        type: 'folder',
        lastOpened: Date.now(),
        voicetreeInitialized: true,
      }], null, 2),
      'utf8'
    );

    const app = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempDir}`,
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
        VOICETREE_PERSIST_STATE: '1',
      },
      timeout: 15000,
    });

    await use(app);

    try {
      const page = await app.firstWindow();
      await page.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (api) await api.main.stopFileWatching();
      });
      await page.waitForTimeout(300);
    } catch { /* window may be closed */ }
    await app.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  appPage: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow({ timeout: 15000 });
    page.on('console', msg => console.log(`[BROWSER ${msg.type()}]`, msg.text()));
    page.on('pageerror', err => console.error('[PAGE ERROR]', err.message));
    await page.waitForLoadState('domcontentloaded');
    await use(page);
  },
});

test.describe('Pixel-diff: canonical UI states', () => {
  test('8 canonical states ≤1% pixel diff', async ({ appPage }) => {
    test.setTimeout(120_000);

    // ── STATE 01: project selection screen ────────────────────────────
    await appPage.waitForSelector('text=Voicetree', { timeout: 10000 });
    await appPage.waitForSelector('text=Recent Projects', { timeout: 10000 });
    await appPage.waitForTimeout(500);
    await expect(appPage).toHaveScreenshot('state-01-project-selection.png', SCREENSHOT_OPTS);
    console.log('✓ State 01: project selection screen');

    // Navigate into graph view
    await appPage.locator('button:has-text("example_small")').first().click();
    await appPage.waitForFunction(
      () => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        return cy ? cy.nodes().length > 0 : false;
      },
      { timeout: 15000 }
    );
    await appPage.waitForTimeout(1500); // let layout animations settle

    // ── STATE 02: graph loaded ────────────────────────────────────────
    await expect(appPage).toHaveScreenshot('state-02-graph-loaded.png', SCREENSHOT_OPTS);
    console.log('✓ State 02: graph loaded');

    // ── STATE 03: single node selected ───────────────────────────────
    await appPage.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return;
      cy.nodes().unselect();
      cy.nodes().first().select();
    });
    await appPage.waitForTimeout(300);
    await expect(appPage).toHaveScreenshot('state-03-single-selected.png', SCREENSHOT_OPTS);
    console.log('✓ State 03: single node selected');

    // ── STATE 04: multi-node selected ─────────────────────────────────
    await appPage.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return;
      cy.nodes().unselect();
      cy.nodes().slice(0, 2).select();
    });
    await appPage.waitForTimeout(300);
    await expect(appPage).toHaveScreenshot('state-04-multi-selected.png', SCREENSHOT_OPTS);
    console.log('✓ State 04: multi-node selected');

    // ── STATE 05: zoomed in 2x ────────────────────────────────────────
    await appPage.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return;
      cy.nodes().unselect();
      cy.zoom(2);
      cy.center();
    });
    await appPage.waitForTimeout(300);
    await expect(appPage).toHaveScreenshot('state-05-zoom-2x.png', SCREENSHOT_OPTS);
    console.log('✓ State 05: zoomed in 2x');

    // ── STATE 06: zoomed out 0.5x ─────────────────────────────────────
    await appPage.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return;
      cy.zoom(0.5);
      cy.center();
    });
    await appPage.waitForTimeout(300);
    await expect(appPage).toHaveScreenshot('state-06-zoom-half.png', SCREENSHOT_OPTS);
    console.log('✓ State 06: zoomed out 0.5x');

    // ── STATE 07: pan offset +200,+100 ────────────────────────────────
    await appPage.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return;
      cy.fit(undefined, 50);
      cy.pan({ x: 200, y: 100 });
    });
    await appPage.waitForTimeout(300);
    await expect(appPage).toHaveScreenshot('state-07-pan-offset.png', SCREENSHOT_OPTS);
    console.log('✓ State 07: pan offset +200,+100');

    // ── STATE 08: fit all nodes ───────────────────────────────────────
    await appPage.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return;
      cy.fit(undefined, 50);
    });
    await appPage.waitForTimeout(300);
    await expect(appPage).toHaveScreenshot('state-08-fit-all.png', SCREENSHOT_OPTS);
    console.log('✓ State 08: fit all nodes');

    console.log('✅ All 8 canonical states captured — baselines ready for regression detection');
  });
});

export { test };
