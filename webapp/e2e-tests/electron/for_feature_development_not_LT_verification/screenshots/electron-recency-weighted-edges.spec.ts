/**
 * E2E (Electron): recency-weighted terminal→created-node indicator edges.
 *
 * Verifies the feature in the REAL app: the blue dashed agent→node indicator edges
 * (class `terminal-progres-nodes-indicator`) scale their width and opacity by recency.
 * The most recent node the agent created reads as the thickest / most solid line; the
 * oldest as the thinnest / most faded.
 *
 * What this proves end-to-end:
 *  - The production stylesheet (defaultEdgeStyles.ts) loaded by the running renderer maps
 *    `recencyWeight` (0=oldest … 1=newest) onto width (2.5→10) and line-opacity (0.15→0.9)
 *    via cytoscape `mapData`, in the actual Electron Chromium renderer.
 *  - The rendered widths and opacities form a strictly increasing gradient across an
 *    agent's 10 nodes — i.e. the visible behaviour the user asked for.
 *
 * The recencyWeight *computation* itself (createTerminalIndicatorEdge / per-terminal
 * re-ranking) is covered by the vitest integration test
 * `applyGraphDeltaToUI-terminal-indicator.test.ts`. Here we feed the exact weights that
 * code assigns for 10 edges (i/9) so the screenshot mirrors a real 10-node agent.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';

const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_PROJECT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');
const SCREENSHOT_PATH = path.join(PROJECT_ROOT, 'test-results', 'recency-weighted-agent-edges', 'in-app.png');

const N = 10;

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: {
    main: { stopFileWatching: () => Promise<{ success: boolean; error?: string }> };
  };
}

const test = base.extend<{ electronApp: ElectronApplication; appWindow: Page }>({
  electronApp: [async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-recency-test-'));
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({
      projectConfig: { [FIXTURE_PROJECT_PATH]: { writeFolderPath: FIXTURE_PROJECT_PATH, readPaths: [] } },
    }, null, 2), 'utf8');

    const electronApp = await electron.launch({
      args: [
        ...(process.platform === 'linux'
          ? ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
          : []),
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`,
        '--open-folder',
        FIXTURE_PROJECT_PATH,
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
        VOICETREE_PERSIST_STATE: '1',
      },
      timeout: 20000,
    });

    await use(electronApp);

    // Robust teardown: a lingering graph-daemon child can make electronApp.close() hang,
    // which trips Playwright's worker-teardown timeout. Best-effort graceful close, then
    // force-kill the main process so the fixture always returns promptly.
    const proc = electronApp.process();
    try {
      await Promise.race([
        electronApp.close(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('close-timeout')), 8000)),
      ]);
    } catch {
      try { proc?.kill('SIGKILL'); } catch { /* already gone */ }
    }
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  }, { timeout: 40000 }],

  appWindow: [async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    page.on('console', msg => console.log(`BROWSER [${msg.type()}]:`, msg.text()));
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => (window as ExtendedWindow).cytoscapeInstance, { timeout: 15000 });
    await page.waitForTimeout(500);
    await use(page);
  }, { timeout: 25000 }],
});

test('recency-weighted indicator edges render a thick→thin / solid→faded gradient in-app', async ({ appWindow }) => {
  test.setTimeout(40000);

  // Build an agent shadow node fanning out to N created nodes, oldest→newest, each edge
  // carrying the recencyWeight production assigns (i/(N-1)) plus the real CSS classes.
  await appWindow.evaluate((n: number) => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('cytoscapeInstance missing');

    cy.elements().remove();
    cy.add({ group: 'nodes', data: { id: 'agent-shadow', label: 'Agent' }, position: { x: 160, y: 460 } });

    for (let i = 0; i < n; i++) {
      const id = `recency-node-${i}`;
      const weight = n <= 1 ? 1 : i / (n - 1); // 0 = oldest, 1 = newest
      const y = 80 + (760 * (n - 1 - i)) / (n - 1); // newest at top
      const age = i === n - 1 ? '  (NEWEST)' : i === 0 ? '  (OLDEST)' : '';
      cy.add({ group: 'nodes', data: { id, label: `node ${i + 1}${age}` }, position: { x: 1180, y } });
      cy.add({
        group: 'edges',
        data: { id: `recency-edge-${i}`, source: 'agent-shadow', target: id, isIndicatorEdge: true, recencySeq: i, recencyWeight: weight },
        classes: 'terminal-progres-nodes-indicator terminal-active',
      });
    }
    cy.fit(undefined, 60);
  }, N);

  await appWindow.waitForTimeout(500);

  // Read the styles the REAL renderer computed from the production mapData stylesheet.
  const styles = await appWindow.evaluate((n: number) => {
    const cy = (window as ExtendedWindow).cytoscapeInstance!;
    const out: Array<{ weight: number; width: number; opacity: number }> = [];
    for (let i = 0; i < n; i++) {
      const e = cy.getElementById(`recency-edge-${i}`);
      out.push({
        weight: e.data('recencyWeight') as number,
        width: e.numericStyle('width'),
        opacity: parseFloat(e.style('line-opacity') as string),
      });
    }
    return out;
  }, N);

  console.log('Rendered indicator-edge styles (oldest→newest):');
  styles.forEach((s, i) => console.log(`  node ${i + 1}: weight=${s.weight.toFixed(3)} width=${s.width.toFixed(2)} opacity=${s.opacity.toFixed(3)}`));

  // The stylesheet endpoints: mapData(recencyWeight, 0, 1, 2.5, 10) and (…, 0.15, 0.9).
  const oldest = styles[0];
  const newest = styles[N - 1];
  expect(oldest.width).toBeCloseTo(2.5, 1);
  expect(newest.width).toBeCloseTo(10, 1);
  expect(oldest.opacity).toBeCloseTo(0.15, 2);
  expect(newest.opacity).toBeCloseTo(0.9, 2);

  // Strictly increasing gradient across the agent's nodes (recency-weighted).
  for (let i = 1; i < N; i++) {
    expect(styles[i].width).toBeGreaterThan(styles[i - 1].width);
    expect(styles[i].opacity).toBeGreaterThan(styles[i - 1].opacity);
  }

  await fs.mkdir(path.dirname(SCREENSHOT_PATH), { recursive: true });
  await appWindow.screenshot({ path: SCREENSHOT_PATH });
  console.log(`Screenshot saved to ${SCREENSHOT_PATH}`);
});

export { test };
