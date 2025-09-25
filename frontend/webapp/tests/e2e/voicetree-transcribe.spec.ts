import { test, expect } from '@playwright/test';

test.describe('VoiceTree Transcribe', () => {
  test('should start recording and add text input to transcription', async ({ page }) => {
    // Navigate to the application
    await page.goto('/');

    // Wait for the page to load
    await page.waitForLoadState('networkidle');

    // Find the mic button by its class pattern
    const micButton = page.locator('button.p-3.rounded-lg').first();
    await expect(micButton).toBeVisible();

    // Check initial state - should have Mic icon (not recording)
    const initialClass = await micButton.getAttribute('class');
    expect(initialClass).toContain('bg-primary');

    // Click to start recording
    await micButton.click();

    // Wait for recording state
    await page.waitForTimeout(500);

    // Button should now show stop state (red background)
    const recordingClass = await micButton.getAttribute('class');
    expect(recordingClass).toContain('bg-destructive');

    // Sound wave visualizer should be visible
    const soundWave = page.locator('.flex-1.px-4.py-2.border.border-gray-300.rounded-lg.bg-gray-50');
    await expect(soundWave).toBeVisible();

    // Click to stop recording
    await micButton.click();

    // Wait for the input field to be visible again
    const textInput = page.locator('input[placeholder="Or type text here and press Enter..."]');
    await expect(textInput).toBeVisible();
    await expect(textInput).toBeEnabled();
  });

  test('should submit text via input field', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const textInput = page.locator('input[placeholder="Or type text here and press Enter..."]');
    await expect(textInput).toBeVisible();

    // Mock the backend to respond immediately
    await page.route('http://localhost:8000/send-text', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ buffer_length: 100 })
      });
    });

    // Type and submit text
    const testText = 'Test message from Playwright';
    await textInput.fill(testText);

    // Click Send button
    const sendButton = page.locator('button:has-text("Send")');
    await sendButton.click();

    // Verify the text was sent (input should be cleared)
    await expect(textInput).toHaveValue('');
  });

  test('should disable input while processing', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const textInput = page.locator('input[placeholder="Or type text here and press Enter..."]');
    await expect(textInput).toBeVisible();

    // Mock the backend to simulate slow processing
    await page.route('http://localhost:8000/send-text', async route => {
      await page.waitForTimeout(1000); // Shorter delay
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
    await expect(textInput).toBeEnabled({ timeout: 3000 });
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

    // Should handle the error gracefully - input re-enables after error
    await expect(textInput).toBeEnabled({ timeout: 3000 });

    // Check for error message
    const errorMessage = page.locator('text=/Server Offline/i');
    await expect(errorMessage).toBeVisible({ timeout: 3000 });
  });
});