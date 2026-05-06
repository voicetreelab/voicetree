/**
 * Minimal CI smoke test: proves Playwright + Vite dev server work in GitHub Actions.
 * Single test that navigates to the app and verifies basic page rendering.
 */
import { test, expect } from '@playwright/test';

test('app page loads and renders root element', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);

  await expect(page.locator('#root')).toBeAttached();
  await expect(page.locator('body')).not.toBeEmpty();
});
