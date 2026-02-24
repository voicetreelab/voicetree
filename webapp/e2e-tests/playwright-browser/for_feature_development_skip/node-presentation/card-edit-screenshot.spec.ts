/**
 * Browser-based screenshot test for node-presentation CM_CARD and CM_EDIT states.
 * Verifies CSS fixes:
 * 1. Left gap between accent bar and gutter (should be tight ~4px in CM_EDIT)
 * 2. Toolbar buttons not overflowing the right edge
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  selectMockProject,
  sendGraphDelta,
  waitForCytoscapeReady,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils';
import type { GraphDelta } from '@/pure/graph';

type ConsoleCapture = {
  consoleLogs: string[];
  pageErrors: string[];
  testLogs: string[];
};

const test = base.extend<{ consoleCapture: ConsoleCapture }>({
  consoleCapture: async ({ page }, use, testInfo) => {
    const consoleLogs: string[] = [];
    const pageErrors: string[] = [];
    const testLogs: string[] = [];

    page.on('console', msg => {
      consoleLogs.push(`[Browser ${msg.type()}] ${msg.text()}`);
    });

    page.on('pageerror', error => {
      pageErrors.push(`[Browser Error] ${error.message}\n${error.stack ?? ''}`);
    });

    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      testLogs.push(args.map(arg => String(arg)).join(' '));
    };

    await use({ consoleLogs, pageErrors, testLogs });

    console.log = originalLog;

    if (testInfo.status !== 'passed') {
      console.log('\n=== Test Logs ===');
      testLogs.forEach(log => console.log(log));
      console.log('\n=== Browser Console Logs ===');
      consoleLogs.forEach(log => console.log(log));
      if (pageErrors.length > 0) {
        console.log('\n=== Browser Errors ===');
        pageErrors.forEach(err => console.log(err));
      }
    }
  }
});

test.describe('Node Presentation: CM_CARD and CM_EDIT States', () => {
  test('CM_CARD and CM_EDIT visual states and CSS assertions', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting node-presentation card/edit screenshot test ===');

    // Step 1: Setup mock API, navigate, wait for Cytoscape
    console.log('=== Step 1: Setup ===');
    await setupMockElectronAPI(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);
    console.log('App initialized and Cytoscape ready');

    // Step 2: Send graph delta with test node at a position visible in viewport
    console.log('=== Step 2: Send graph delta ===');
    const testContent = '# Card Edit Test\nThis node tests CM_CARD and CM_EDIT states.\nLine 3 of content.';
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'card-edit-test.md',
          contentWithoutYamlOrLinks: testContent,
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 500, y: 300 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      }
    ];
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(50);
    console.log('Graph delta sent');

    // Step 3: Zoom to card zone level (zoom >= 0.7 for morph > 0.99 → card zone)
    // ZOOM_THRESHOLD_MIN = 0.6125, ZOOM_THRESHOLD_MAX = 0.7
    // morph = clamp01((zoom - 0.6125) / 0.0875) → at zoom=0.8, morph=1.0 → card zone
    console.log('=== Step 3: Zoom to card zone ===');
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      // Zoom to 0.8 — well into the card zone (morph=1.0)
      cy.zoom({ level: 0.8, renderedPosition: { x: 400, y: 300 } });
      // The zoom event triggers updateAllFromZoom which handles state transitions
    });
    await page.waitForTimeout(500);
    console.log('Zoomed to card zone (0.8)');

    // Step 4: Wait for node-presentation to appear in DOM
    console.log('=== Step 4: Wait for node-presentation ===');
    const cardSelector = '.node-presentation[data-node-id="card-edit-test.md"]';
    await page.waitForSelector(cardSelector, { timeout: 5000 });
    console.log('Node presentation appeared in DOM');

    // Wait for the CM editor to be mounted in the card
    await page.waitForSelector(`${cardSelector} .cm-editor`, { timeout: 3000 });
    console.log('CodeMirror editor mounted in card');

    // The auto-zoom (panToTrackedNode) scales the card to fill the viewport,
    // which can trigger an accidental mouseenter → CM_EDIT. Reset to CM_CARD
    // by moving the mouse away and pressing Escape.
    await page.mouse.move(0, 0);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Re-zoom to 0.8 to ensure we're in a stable card zone after the reset
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      cy.zoom({ level: 0.8, renderedPosition: { x: 400, y: 300 } });
    });
    await page.waitForTimeout(300);

    // Ensure we are in CM_CARD state (not CM_EDIT)
    await page.waitForSelector(`${cardSelector}.state-cm_card`, { timeout: 3000 });
    console.log('Confirmed CM_CARD state after reset');

    // Step 5: Verify CM_CARD state and take screenshot
    console.log('=== Step 5: CM_CARD state screenshot ===');

    // Assertion 1: In CM_CARD, .cm-gutters should be hidden (display: none)
    const guttersHiddenInCard = await page.evaluate((sel) => {
      const card = document.querySelector(sel);
      if (!card) return { hidden: false, display: 'card not found' };
      const gutters = card.querySelector('.cm-gutters') as HTMLElement | null;
      if (!gutters) return { hidden: true, display: 'no gutters element' };
      const computed = window.getComputedStyle(gutters);
      return { hidden: computed.display === 'none', display: computed.display };
    }, cardSelector);
    expect(guttersHiddenInCard.hidden).toBe(true);
    console.log(`CM_CARD gutters hidden: ${guttersHiddenInCard.hidden} (display: ${guttersHiddenInCard.display})`);

    // Assertion 2: In CM_CARD, .node-presentation-menu should be hidden (display: none)
    const menuHiddenInCard = await page.evaluate((sel) => {
      const card = document.querySelector(sel);
      if (!card) return { hidden: false, display: 'card not found' };
      const menu = card.querySelector('.node-presentation-menu') as HTMLElement | null;
      if (!menu) return { hidden: false, display: 'no menu element' };
      const computed = window.getComputedStyle(menu);
      return { hidden: computed.display === 'none', display: computed.display };
    }, cardSelector);
    expect(menuHiddenInCard.hidden).toBe(true);
    console.log(`CM_CARD menu hidden: ${menuHiddenInCard.hidden} (display: ${menuHiddenInCard.display})`);

    // Screenshot 1: CM_CARD state
    const cardElement = page.locator(cardSelector);
    await cardElement.screenshot({
      path: 'e2e-tests/screenshots/node-presentation-card-edit-cm-card.png'
    });
    console.log('Screenshot taken: node-presentation-card-edit-cm-card.png');

    // Step 6: Trigger hover → enterCMEdit transition
    // hoverWiring.ts listens on mouseenter on the .node-presentation element (200ms debounce)
    console.log('=== Step 6: Trigger CM_EDIT via mouseenter ===');
    await page.evaluate((sel) => {
      const card = document.querySelector(sel) as HTMLElement | null;
      if (!card) throw new Error('Node presentation element not found');
      card.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    }, cardSelector);
    // Wait for the 200ms debounce + processing time
    await page.waitForTimeout(400);
    console.log('Mouseenter dispatched, waited for debounce');

    // Step 7: Wait for .state-cm_edit class on the node-presentation element
    console.log('=== Step 7: Wait for CM_EDIT state ===');
    await page.waitForSelector(`${cardSelector}.state-cm_edit`, { timeout: 3000 });
    console.log('CM_EDIT state active');

    // Step 8: Wait for .cm-gutters to be visible
    console.log('=== Step 8: Wait for gutters visible ===');
    await page.waitForFunction((sel) => {
      const card = document.querySelector(sel);
      if (!card) return false;
      const gutters = card.querySelector('.cm-gutters') as HTMLElement | null;
      if (!gutters) return false;
      const computed = window.getComputedStyle(gutters);
      return computed.display !== 'none';
    }, cardSelector, { timeout: 3000 });
    console.log('Gutters are visible');

    // Step 9: Wait for .node-presentation-menu to be visible
    console.log('=== Step 9: Wait for menu visible ===');
    await page.waitForFunction((sel) => {
      const card = document.querySelector(sel);
      if (!card) return false;
      const menu = card.querySelector('.node-presentation-menu') as HTMLElement | null;
      if (!menu) return false;
      const computed = window.getComputedStyle(menu);
      return computed.display === 'flex';
    }, cardSelector, { timeout: 3000 });
    console.log('Menu is visible (display: flex)');

    // Step 10: Screenshot 2 — CM_EDIT state
    console.log('=== Step 10: CM_EDIT screenshot ===');
    await cardElement.screenshot({
      path: 'e2e-tests/screenshots/node-presentation-card-edit-cm-edit.png'
    });
    console.log('Screenshot taken: node-presentation-card-edit-cm-edit.png');

    // Step 11: Assert gutter left position is close to accent bar
    // CSS rule: .state-cm_edit .node-presentation-body { padding-left: 4px }
    // enterCMEdit clears the inline padding set by zoomSync so the CSS rule takes effect.
    console.log('=== Step 11: Assert body padding-left ===');
    const bodyPaddingLeft = await page.evaluate((sel) => {
      const card = document.querySelector(sel);
      if (!card) return { value: -1, raw: 'card not found' };
      const body = card.querySelector('.node-presentation-body') as HTMLElement | null;
      if (!body) return { value: -1, raw: 'body not found' };
      const computed = window.getComputedStyle(body);
      return { value: parseFloat(computed.paddingLeft), raw: computed.paddingLeft };
    }, cardSelector);
    expect(bodyPaddingLeft.value).toBeGreaterThanOrEqual(2);
    expect(bodyPaddingLeft.value).toBeLessThanOrEqual(8);
    console.log(`CM_EDIT body padding-left: ${bodyPaddingLeft.raw} (parsed: ${bodyPaddingLeft.value}px)`);

    // Step 12: Assert right pill group is not overflowing the card element's right edge
    console.log('=== Step 12: Assert right pill group not overflowing ===');
    const overflowCheck = await page.evaluate((sel) => {
      const card = document.querySelector(sel) as HTMLElement | null;
      if (!card) return { overflows: true, reason: 'card not found' };
      const rightGroup = card.querySelector('.horizontal-menu-right-group') as HTMLElement | null;
      if (!rightGroup) return { overflows: false, reason: 'no right group (menu may not have right group)' };
      const cardRect = card.getBoundingClientRect();
      const rightRect = rightGroup.getBoundingClientRect();
      const overflows = rightRect.right > cardRect.right + 2; // 2px tolerance
      return {
        overflows,
        cardRight: Math.round(cardRect.right),
        groupRight: Math.round(rightRect.right),
        reason: overflows
          ? `right group (${Math.round(rightRect.right)}) exceeds card (${Math.round(cardRect.right)})`
          : 'contained within card bounds'
      };
    }, cardSelector);
    expect(overflowCheck.overflows).toBe(false);
    console.log(`Right pill group overflow check: ${overflowCheck.reason}`);

    // Assertion 3: In CM_EDIT, .cm-gutters should be visible
    const guttersVisibleInEdit = await page.evaluate((sel) => {
      const card = document.querySelector(sel);
      if (!card) return { visible: false, display: 'card not found' };
      const gutters = card.querySelector('.cm-gutters') as HTMLElement | null;
      if (!gutters) return { visible: false, display: 'no gutters element' };
      const computed = window.getComputedStyle(gutters);
      return { visible: computed.display !== 'none', display: computed.display };
    }, cardSelector);
    expect(guttersVisibleInEdit.visible).toBe(true);
    console.log(`CM_EDIT gutters visible: ${guttersVisibleInEdit.visible} (display: ${guttersVisibleInEdit.display})`);

    // Assertion 4: In CM_EDIT, .node-presentation-menu should be display: flex
    const menuVisibleInEdit = await page.evaluate((sel) => {
      const card = document.querySelector(sel);
      if (!card) return { visible: false, display: 'card not found' };
      const menu = card.querySelector('.node-presentation-menu') as HTMLElement | null;
      if (!menu) return { visible: false, display: 'no menu element' };
      const computed = window.getComputedStyle(menu);
      return { visible: computed.display === 'flex', display: computed.display };
    }, cardSelector);
    expect(menuVisibleInEdit.visible).toBe(true);
    console.log(`CM_EDIT menu visible: ${menuVisibleInEdit.visible} (display: ${menuVisibleInEdit.display})`);

    console.log('=== Test completed successfully ===');
  });
});
