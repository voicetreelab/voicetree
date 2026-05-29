/**
 * BEHAVIORAL SPEC:
 * Full E2E integration test for ProjectPathSelector lazy path expansion.
 *
 * This test verifies the complete user flow via FolderTreeSidebar:
 * 1. Type "docs/" in add-folder search → assert docs subfolders listed
 * 2. Type "docs/projects/" → assert projects subfolders listed
 * 3. Click "+" on "docs/projects/auth" to add it as read path
 * 4. Re-search → verify folder no longer appears (it's now loaded)
 * 5. Set a folder as write destination via Enter key
 */

import { expect } from '@playwright/test';
import {
  waitForCytoscapeReady,
  createTestGraphDelta,
  sendGraphDelta,
} from '@e2e/playwright-browser/graph-delta-test-utils';
import { test, setupMockElectronAPIWithNestedFolders } from './project-selector-test-setup';

test.describe('ProjectPathSelector E2E Integration Flow', () => {

  test('complete flow: navigate paths, add folder, verify it disappears from results', async ({ page, consoleCapture: _consoleCapture }) => {
    await setupMockElectronAPIWithNestedFolders(page);
    await page.goto('/');
    await waitForCytoscapeReady(page);

    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(200);

    const sidebar = page.locator('[data-testid="folder-tree-sidebar"]');
    await expect(sidebar).toBeVisible({ timeout: 5000 });

    const addInput = sidebar.locator('input[placeholder="+ Add folder..."]');
    await expect(addInput).toBeVisible();

    // Step 1: Type "docs/" and verify subfolders
    await addInput.fill('docs/');
    await page.waitForTimeout(300);

    const results = sidebar.locator('.folder-tree-add-results');
    await expect(results).toBeVisible({ timeout: 3000 });
    let resultsText = await results.textContent();

    expect(resultsText).toContain('./docs/api');
    expect(resultsText).toContain('./docs/projects');
    expect(resultsText).toContain('./docs/guides');

    // Step 2: Type "docs/projects/" and verify nested subfolders
    await addInput.fill('docs/projects/');
    await page.waitForTimeout(300);

    resultsText = await results.textContent();
    expect(resultsText).toContain('./docs/projects/auth');
    expect(resultsText).toContain('./docs/projects/core');

    // Step 3: Click "+" on docs/projects/auth to add it as read path
    const authItem = results.locator('.folder-tree-add-result-item:has-text("./docs/projects/auth")');
    await expect(authItem).toBeVisible();
    const addButton = authItem.locator('.folder-tree-add-result-btn');
    await addButton.click();
    await page.waitForTimeout(300);

    // Step 4: Re-search — auth should no longer appear (it's now loaded)
    await addInput.fill('docs/projects/');
    await page.waitForTimeout(300);

    resultsText = await results.textContent() ?? '';
    expect(resultsText).not.toContain('./docs/projects/auth');
    expect(resultsText).toContain('./docs/projects/core');
  });

  test('add folder as write destination via Enter key', async ({ page, consoleCapture: _consoleCapture }) => {
    await setupMockElectronAPIWithNestedFolders(page);
    await page.goto('/');
    await waitForCytoscapeReady(page);

    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(200);

    const sidebar = page.locator('[data-testid="folder-tree-sidebar"]');
    await expect(sidebar).toBeVisible({ timeout: 5000 });

    const addInput = sidebar.locator('input[placeholder="+ Add folder..."]');

    // Type a folder path and press Enter to set as write destination
    await addInput.fill('docs/projects/core');
    await page.waitForTimeout(300);
    await addInput.press('Enter');
    await page.waitForTimeout(300);

    // Verify the ProjectPathSelector button title reflects the new write path
    const selectorButton = page.locator('button[title*="Write Path:"]');
    await expect(selectorButton).toBeVisible({ timeout: 5000 });
    const title = await selectorButton.getAttribute('title');
    expect(title).toContain('docs/projects/core');
  });
});

export { test };
