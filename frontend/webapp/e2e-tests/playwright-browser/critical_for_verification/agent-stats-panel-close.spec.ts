/**
 * Browser-based test for Agent Statistics panel close button
 *
 * Bug: The close button (✕) in the top-right corner of the Agent Statistics panel
 * doesn't work. Only the "Stats" button in the SpeedDial menu closes the panel.
 *
 * Fix: The agent-tabs-bar (positioned at top: 8px, right: 12px with z-index: 1100)
 * was overlapping the close button. Fixed by ensuring the stats panel has a higher z-index.
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  waitForCytoscapeReady,
} from '@e2e/playwright-browser/graph-delta-test-utils';

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

test.describe('Agent Statistics Panel Close Button', () => {
  test('should close the panel when clicking the close button', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting Agent Statistics panel close button test ===');

    console.log('=== Step 1: Setup mock Electron API ===');
    await setupMockElectronAPI(page);
    console.log('OK Electron API mock prepared');

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    console.log('OK React rendered');

    await page.waitForTimeout(50);

    console.log('=== Step 3: Wait for Cytoscape ===');
    await waitForCytoscapeReady(page);
    console.log('OK Cytoscape initialized');

    console.log('=== Step 4: Open Agent Statistics panel via toggle event ===');
    // Dispatch the toggle-stats-panel event that opens the panel
    await page.evaluate(() => {
      window.dispatchEvent(new Event('toggle-stats-panel'));
    });
    await page.waitForTimeout(100);
    console.log('OK Toggle event dispatched');

    console.log('=== Step 5: Verify panel is open ===');
    const panelContainer = page.locator('[data-testid="agent-stats-panel-container"]');
    await expect(panelContainer).toBeVisible({ timeout: 3000 });
    console.log('OK Panel is visible');

    console.log('=== Step 6: Take screenshot BEFORE clicking close button ===');
    await page.screenshot({
      path: 'e2e-tests/screenshots/stats-panel-close-before.png',
      fullPage: true
    });
    console.log('OK Screenshot taken: stats-panel-close-before.png');

    console.log('=== Step 7: Find and click the close button ===');
    // The close button is inside the sticky header of the panel
    const closeButton = page.locator('[data-testid="agent-stats-close-button"]');
    await expect(closeButton).toBeVisible({ timeout: 2000 });

    // Verify the button is clickable (not obscured)
    const buttonBox = await closeButton.boundingBox();
    expect(buttonBox).not.toBeNull();
    console.log(`  Close button position: ${buttonBox?.x}, ${buttonBox?.y} (${buttonBox?.width}x${buttonBox?.height})`);

    // Click the close button
    await closeButton.click();
    await page.waitForTimeout(100);
    console.log('OK Close button clicked');

    console.log('=== Step 8: Verify panel is closed ===');
    await expect(panelContainer).not.toBeVisible({ timeout: 2000 });
    console.log('OK Panel is no longer visible');

    console.log('=== Step 9: Take screenshot AFTER clicking close button ===');
    await page.screenshot({
      path: 'e2e-tests/screenshots/stats-panel-close-after.png',
      fullPage: true
    });
    console.log('OK Screenshot taken: stats-panel-close-after.png');

    console.log('OK Agent Statistics panel close button test completed successfully');
  });

  test('should have close button not obscured by other elements', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting close button visibility test ===');

    await setupMockElectronAPI(page);
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);

    // Open the stats panel
    await page.evaluate(() => {
      window.dispatchEvent(new Event('toggle-stats-panel'));
    });
    await page.waitForTimeout(100);

    const panelContainer = page.locator('[data-testid="agent-stats-panel-container"]');
    await expect(panelContainer).toBeVisible({ timeout: 3000 });

    // Get the close button
    const closeButton = page.locator('[data-testid="agent-stats-close-button"]');
    await expect(closeButton).toBeVisible({ timeout: 2000 });

    // Check that the element at the close button's center is actually the close button
    // This verifies nothing is overlapping/obscuring it
    const buttonBox = await closeButton.boundingBox();
    expect(buttonBox).not.toBeNull();

    if (buttonBox) {
      const centerX = buttonBox.x + buttonBox.width / 2;
      const centerY = buttonBox.y + buttonBox.height / 2;

      const elementAtPoint = await page.evaluate(({ x, y }) => {
        const element = document.elementFromPoint(x, y);
        if (!element) return null;
        return {
          tagName: element.tagName,
          title: element.getAttribute('title'),
          textContent: element.textContent?.trim().substring(0, 20),
          className: element.className,
          testId: element.getAttribute('data-testid')
        };
      }, { x: centerX, y: centerY });

      console.log(`Element at close button center (${centerX}, ${centerY}):`, elementAtPoint);

      // The element at point should be the close button or its child
      expect(elementAtPoint).not.toBeNull();
      expect(
        elementAtPoint?.title === 'Close panel' ||
        elementAtPoint?.textContent === '✕' ||
        elementAtPoint?.testId === 'agent-stats-close-button'
      ).toBe(true);
    }

    console.log('OK Close button is not obscured');
  });
});
