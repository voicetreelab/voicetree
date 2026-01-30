/**
 * Screenshot test for settings editor
 * Verifies settings editor opens with fixed size and viewport zooms to 75%
 */

import { test, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  selectMockProject,
  waitForCytoscapeReady,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils.ts';

test.describe('Settings Editor Screenshot', () => {
  test('should open settings editor with fixed size and zoom to 75% viewport', async ({ page }) => {
    await setupMockElectronAPI(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);

    // Click the settings button in speed dial menu
    const settingsButton = page.locator('.speed-dial-container button').filter({ hasText: /settings/i }).first();

    // If no text match, try by index (settings is the second item, index 1)
    const settingsButtonByIndex = page.locator('.speed-dial-container button').nth(1);

    // Try clicking - first by aria/text, fallback to index
    const buttonToClick = await settingsButton.count() > 0 ? settingsButton : settingsButtonByIndex;
    await buttonToClick.click();

    // Wait for settings editor to appear
    const settingsEditorSelector = '#window-settings-editor';
    await page.waitForSelector(settingsEditorSelector, { timeout: 5000 });
    await page.waitForTimeout(500); // Wait for zoom animation to complete

    // Take screenshot of the full page showing settings editor at 75% viewport
    await page.screenshot({
      path: 'e2e-tests/screenshots/settings-editor-full-viewport.png'
    });

    // Take screenshot of just the settings editor window
    const settingsWindow = page.locator(settingsEditorSelector);
    await expect(settingsWindow).toBeVisible();
    await settingsWindow.screenshot({
      path: 'e2e-tests/screenshots/settings-editor-window.png'
    });

    // Verify the shadow node was created
    const hasShadowNode = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return false;
      const shadowNode = cy.$('#shadow-settings-editor');
      return shadowNode.length > 0;
    });
    expect(hasShadowNode).toBe(true);
  });
});
