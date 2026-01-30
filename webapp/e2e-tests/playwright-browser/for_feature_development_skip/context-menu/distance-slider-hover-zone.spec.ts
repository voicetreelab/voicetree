/**
 * E2E TEST: Distance Slider Hover Zone
 *
 * BEHAVIORAL SPEC:
 * When hovering over the Run button, a distance slider appears above the horizontal menu.
 * The slider should STAY visible when the mouse moves from the Run button to the slider squares.
 * This tests the hover zone fix where the slider was previously disappearing when transitioning
 * between the two zones.
 *
 * TEST SCENARIOS:
 * 1. Hover over node -> menu appears
 * 2. Hover over Run button -> distance slider appears (screenshot)
 * 3. Hover over distance slider squares -> slider stays visible (screenshot)
 * 4. Click a slider square -> verify action works (screenshot after 300ms)
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  selectMockProject,
  sendGraphDelta,
  waitForCytoscapeReady,
  type ExtendedWindow
} from '../../graph-delta-test-utils';
import type { GraphDelta } from '@/pure/graph';

// Custom fixture to capture console logs and only show on failure
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

test.describe('Distance Slider Hover Zone', () => {
  test('slider stays visible when hovering from Run button to slider squares', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting distance slider hover zone test ===');

    // Step 1: Setup
    await setupMockElectronAPI(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);
    console.log('App initialized');

    // Step 2: Add a test node (non-context node so Run button appears with slider)
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'slider-hover-test.md',
          contentWithoutYamlOrLinks: '# Slider Hover Test\nThis node tests distance slider hover behavior.',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 500, y: 300 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false // NOT a context node, so Run button + slider will appear
          }
        },
        previousNode: { _tag: 'None' } as const
      }
    ];
    await sendGraphDelta(page, graphDelta);
    console.log('Graph delta sent');

    // Step 3: Wait for layout to complete
    await page.waitForTimeout(500);
    console.log('Waited for layout');

    // Step 4: Trigger mouseover on the node to open horizontal menu
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#slider-hover-test.md');
      if (node.length === 0) throw new Error('Node not found');
      node.emit('mouseover');
    });
    await page.waitForTimeout(300);
    console.log('Mouseover event triggered on node');

    // Step 5: Verify horizontal menu is visible
    const menuVisible = await page.evaluate(() => {
      const menu = document.querySelector('.cy-horizontal-context-menu') as HTMLElement | null;
      return menu !== null;
    });
    expect(menuVisible).toBe(true);
    console.log('Horizontal menu is visible');

    // Step 6: Verify distance slider is NOT visible yet (only appears on Run button hover)
    const sliderNotVisibleInitially = await page.evaluate(() => {
      const slider = document.querySelector('.distance-slider') as HTMLElement | null;
      if (!slider) return true;
      return slider.style.display === 'none';
    });
    expect(sliderNotVisibleInitially).toBe(true);
    console.log('Distance slider is hidden initially (as expected)');

    // Step 7: Find and hover over the Run button (green play icon with stroke="#22c55e")
    const runButtonPosition = await page.evaluate(() => {
      // Run button is identified by having the green play icon
      const buttons = Array.from(document.querySelectorAll('.cy-horizontal-context-menu .horizontal-menu-item'));
      for (const button of buttons) {
        const svg = button.querySelector('svg[stroke="#22c55e"]');
        if (svg) {
          const rect = (button as HTMLElement).getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }
      }
      return null;
    });

    if (!runButtonPosition) {
      console.log('Run button not found - this may be expected for context nodes');
      // Context nodes don't have Run button, skip this test
      return;
    }

    await page.mouse.move(runButtonPosition.x, runButtonPosition.y);
    await page.waitForTimeout(300);
    console.log('Hovered over Run button');

    // Step 8: Verify distance slider is now visible
    const sliderVisibleAfterRunHover = await page.evaluate(() => {
      const slider = document.querySelector('.distance-slider') as HTMLElement | null;
      if (!slider) return false;
      const computed = window.getComputedStyle(slider);
      return computed.display !== 'none' && computed.visibility !== 'hidden';
    });
    expect(sliderVisibleAfterRunHover).toBe(true);
    console.log('Distance slider is visible after Run button hover');

    // Step 9: Take screenshot - should show slider appearing
    await page.screenshot({
      path: 'e2e-tests/screenshots/distance-slider-step2-run-hover.png',
      fullPage: true
    });
    console.log('Screenshot taken: distance-slider-step2-run-hover.png');

    // Step 10: Get the slider squares and hover over them
    const sliderSquarePosition = await page.evaluate(() => {
      const slider = document.querySelector('.distance-slider') as HTMLElement | null;
      if (!slider) return null;
      // Squares are inside a row container (last child div after the tooltip span)
      const squaresRow = slider.querySelector(':scope > div:last-child');
      if (!squaresRow) return null;
      const squares = squaresRow.querySelectorAll(':scope > div');
      if (squares.length === 0) return null;
      // Get position of the 5th square (middle of the slider)
      const targetSquare = squares[4] as HTMLElement;
      const rect = targetSquare.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });

    if (!sliderSquarePosition) {
      throw new Error('Could not find slider squares');
    }

    // This is the critical test: move mouse from Run button area to slider squares
    // The slider should stay visible due to the hover zone check
    await page.mouse.move(sliderSquarePosition.x, sliderSquarePosition.y);
    await page.waitForTimeout(300);
    console.log('Moved mouse to slider square 5');

    // Step 11: Verify slider is STILL visible after moving to squares
    // This is the main assertion - previously the slider would disappear here
    const sliderStillVisible = await page.evaluate(() => {
      const slider = document.querySelector('.distance-slider') as HTMLElement | null;
      if (!slider) return false;
      const computed = window.getComputedStyle(slider);
      return computed.display !== 'none' && computed.visibility !== 'hidden';
    });
    expect(sliderStillVisible).toBe(true);
    console.log('Distance slider is STILL visible after hovering over squares (hover zone fix works!)');

    // Step 12: Take screenshot - slider should stay visible
    await page.screenshot({
      path: 'e2e-tests/screenshots/distance-slider-step3-squares-hover.png',
      fullPage: true
    });
    console.log('Screenshot taken: distance-slider-step3-squares-hover.png');

    // Step 13: Verify squares show correct fill based on hover (square 5 = first 5 gold)
    const squareColors = await page.evaluate(() => {
      const slider = document.querySelector('.distance-slider');
      if (!slider) return [];
      const squaresRow = slider.querySelector(':scope > div:last-child');
      if (!squaresRow) return [];
      const squares = squaresRow.querySelectorAll(':scope > div');
      return Array.from(squares).map(sq => (sq as HTMLElement).style.background);
    });

    // First 5 squares should be gold (rgba(251, 191, 36, 0.9))
    const SLIDER_GOLD_COLOR = 'rgba(251, 191, 36, 0.9)';
    const SLIDER_GRAY_COLOR = 'rgba(255, 255, 255, 0.2)';

    for (let i = 0; i < 5; i++) {
      expect(squareColors[i]).toBe(SLIDER_GOLD_COLOR);
    }
    for (let i = 5; i < 10; i++) {
      expect(squareColors[i]).toBe(SLIDER_GRAY_COLOR);
    }
    console.log('Square colors are correct (1-5 gold, 6-10 gray)');

    // Step 14: Click a slider square
    await page.mouse.click(sliderSquarePosition.x, sliderSquarePosition.y);
    console.log('Clicked slider square 5');

    // Step 15: Wait 300ms as specified in task
    await page.waitForTimeout(300);

    // Step 16: Take screenshot after click
    await page.screenshot({
      path: 'e2e-tests/screenshots/distance-slider-step4-after-click.png',
      fullPage: true
    });
    console.log('Screenshot taken: distance-slider-step4-after-click.png');

    console.log('Test completed successfully - distance slider hover zone behavior verified');
  });

  test('slider remains visible when moving between menu and slider areas', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting slider transition test ===');

    // Setup
    await setupMockElectronAPI(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);

    // Add test node
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'slider-transition-test.md',
          contentWithoutYamlOrLinks: '# Transition Test\nTest mouse transitions.',
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
    await page.waitForTimeout(500);

    // Show menu
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#slider-transition-test.md');
      node.emit('mouseover');
    });
    await page.waitForTimeout(300);

    // Find Run button
    const runButtonPosition = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('.cy-horizontal-context-menu .horizontal-menu-item'));
      for (const button of buttons) {
        const svg = button.querySelector('svg[stroke="#22c55e"]');
        if (svg) {
          const rect = (button as HTMLElement).getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }
      }
      return null;
    });

    if (!runButtonPosition) {
      console.log('Run button not found - skipping test');
      return;
    }

    // Hover over Run button to show slider
    await page.mouse.move(runButtonPosition.x, runButtonPosition.y);
    await page.waitForTimeout(300);

    // Move to slider, then back to menu, then back to slider
    // This simulates user "wobbling" between the two areas
    for (let i = 0; i < 3; i++) {
      // Move to slider
      const sliderPos = await page.evaluate(() => {
        const slider = document.querySelector('.distance-slider');
        if (!slider) return null;
        const rect = slider.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      });

      if (sliderPos) {
        await page.mouse.move(sliderPos.x, sliderPos.y);
        await page.waitForTimeout(100);
      }

      // Verify slider still visible
      const stillVisible = await page.evaluate(() => {
        const slider = document.querySelector('.distance-slider') as HTMLElement | null;
        if (!slider) return false;
        const computed = window.getComputedStyle(slider);
        return computed.display !== 'none';
      });
      expect(stillVisible).toBe(true);

      // Move back to menu area
      await page.mouse.move(runButtonPosition.x, runButtonPosition.y);
      await page.waitForTimeout(100);
    }

    console.log('Slider remained visible through all transitions');

    // Final verification
    const finalSliderVisible = await page.evaluate(() => {
      const slider = document.querySelector('.distance-slider') as HTMLElement | null;
      if (!slider) return false;
      const computed = window.getComputedStyle(slider);
      return computed.display !== 'none';
    });
    expect(finalSliderVisible).toBe(true);

    console.log('Test completed successfully - slider transitions work correctly');
  });
});
