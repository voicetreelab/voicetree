/**
 * Pixel-diff harness for canonical UI states — V-L3-1 / V-L4-B1 claim.
 * Verifies ≤1% pixel diff across N=10 canonical UI states after
 * the cytoscape-ui-decoupling epic (L0+L1+L2 migrations).
 *
 * States covered:
 *   01 project-selection-screen   05 zoom-2x
 *   02 graph-loaded               06 zoom-half
 *   03 single-selected            07 pan-offset
 *   04 multi-selected             08 fit-all
 *   09 hover-editor               10 floating-terminal
 *
 * L4-BF-195: states 09+10 lifted from "inherently flaky" waiver.
 * Fixes:
 *   09 — mouse.move() to node's rendered bbox (deterministic cytoscape trigger)
 *   10 — spawnPlainTerminal + mask xterm viewport (chrome-only diff, stable)
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');
const SCREENSHOT_OPTS = { maxDiffPixelRatio: 0.01 } as const;

interface CyNode {
  id: () => string;
  select: () => void;
  renderedBoundingBox: () => { x1: number; x2: number; y1: number; y2: number };
}

interface CyNodeCollection {
  length: number;
  first: () => CyNode;
  slice: (start: number, end: number) => { select: () => void };
  unselect: () => void;
  [index: number]: CyNode;
}

interface ExtendedWindow {
  cytoscapeInstance?: {
    nodes: () => CyNodeCollection;
    zoom: (level: number) => void;
    pan: (pos: { x: number; y: number }) => void;
    center: () => void;
    fit: (eles?: unknown, padding?: number) => void;
    container: () => HTMLElement | null;
  };
  electronAPI?: {
    main: {
      stopFileWatching: () => Promise<void>;
      spawnPlainTerminal: (nodeId: string, count: number) => Promise<void>;
    };
  };
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
  test('10 canonical states ≤1% pixel diff', async ({ appPage }) => {
    test.setTimeout(180_000);

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

    // ── STATE 09: hover-editor ────────────────────────────────────────
    // Normalize viewport so the hover editor lands at a deterministic screen position.
    await appPage.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return;
      cy.nodes().unselect();
      cy.fit(undefined, 50);
    });
    await appPage.waitForTimeout(500);

    // Disable CSS animations/transitions so the hover editor renders without flicker.
    await appPage.addStyleTag({
      content: '* { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; }',
    });

    // Get the first .md node info: screen centre + id for hover trigger.
    const hoverTarget = await appPage.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return null;
      const nodes = cy.nodes();
      for (let i = 0; i < nodes.length; i++) {
        const nodeId = nodes[i].id();
        if (/\.md$/.test(nodeId)) {
          const bbox = nodes[i].renderedBoundingBox();
          const container = cy.container();
          if (!container) continue;
          const rect = container.getBoundingClientRect();
          return {
            id: nodeId,
            x: rect.left + (bbox.x1 + bbox.x2) / 2,
            y: rect.top + (bbox.y1 + bbox.y2) / 2,
          };
        }
      }
      return null;
    });

    if (!hoverTarget) {
      throw new Error('State 09: no .md node found — fixture vault may be empty');
    }

    // Move mouse to the node centre first (so the cursor is visually over the node).
    await appPage.mouse.move(hoverTarget.x, hoverTarget.y, { steps: 10 });
    await appPage.waitForTimeout(200);

    // Emit mouseover on the Cytoscape node directly — this is the canonical way to
    // trigger the hover-editor without relying on canvas hit-testing in headless mode.
    // The graph is fully loaded by state 09 so getNodeFromMainToUI IPC succeeds.
    await appPage.evaluate((nodeId: string) => {
      // Use full Cytoscape API via unknown cast — ExtendedWindow type is minimal.
      const cy = (window as unknown as { cytoscapeInstance?: { getElementById: (id: string) => { emit: (evt: string) => void } } }).cytoscapeInstance;
      if (!cy) return;
      cy.getElementById(nodeId).emit('mouseover');
    }, hoverTarget.id);

    // Gate: hover editor window must be visible — class cy-floating-window-editor.
    await appPage.waitForSelector('.cy-floating-window-editor', { state: 'visible', timeout: 10000 });
    // Keep mouse at node centre so editor position is stable.
    await appPage.mouse.move(hoverTarget.x, hoverTarget.y);
    await appPage.waitForTimeout(400);
    await expect(appPage).toHaveScreenshot('state-09-hover-editor.png', SCREENSHOT_OPTS);
    console.log('✓ State 09: hover-editor');

    // ── STATE 10: floating-terminal ───────────────────────────────────
    // Close the hover editor (move mouse away from the node).
    await appPage.mouse.move(50, 50);
    await appPage.waitForTimeout(400);

    // Reset viewport.
    await appPage.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return;
      cy.nodes().unselect();
      cy.fit(undefined, 50);
    });
    await appPage.waitForTimeout(300);

    // Get first .md node ID to anchor the plain terminal.
    const plainTermNodeId = await appPage.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return null;
      const nodes = cy.nodes();
      for (let i = 0; i < nodes.length; i++) {
        if (/\.md$/.test(nodes[i].id())) return nodes[i].id();
      }
      return null;
    });

    if (!plainTermNodeId) {
      throw new Error('State 10: no .md node found for terminal anchor');
    }

    // Spawn a plain terminal (no new context-node file created).
    await appPage.evaluate(async (nodeId: string) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      await api.main.spawnPlainTerminal(nodeId, 1);
    }, plainTermNodeId);

    // Wait for the floating-terminal window chrome to appear.
    await appPage.waitForSelector('.cy-floating-window-terminal', { state: 'visible', timeout: 15000 });
    await appPage.waitForTimeout(600);

    // Mask the xterm viewport: PTY startup output is non-deterministic (timing, PS1 config).
    // The chrome (title bar, traffic lights, borders) is the stable element under test.
    // The content area is covered by a solid placeholder for the pixel-diff baseline.
    await appPage.addStyleTag({
      content: '.xterm-screen, .xterm-viewport { visibility: hidden !important; } .xterm { background: #0d0d0d !important; }',
    });
    await appPage.waitForTimeout(200);
    await expect(appPage).toHaveScreenshot('state-10-floating-terminal.png', SCREENSHOT_OPTS);
    console.log('✓ State 10: floating-terminal');

    console.log('✅ All 10 canonical states captured — baselines ready for regression detection');
  });
});

export { test };
