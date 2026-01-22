/**
 * E2E TEST: Distance Slider Mouse Hover
 *
 * BEHAVIORAL SPEC:
 * When a user hovers over a non-context node and the horizontal menu appears,
 * a distance slider (10 squares) should be visible below the Run button.
 * Hovering over squares fills them 1-N in gold and updates the contextNodeMaxDistance setting.
 *
 * TEST SCENARIOS:
 * 1. Slider appears on Run button hover for non-context nodes
 * 2. Hover fills squares correctly (1 through N)
 * 3. Setting persists after adjustment
 * 4. Preview highlighting updates with new distance
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');

// Slider constants (must match HorizontalMenuService.ts)
const SLIDER_GOLD_COLOR = 'rgba(251, 191, 36, 0.9)';
const SLIDER_GRAY_COLOR = 'rgba(255, 255, 255, 0.2)';

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-slider-test-'));

    // Write config to auto-load test vault with a known contextNodeMaxDistance
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({
      lastDirectory: FIXTURE_VAULT_PATH,
      suffixes: {
        [FIXTURE_VAULT_PATH]: ''
      }
    }, null, 2), 'utf8');

    // Write settings with a known contextNodeMaxDistance (default to 5)
    const settingsPath = path.join(tempUserDataPath, 'voicetree-settings.json');
    await fs.writeFile(settingsPath, JSON.stringify({
      contextNodeMaxDistance: 5
    }, null, 2), 'utf8');
    console.log('[Test] Created config with contextNodeMaxDistance: 5');

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
      timeout: 10000
    });

    await use(electronApp);

    // Graceful shutdown
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

    try {
      await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
    } catch (error) {
      console.error('Failed to initialize cytoscape instance:', error);
      throw error;
    }

    await window.waitForTimeout(1000);
    await use(window);
  }
});

/**
 * Wait for graph to load with nodes
 */
async function waitForGraphLoaded(appWindow: Page): Promise<void> {
  await expect.poll(async () => {
    return appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return 0;
      return cy.nodes().length;
    });
  }, {
    message: 'Waiting for graph to load nodes',
    timeout: 15000,
    intervals: [500, 1000, 1000]
  }).toBeGreaterThan(0);
}

/**
 * Find a non-context node ID for testing
 */
async function getNonContextNodeId(appWindow: Page): Promise<string> {
  return appWindow.evaluate(() => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not available');

    // Find a node that is NOT a context node and has a file extension (markdown node)
    const node = cy.nodes().filter((n) => {
      const id = n.id();
      const isContextNode = n.data('isContextNode') === true;
      const hasFileExtension = /\.\w+$/.test(id);
      return !isContextNode && hasFileExtension;
    }).first();

    if (!node || node.length === 0) {
      throw new Error('No non-context node found');
    }
    return node.id();
  });
}

/**
 * Hover over a node to trigger the horizontal menu
 */
async function hoverOverNode(appWindow: Page, nodeId: string): Promise<void> {
  await appWindow.evaluate((id) => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not available');
    const node = cy.getElementById(id);
    node.emit('mouseover');
  }, nodeId);
}

/**
 * Get the slider element
 */
function getSlider(appWindow: Page) {
  return appWindow.locator('.cy-horizontal-context-menu .distance-slider');
}

/**
 * Get all square elements in the slider (squares are inside a row container)
 */
function getSliderSquares(appWindow: Page) {
  return appWindow.locator('.cy-horizontal-context-menu .distance-slider > div:last-child > div');
}

/**
 * Get background colors of all slider squares
 */
async function getSquareColors(appWindow: Page): Promise<string[]> {
  return appWindow.evaluate(() => {
    const slider = document.querySelector('.cy-horizontal-context-menu .distance-slider');
    if (!slider) return [];
    // Squares are now inside a row container (last child div after the tooltip span)
    const squaresRow = slider.querySelector(':scope > div:last-child');
    if (!squaresRow) return [];
    const squares = squaresRow.querySelectorAll(':scope > div');
    return Array.from(squares).map(sq => (sq as HTMLElement).style.background);
  });
}

/**
 * Get the current contextNodeMaxDistance from settings
 */
async function getContextDistance(appWindow: Page): Promise<number> {
  return appWindow.evaluate(async () => {
    const api = (window as unknown as ExtendedWindow).electronAPI;
    if (!api) throw new Error('electronAPI not available');
    const settings = await api.main.loadSettings();
    return settings?.contextNodeMaxDistance ?? 5;
  });
}

/**
 * Get IDs of nodes with a specific class
 */
async function getNodesWithClass(appWindow: Page, className: string): Promise<string[]> {
  return appWindow.evaluate((cls) => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) return [];
    return cy.nodes(`.${cls}`).map((n) => n.id());
  }, className);
}

/**
 * Close the horizontal menu by clicking outside
 */
async function closeMenu(appWindow: Page): Promise<void> {
  await appWindow.mouse.click(10, 10);
  await appWindow.waitForTimeout(200);
}

test.describe('Distance Slider Hover', () => {

  test('1. Slider appears on Run button hover for non-context node', async ({ appWindow }) => {
    test.setTimeout(60000);
    console.log('=== TEST 1: Slider appears on Run button hover ===');

    await waitForGraphLoaded(appWindow);
    console.log('✓ Graph loaded');

    const nodeId = await getNonContextNodeId(appWindow);
    console.log(`✓ Found non-context node: ${nodeId}`);

    // Hover over the node to trigger horizontal menu
    await hoverOverNode(appWindow, nodeId);
    await appWindow.waitForTimeout(300);

    // Verify horizontal menu appeared
    const menu = appWindow.locator('.cy-horizontal-context-menu');
    await expect(menu).toBeVisible({ timeout: 5000 });
    console.log('✓ Horizontal menu appeared');

    // Slider should NOT be visible yet (only appears on Run button hover)
    const slider = getSlider(appWindow);
    await expect(slider).not.toBeVisible({ timeout: 1000 });
    console.log('✓ Distance slider is hidden initially');

    // Hover over the Run button (green play icon)
    const runButton = appWindow.locator('.cy-horizontal-context-menu .horizontal-menu-item').filter({
      has: appWindow.locator('svg[stroke="#22c55e"]')
    });
    await expect(runButton).toBeVisible({ timeout: 5000 });
    await runButton.hover();
    await appWindow.waitForTimeout(300);

    // Now slider should be visible
    await expect(slider).toBeVisible({ timeout: 5000 });
    console.log('✓ Distance slider appears on Run button hover');

    // Verify slider has 10 squares
    const squares = getSliderSquares(appWindow);
    await expect(squares).toHaveCount(10);
    console.log('✓ Slider has 10 squares');

    await appWindow.screenshot({ path: 'e2e-tests/screenshots/distance-slider-hover-test-1.png' });
    console.log('✅ TEST 1 PASSED');
  });

  test('2. Hover fills squares correctly (1 through N)', async ({ appWindow }) => {
    test.setTimeout(60000);
    console.log('=== TEST 2: Hover fills squares correctly ===');

    await waitForGraphLoaded(appWindow);
    const nodeId = await getNonContextNodeId(appWindow);
    console.log(`✓ Found non-context node: ${nodeId}`);

    await hoverOverNode(appWindow, nodeId);
    await appWindow.waitForTimeout(300);

    // Hover over Run button to show slider
    const runButton = appWindow.locator('.cy-horizontal-context-menu .horizontal-menu-item').filter({
      has: appWindow.locator('svg[stroke="#22c55e"]')
    });
    await runButton.hover();
    await appWindow.waitForTimeout(300);

    const slider = getSlider(appWindow);
    await expect(slider).toBeVisible({ timeout: 5000 });

    const squares = getSliderSquares(appWindow);

    // Test hovering over square 3 (index 2) - should fill squares 1-3 (indices 0-2)
    console.log('Testing hover over square 3...');
    await squares.nth(2).hover();
    await appWindow.waitForTimeout(200);

    let colors = await getSquareColors(appWindow);
    console.log(`Square colors after hover on 3: ${colors.slice(0, 5).join(', ')}...`);

    // Squares 1-3 should be gold, 4-10 should be gray
    for (let i = 0; i < 3; i++) {
      expect(colors[i]).toBe(SLIDER_GOLD_COLOR);
    }
    for (let i = 3; i < 10; i++) {
      expect(colors[i]).toBe(SLIDER_GRAY_COLOR);
    }
    console.log('✓ Squares 1-3 are gold, 4-10 are gray');

    // Test hovering over square 7 (index 6) - should fill squares 1-7
    console.log('Testing hover over square 7...');
    await squares.nth(6).hover();
    await appWindow.waitForTimeout(200);

    colors = await getSquareColors(appWindow);
    console.log(`Square colors after hover on 7: ${colors.slice(0, 8).join(', ')}...`);

    for (let i = 0; i < 7; i++) {
      expect(colors[i]).toBe(SLIDER_GOLD_COLOR);
    }
    for (let i = 7; i < 10; i++) {
      expect(colors[i]).toBe(SLIDER_GRAY_COLOR);
    }
    console.log('✓ Squares 1-7 are gold, 8-10 are gray');

    // Test hovering over square 10 (index 9) - all should be gold
    console.log('Testing hover over square 10...');
    await squares.nth(9).hover();
    await appWindow.waitForTimeout(200);

    colors = await getSquareColors(appWindow);
    console.log(`Square colors after hover on 10: all ${colors.every(c => c === SLIDER_GOLD_COLOR) ? 'gold' : 'mixed'}`);

    for (let i = 0; i < 10; i++) {
      expect(colors[i]).toBe(SLIDER_GOLD_COLOR);
    }
    console.log('✓ All 10 squares are gold');

    await appWindow.screenshot({ path: 'e2e-tests/screenshots/distance-slider-hover-test-2.png' });
    console.log('✅ TEST 2 PASSED');
  });

  test('3. Setting persists after adjustment', async ({ appWindow }) => {
    test.setTimeout(60000);
    console.log('=== TEST 3: Setting persists after adjustment ===');

    await waitForGraphLoaded(appWindow);
    const nodeId = await getNonContextNodeId(appWindow);
    console.log(`✓ Found non-context node: ${nodeId}`);

    // First, hover and set distance to 5
    await hoverOverNode(appWindow, nodeId);
    await appWindow.waitForTimeout(300);

    // Hover over Run button to show slider
    const runButton = appWindow.locator('.cy-horizontal-context-menu .horizontal-menu-item').filter({
      has: appWindow.locator('svg[stroke="#22c55e"]')
    });
    await runButton.hover();
    await appWindow.waitForTimeout(300);

    const slider = getSlider(appWindow);
    await expect(slider).toBeVisible({ timeout: 5000 });

    const squares = getSliderSquares(appWindow);

    // Hover over square 5 to set distance to 5
    console.log('Setting distance to 5...');
    await squares.nth(4).hover();
    await appWindow.waitForTimeout(300);

    // Verify setting was saved
    let distance = await getContextDistance(appWindow);
    console.log(`✓ contextNodeMaxDistance after hover: ${distance}`);
    expect(distance).toBe(5);

    // Close menu by clicking outside
    await closeMenu(appWindow);
    console.log('✓ Closed menu');

    // Wait a bit for any cleanup
    await appWindow.waitForTimeout(500);

    // Hover over same node again
    await hoverOverNode(appWindow, nodeId);
    await appWindow.waitForTimeout(300);

    // Hover over Run button to show slider again
    const runButton2 = appWindow.locator('.cy-horizontal-context-menu .horizontal-menu-item').filter({
      has: appWindow.locator('svg[stroke="#22c55e"]')
    });
    await runButton2.hover();
    await appWindow.waitForTimeout(300);

    // Verify slider shows 5 squares filled
    const colors = await getSquareColors(appWindow);
    console.log(`Square colors on re-open: first 6 = ${colors.slice(0, 6).join(', ')}`);

    // Squares 1-5 should be gold (persisted setting)
    for (let i = 0; i < 5; i++) {
      expect(colors[i]).toBe(SLIDER_GOLD_COLOR);
    }
    for (let i = 5; i < 10; i++) {
      expect(colors[i]).toBe(SLIDER_GRAY_COLOR);
    }
    console.log('✓ Slider shows 5 squares filled (setting persisted)');

    // Also verify the setting value is still 5
    distance = await getContextDistance(appWindow);
    expect(distance).toBe(5);
    console.log('✓ contextNodeMaxDistance is still 5');

    await appWindow.screenshot({ path: 'e2e-tests/screenshots/distance-slider-hover-test-3.png' });
    console.log('✅ TEST 3 PASSED');
  });

  test('4. Preview highlighting updates with new distance', async ({ appWindow }) => {
    test.setTimeout(60000);
    console.log('=== TEST 4: Preview highlighting updates ===');

    await waitForGraphLoaded(appWindow);
    const nodeId = await getNonContextNodeId(appWindow);
    console.log(`✓ Found non-context node: ${nodeId}`);

    // First, ensure no highlights
    let highlightedNodes = await getNodesWithClass(appWindow, 'context-contained');
    console.log(`Initial highlighted nodes: ${highlightedNodes.length}`);

    // Hover over the node to trigger horizontal menu
    await hoverOverNode(appWindow, nodeId);
    await appWindow.waitForTimeout(300);

    // First, hover over Run button to trigger preview highlighting and show slider
    const runButton = appWindow.locator('.cy-horizontal-context-menu .horizontal-menu-item').filter({
      has: appWindow.locator('svg[stroke="#22c55e"]')
    });
    await expect(runButton).toBeVisible({ timeout: 5000 });

    await runButton.hover();
    await appWindow.waitForTimeout(300);

    // Now slider should be visible
    const slider = getSlider(appWindow);
    await expect(slider).toBeVisible({ timeout: 5000 });

    const squares = getSliderSquares(appWindow);

    // Check highlights with initial distance
    let highlightCount1 = (await getNodesWithClass(appWindow, 'context-contained')).length;
    console.log(`Highlighted nodes at initial distance: ${highlightCount1}`);

    // Now hover over a different square (say, square 2 for distance 2)
    console.log('Changing distance to 2...');
    await squares.nth(1).hover();
    await appWindow.waitForTimeout(400);

    // Check highlights - they may have changed based on the new distance
    let highlightCount2 = (await getNodesWithClass(appWindow, 'context-contained')).length;
    console.log(`Highlighted nodes at distance 2: ${highlightCount2}`);

    // Now hover over square 8 for distance 8
    console.log('Changing distance to 8...');
    await squares.nth(7).hover();
    await appWindow.waitForTimeout(400);

    let highlightCount3 = (await getNodesWithClass(appWindow, 'context-contained')).length;
    console.log(`Highlighted nodes at distance 8: ${highlightCount3}`);

    // With a larger distance, we should have the same or more highlighted nodes
    // (assuming the graph has nodes at various distances)
    expect(highlightCount3).toBeGreaterThanOrEqual(highlightCount2);
    console.log('✓ Larger distance includes same or more nodes in preview');

    await appWindow.screenshot({ path: 'e2e-tests/screenshots/distance-slider-hover-test-4.png' });
    console.log('✅ TEST 4 PASSED');
  });

});

export { test };
