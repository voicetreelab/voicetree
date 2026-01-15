/**
 * Screenshot test for Agent Command Editor Popup
 * Verifies the popup appears correctly and captures screenshot for visual verification
 *
 * Related task: openspec/changes/add-worktree-agent-spawn/tasks_0.md
 * Tests: 4.5-4.8 E2E Tests for Agent Command Editor Popup
 */

import { test, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  waitForCytoscapeReady,
  sendGraphDelta,
  createTestGraphDelta,
} from '@e2e/playwright-browser/graph-delta-test-utils';

test.describe('Agent Command Editor Popup Screenshot', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockElectronAPI(page);
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);

    // Add some nodes to the graph for context
    await sendGraphDelta(page, createTestGraphDelta());
    await page.waitForTimeout(100);
  });

  // 4.5 & 4.6 & 4.8: Popup opens and shows command in editable input field + screenshot
  test('should show agent command editor popup and capture screenshot', async ({ page }) => {
    // Import and call showAgentCommandEditor directly from the app
    const dialogPromise = page.evaluate(async () => {
      // Dynamic import of the popup module
      const module = await import('/src/shell/edge/UI-edge/graph/agentCommandEditorPopup.ts' as string);

      // Show the popup with a sample Claude command (no quotes to avoid HTML escaping issues)
      // Don't await - we want to interact with it while it's open
      void module.showAgentCommandEditor('claude --print test-command');

      // Wait for dialog to appear
      await new Promise(resolve => setTimeout(resolve, 100));

      return true;
    });

    await dialogPromise;

    // Wait for dialog to appear
    const dialog = page.locator('#agent-command-editor-dialog');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Verify dialog has all required UI elements
    await expect(dialog.locator('h2')).toContainText('Agent Command');
    await expect(dialog.locator('#command-input')).toBeVisible();
    await expect(dialog.locator('[data-testid="add-auto-run-button"]')).toBeVisible();
    await expect(dialog.locator('[data-testid="cancel-button"]')).toBeVisible();
    await expect(dialog.locator('[data-testid="run-button"]')).toBeVisible();

    // Verify command is shown in input field
    const input = dialog.locator('#command-input');
    await expect(input).toHaveValue('claude --print test-command');

    // Take screenshot with dialog visible - this is the main visual verification
    await page.screenshot({
      path: 'e2e-tests/screenshots/agent-command-editor-popup.png'
    });

    // Clean up by clicking cancel
    await dialog.locator('[data-testid="cancel-button"]').click();
    await expect(dialog).not.toBeVisible({ timeout: 2000 });
  });

  // 4.7: User can edit command and Run executes modified command
  test('should allow editing command and return modified value on Run click', async ({ page }) => {
    // Create a promise to capture the result
    const resultPromise = page.evaluate(async () => {
      const module = await import('/src/shell/edge/UI-edge/graph/agentCommandEditorPopup.ts' as string);
      return module.showAgentCommandEditor('claude test command');
    });

    // Wait for dialog
    const dialog = page.locator('#agent-command-editor-dialog');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Edit the command
    const input = dialog.locator('#command-input');
    await input.clear();
    await input.fill('claude modified --flag test');

    // Click Run
    await dialog.locator('[data-testid="run-button"]').click();

    // Verify result
    const result = await resultPromise;
    expect(result).toBe('claude modified --flag test');
  });

  test('should add auto-run flag when button clicked', async ({ page }) => {
    // Show popup
    void page.evaluate(async () => {
      const module = await import('/src/shell/edge/UI-edge/graph/agentCommandEditorPopup.ts' as string);
      void module.showAgentCommandEditor('claude test');
    });

    // Wait for dialog
    const dialog = page.locator('#agent-command-editor-dialog');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Verify Add auto-run button is enabled
    const addAutoRunButton = dialog.locator('[data-testid="add-auto-run-button"]');
    await expect(addAutoRunButton).toBeEnabled();

    // Click Add auto-run button
    await addAutoRunButton.click();

    // Verify flag was added to input
    const input = dialog.locator('#command-input');
    await expect(input).toHaveValue(/--dangerously-skip-permissions/);

    // Verify button is now disabled
    await expect(addAutoRunButton).toBeDisabled();

    // Clean up
    await dialog.locator('[data-testid="cancel-button"]').click();
  });

  test('should disable auto-run button when flag already present', async ({ page }) => {
    // Show popup with command that already has the flag
    void page.evaluate(async () => {
      const module = await import('/src/shell/edge/UI-edge/graph/agentCommandEditorPopup.ts' as string);
      void module.showAgentCommandEditor('claude --dangerously-skip-permissions test');
    });

    // Wait for dialog
    const dialog = page.locator('#agent-command-editor-dialog');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Verify Add auto-run button is disabled from the start
    const addAutoRunButton = dialog.locator('[data-testid="add-auto-run-button"]');
    await expect(addAutoRunButton).toBeDisabled();

    // Clean up
    await dialog.locator('[data-testid="cancel-button"]').click();
  });

  test('should return null when Cancel is clicked', async ({ page }) => {
    // Create a promise to capture the result
    const resultPromise = page.evaluate(async () => {
      const module = await import('/src/shell/edge/UI-edge/graph/agentCommandEditorPopup.ts' as string);
      return module.showAgentCommandEditor('claude test');
    });

    // Wait for dialog
    const dialog = page.locator('#agent-command-editor-dialog');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Click Cancel
    await dialog.locator('[data-testid="cancel-button"]').click();

    // Verify result is null
    const result = await resultPromise;
    expect(result).toBeNull();
  });
});
