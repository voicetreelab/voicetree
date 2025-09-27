import { test, expect } from '@playwright/test';

test.describe('Basic Window Resizing', () => {
  test('should resize window using the simple test page', async ({ page }) => {
    // Navigate to our simple test page
    await page.goto('http://localhost:3000/tests/e2e/isolated-with-harness/simple-resize-test.html');

    // Wait for the window to appear
    await page.waitForSelector('.floating-window', { timeout: 5000 });

    // Get initial size from the text
    const initialSizeText = await page.textContent('p:has-text("Size:")');
    console.log('Initial size text:', initialSizeText);

    // Get the resizable content element bounds
    const resizable = await page.locator('.resizable-content').first();
    const bounds = await resizable.boundingBox();

    if (!bounds) {
      throw new Error('Could not find resizable element bounds');
    }

    console.log('Initial bounds:', bounds);

    // Drag from bottom-right corner
    const handleX = bounds.x + bounds.width - 5;
    const handleY = bounds.y + bounds.height - 5;

    // Perform resize
    await page.mouse.move(handleX, handleY);
    await page.mouse.down();
    await page.mouse.move(handleX + 100, handleY + 100, { steps: 10 });
    await page.mouse.up();

    // Wait for resize to complete
    await page.waitForTimeout(500);

    // Check new size from text
    const newSizeText = await page.textContent('p:has-text("Size:")');
    console.log('New size text:', newSizeText);

    // Verify size changed
    expect(newSizeText).not.toBe(initialSizeText);

    // Parse sizes and verify increase
    const initialMatch = initialSizeText?.match(/(\d+) x (\d+)/);
    const newMatch = newSizeText?.match(/(\d+) x (\d+)/);

    if (initialMatch && newMatch) {
      const initialWidth = parseInt(initialMatch[1]);
      const initialHeight = parseInt(initialMatch[2]);
      const newWidth = parseInt(newMatch[1]);
      const newHeight = parseInt(newMatch[2]);

      console.log('Size change:', {
        width: newWidth - initialWidth,
        height: newHeight - initialHeight
      });

      // Verify window got bigger
      expect(newWidth).toBeGreaterThan(initialWidth);
      expect(newHeight).toBeGreaterThan(initialHeight);

      // Should be approximately 100px bigger (with some tolerance)
      expect(Math.abs((newWidth - initialWidth) - 100)).toBeLessThan(20);
      expect(Math.abs((newHeight - initialHeight) - 100)).toBeLessThan(20);
    }
  });
});