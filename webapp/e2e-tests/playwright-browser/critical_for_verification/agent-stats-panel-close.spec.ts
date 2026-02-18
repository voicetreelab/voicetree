/**
 * Browser-based test for Agent Statistics panel close behavior.
 * The panel can be closed by clicking on the graph canvas background
 * (which dispatches a 'close-stats-panel' event) or by toggling the Stats button.
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  selectMockProject,
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

test.describe('Agent Statistics Panel Close', () => {
  test('should close the panel when clicking on graph canvas background', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting canvas click close test ===');

    console.log('=== Step 1: Setup mock Electron API ===');
    await setupMockElectronAPI(page);
    console.log('OK Electron API mock prepared');

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    console.log('OK React rendered');

    await page.waitForTimeout(50);

    console.log('=== Step 3: Wait for Cytoscape ===');
    await waitForCytoscapeReady(page);
    console.log('OK Cytoscape initialized');

    console.log('=== Step 4: Open Agent Statistics panel via toggle event ===');
    await page.evaluate(() => {
      window.dispatchEvent(new Event('toggle-stats-panel'));
    });
    await page.waitForTimeout(100);
    console.log('OK Toggle event dispatched');

    console.log('=== Step 5: Verify panel is open ===');
    const panelContainer = page.locator('[data-testid="agent-stats-panel-container"]');
    await expect(panelContainer).toBeVisible({ timeout: 3000 });
    console.log('OK Panel is visible');

    console.log('=== Step 6: Click on graph canvas background ===');
    // Dispatch the close-stats-panel event that would be triggered by clicking on canvas
    // This simulates what happens when Cytoscape detects a tap on its background
    await page.evaluate(() => {
      window.dispatchEvent(new Event('close-stats-panel'));
    });
    await page.waitForTimeout(100);
    console.log('OK close-stats-panel event dispatched (simulating canvas click)');

    console.log('=== Step 7: Verify panel is closed ===');
    await expect(panelContainer).not.toBeVisible({ timeout: 2000 });
    console.log('OK Panel is no longer visible after canvas click');

    console.log('OK Canvas click close test completed successfully');
  });
});
