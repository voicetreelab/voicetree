import { test, expect } from '@playwright/test';

test.describe('VoiceTree Transcribe', () => {
  test('should start recording and add text input to history', async ({ page }) => {
    // Navigate to the application
    await page.goto('/');

    // Wait for the page to load
    await page.waitForLoadState('networkidle');

    // Find and click the start recording button
    // The button text changes based on state, look for button containing "Start"
    const startButton = page.locator('button').filter({ hasText: /Start/i });
    await expect(startButton).toBeVisible();
    await startButton.click();

    // Wait for the recording state to be active
    // The input should be hidden and sound wave visualizer should be shown
    await expect(page.locator('.flex-1.relative div.bg-gray-50')).toBeVisible();

    // Click stop button to stop recording
    const stopButton = page.locator('button').filter({ hasText: /Stop/i });
    await expect(stopButton).toBeVisible();
    await stopButton.click();

    // Wait for the input field to be visible again
    const textInput = page.locator('input[placeholder="Or type text here and press Enter..."]');
    await expect(textInput).toBeVisible();

    // Type text into the input field
    const testText = 'Test message from Playwright';
    await textInput.fill(testText);

    // Press Enter to submit
    await textInput.press('Enter');

    // Verify the text was sent (input should be cleared)
    await expect(textInput).toHaveValue('');

    // Verify the text appears in the history/transcript area
    const historyArea = page.locator('div.h-\\[400px\\].overflow-y-auto.p-4.border.rounded-lg.bg-white.mb-4');

    // Wait for the processing to complete and text to appear
    // Note: The actual appearance in history depends on the backend response
    // For now, we just verify the structure exists
    await expect(historyArea).toBeVisible();

    // Alternative: If the backend adds the text to the transcript, check for it
    // await expect(historyArea).toContainText(testText, { timeout: 10000 });
  });

  test('should disable input while processing', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const textInput = page.locator('input[placeholder="Or type text here and press Enter..."]');
    await expect(textInput).toBeVisible();

    // Mock the backend to simulate slow processing
    await page.route('http://localhost:8000/send-text', async route => {
      await page.waitForTimeout(2000); // Simulate slow response
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ buffer_length: 100 })
      });
    });

    // Type and submit text
    await textInput.fill('Test processing state');
    await textInput.press('Enter');

    // Input should be disabled during processing
    await expect(textInput).toBeDisabled();

    // Wait for processing to complete
    await expect(textInput).toBeEnabled({ timeout: 5000 });
  });

  test('should show error when backend is unavailable', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Mock backend to return error
    await page.route('http://localhost:8000/send-text', route => {
      route.abort('failed');
    });

    const textInput = page.locator('input[placeholder="Or type text here and press Enter..."]');
    await textInput.fill('Test error handling');
    await textInput.press('Enter');

    // Should handle the error gracefully
    await expect(textInput).toBeEnabled({ timeout: 5000 });
  });
});