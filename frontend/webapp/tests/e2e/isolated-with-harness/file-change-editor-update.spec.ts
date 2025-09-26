import { test, expect } from '@playwright/test';

test.describe('File Change Editor Update Integration', () => {

  test('should update editor content when external file changes', async ({ page }) => {
    // Navigate to the test page in file-watcher mode
    await page.goto('/tests/e2e/isolated-with-harness/harness.html?mode=file-watcher');

    // Wait for initialization
    await page.waitForTimeout(1000);

    // Verify page loaded
    await expect(page.locator('h1:has-text("File Watcher Editor Test")')).toBeVisible();

    // Open an editor for a node
    await page.locator('button:has-text("Open Editor for Test Node")').click();

    // Verify floating window appears with initial content
    const window = page.locator('.floating-window');
    await expect(window).toBeVisible();
    await expect(window.locator('.window-title-bar')).toContainText('test.md');
    await expect(window.locator('.w-md-editor-text-input')).toHaveValue('# Old Content');

    // Simulate external file change
    await page.evaluate(() => {
      // Trigger a file change event similar to what would happen with real file watching
      const event = new CustomEvent('simulateFileChange', {
        detail: {
          path: 'test/test.md',
          content: '# New Content from External Change'
        }
      });
      window.dispatchEvent(event);
    });

    // Wait for the update to propagate
    await page.waitForTimeout(100);

    // Verify the editor content has been updated
    await expect(window.locator('.w-md-editor-text-input')).toHaveValue('# New Content from External Change');

    // Verify the update was logged
    const logs = await page.evaluate(() => {
      return (window as any)._test_logs || [];
    });

    expect(logs.some((log: string) =>
      log.includes('Updating editor content for node') &&
      log.includes('due to external file change')
    )).toBe(true);
  });

  test('should not update editor if no editor is open for changed file', async ({ page }) => {
    // Navigate to the test page in file-watcher mode
    await page.goto('/tests/e2e/isolated-with-harness/harness.html?mode=file-watcher');

    // Wait for initialization
    await page.waitForTimeout(1000);

    // Simulate external file change without any editor open
    await page.evaluate(() => {
      const event = new CustomEvent('simulateFileChange', {
        detail: {
          path: 'test/other.md',
          content: '# Some new content'
        }
      });
      window.dispatchEvent(event);
    });

    // Wait a bit
    await page.waitForTimeout(100);

    // Verify no editor window appeared
    const window = page.locator('.floating-window');
    await expect(window).not.toBeVisible();

    // Verify the logs show no editor update attempt
    const logs = await page.evaluate(() => {
      return (window as any)._test_logs || [];
    });

    expect(logs.some((log: string) =>
      log.includes('Updating editor content')
    )).toBe(false);
  });

  test('should handle multiple open editors independently', async ({ page }) => {
    // Navigate to the test page in file-watcher mode
    await page.goto('/tests/e2e/isolated-with-harness/harness.html?mode=file-watcher');

    // Wait for initialization
    await page.waitForTimeout(1000);

    // Open first editor
    await page.locator('button:has-text("Open Editor for Test Node")').click();

    // Open second editor
    await page.locator('button:has-text("Open Editor for Other Node")').click();

    // Verify both windows are visible
    const windows = page.locator('.floating-window');
    await expect(windows).toHaveCount(2);

    // Simulate file change for first file only
    await page.evaluate(() => {
      const event = new CustomEvent('simulateFileChange', {
        detail: {
          path: 'test/test.md',
          content: '# Updated First File'
        }
      });
      window.dispatchEvent(event);
    });

    await page.waitForTimeout(100);

    // Verify only the first editor was updated
    const firstEditor = windows.nth(0);
    const secondEditor = windows.nth(1);

    await expect(firstEditor.locator('.w-md-editor-text-input')).toHaveValue('# Updated First File');
    await expect(secondEditor.locator('.w-md-editor-text-input')).toHaveValue('# Other Content'); // unchanged
  });
});