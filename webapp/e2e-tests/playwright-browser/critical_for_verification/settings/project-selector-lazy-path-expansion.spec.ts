/**
 * BEHAVIORAL SPEC:
 * Tests for ProjectPathSelector lazy path expansion via FolderTreeSidebar footer.
 *
 * Verifies nested path navigation in the "Add folder" search:
 * 1. Type "docs/" → shows docs subfolders
 * 2. Type "docs/pro" → shows filtered results
 * 3. Display paths show full relative path (e.g., ./docs/projects/auth)
 * 4. Invalid paths return empty results
 */

import { expect } from '@playwright/test';
import {
  waitForCytoscapeReady,
  createTestGraphDelta,
  sendGraphDelta,
} from '@e2e/playwright-browser/graph-delta-test-utils';
import { test, setupMockElectronAPIWithNestedFolders } from './project-selector-test-setup';

test.describe('ProjectPathSelector Lazy Path Expansion', () => {

  test('should show subfolders when typing "docs/"', async ({ page, consoleCapture: _consoleCapture }) => {
    await setupMockElectronAPIWithNestedFolders(page);
    await page.goto('/');
    await waitForCytoscapeReady(page);

    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(200);

    // Sidebar opens by default
    const sidebar = page.locator('[data-testid="folder-tree-sidebar"]');
    await expect(sidebar).toBeVisible({ timeout: 5000 });

    // Type "docs/" in footer add-folder input
    const addInput = sidebar.locator('input[placeholder="+ Add folder..."]');
    await expect(addInput).toBeVisible();
    await addInput.fill('docs/');
    await page.waitForTimeout(300);

    // Verify docs subfolders appear in results
    const results = sidebar.locator('.folder-tree-add-results');
    await expect(results).toBeVisible({ timeout: 3000 });
    const resultsText = await results.textContent();

    expect(resultsText).toContain('./docs/api');
    expect(resultsText).toContain('./docs/projects');
    expect(resultsText).toContain('./docs/guides');
  });

  test('should filter results when typing "docs/pro"', async ({ page, consoleCapture: _consoleCapture }) => {
    await setupMockElectronAPIWithNestedFolders(page);
    await page.goto('/');
    await waitForCytoscapeReady(page);

    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(200);

    const sidebar = page.locator('[data-testid="folder-tree-sidebar"]');
    await expect(sidebar).toBeVisible({ timeout: 5000 });

    const addInput = sidebar.locator('input[placeholder="+ Add folder..."]');
    await addInput.fill('docs/pro');
    await page.waitForTimeout(300);

    const results = sidebar.locator('.folder-tree-add-results');
    await expect(results).toBeVisible({ timeout: 3000 });
    const resultsText = await results.textContent();

    expect(resultsText).toContain('./docs/projects');
    expect(resultsText).not.toContain('./docs/api');
    expect(resultsText).not.toContain('./docs/guides');
  });

  test('should show nested path in display (docs/projects/auth)', async ({ page, consoleCapture: _consoleCapture }) => {
    await setupMockElectronAPIWithNestedFolders(page);
    await page.goto('/');
    await waitForCytoscapeReady(page);

    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(200);

    const sidebar = page.locator('[data-testid="folder-tree-sidebar"]');
    await expect(sidebar).toBeVisible({ timeout: 5000 });

    const addInput = sidebar.locator('input[placeholder="+ Add folder..."]');
    await addInput.fill('docs/projects/');
    await page.waitForTimeout(300);

    const results = sidebar.locator('.folder-tree-add-results');
    await expect(results).toBeVisible({ timeout: 3000 });
    const resultsText = await results.textContent();

    expect(resultsText).toContain('./docs/projects/auth');
    expect(resultsText).toContain('./docs/projects/core');
  });

  test('should return empty results for invalid/escape paths like "../"', async ({ page, consoleCapture: _consoleCapture }) => {
    await setupMockElectronAPIWithNestedFolders(page);
    await page.goto('/');
    await waitForCytoscapeReady(page);

    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(200);

    const sidebar = page.locator('[data-testid="folder-tree-sidebar"]');
    await expect(sidebar).toBeVisible({ timeout: 5000 });

    const addInput = sidebar.locator('input[placeholder="+ Add folder..."]');
    await addInput.fill('../etc');
    await page.waitForTimeout(300);

    // No results should appear for invalid paths
    const results = sidebar.locator('.folder-tree-add-results');
    const resultItems = results.locator('.folder-tree-add-result-item');
    expect(await resultItems.count()).toBe(0);
  });
});

export { test };
