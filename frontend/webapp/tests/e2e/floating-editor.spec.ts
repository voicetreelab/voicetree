import { test, expect } from '@playwright/test';

test.describe('Floating Markdown Editor Standalone Test', () => {

  test('should render the editor and allow editing and saving', async ({ page }) => {
    // Navigate to the test harness page
    await page.goto('/floating-editor-e2e-test.html');

    // 0. Verify the test harness itself is rendering
    await expect(page.locator('h1:has-text("Editor Test Harness")')).toBeVisible();

    // 1. Click the button to open the editor window
    await page.click('button:has-text("Open Editor")');

    // 2. Verify the window and editor are visible
    const window = page.locator('.floating-window');
    await expect(window).toBeVisible();

    const editorInput = window.locator('.w-md-editor-text-input');
    await expect(editorInput).toBeVisible();

    // 3. Verify initial content
    await expect(editorInput).toHaveValue('# Hello World');

    // 4. Simulate user editing the content
    await editorInput.fill('# New Content From Test');
    await expect(editorInput).toHaveValue('# New Content From Test');

    // 5. Test the Save functionality
    const saveButton = window.locator('button:has-text("Save")');
    await saveButton.click();

    // The button text should change to Saving... and then Saved!
    await expect(window.locator('button:has-text("Saving...")')).toBeVisible();
    await expect(window.locator('button:has-text("Saved!")')).toBeVisible({ timeout: 2000 });

    // Poll for the global variable that our mock save function sets
    await expect.poll(async () => {
      return page.evaluate(() => (window as any)._test_savedPayload);
    }, { message: 'Waiting for save payload to be set on window' }).toMatchObject({
      filePath: 'test/file.md',
      content: '# New Content From Test'
    });

    // 6. Test the Close button
    const closeButton = window.locator('[aria-label="Close"] , button:has-text("×")').first();
    await closeButton.click();

    // The window should no longer be visible
    await expect(window).not.toBeVisible();
  });
});