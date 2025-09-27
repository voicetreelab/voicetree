import { test, expect } from '@playwright/test';

/**
 * Minimal E2E test to demonstrate that floating window resizing doesn't work.
 * This test follows TDD principles - we write the test first to show the current
 * behavior fails, then fix the implementation.
 */

test.describe('Floating Window Resizing', () => {

  test('should be able to resize floating window by dragging resize handles', async ({ page }) => {
    // Navigate to the test harness using the dev server
    const harnessUrl = `http://localhost:3000/tests/e2e/isolated-with-harness/resize-test.html`;
    await page.goto(harnessUrl);

    // Wait for the floating window to render
    await page.waitForSelector('.floating-window', { timeout: 5000 });

    // Get initial size
    const windowElement = await page.locator('.floating-window').first();
    const initialBounds = await windowElement.boundingBox();
    expect(initialBounds).toBeTruthy();

    console.log('Initial window size:', {
      width: initialBounds?.width,
      height: initialBounds?.height
    });

    // Find the resize handle - look for the Resizable component's handle
    // re-resizable adds specific classes for resize handles
    const resizeHandle = await page.locator('.floating-window').first();
    const bounds = await resizeHandle.boundingBox();

    if (!bounds) {
      throw new Error('Could not find window bounds');
    }

    // The bottom-right resize handle should be at the corner
    const handleX = bounds.x + bounds.width - 6; // 6px from edge for handle
    const handleY = bounds.y + bounds.height - 6;

    console.log('Attempting to resize from position:', { handleX, handleY });

    // Move to resize handle and drag
    await page.mouse.move(handleX, handleY);
    await page.mouse.down();

    // Drag 100px right and 100px down
    await page.mouse.move(handleX + 100, handleY + 100, { steps: 10 });
    await page.mouse.up();

    // Wait for resize animation/update
    await page.waitForTimeout(500);

    // Get new size
    const newBounds = await windowElement.boundingBox();
    expect(newBounds).toBeTruthy();

    console.log('New window size:', {
      width: newBounds?.width,
      height: newBounds?.height
    });

    // Assert that the window has been resized
    // The window should be larger after dragging the resize handle
    expect(newBounds?.width).toBeGreaterThan(initialBounds?.width || 0);
    expect(newBounds?.height).toBeGreaterThan(initialBounds?.height || 0);

    // The resize should be approximately 100px in each direction (with some tolerance)
    const widthDiff = (newBounds?.width || 0) - (initialBounds?.width || 0);
    const heightDiff = (newBounds?.height || 0) - (initialBounds?.height || 0);

    console.log('Size differences:', { widthDiff, heightDiff });

    // Allow 20px tolerance due to possible constraints or rounding
    expect(Math.abs(widthDiff - 100)).toBeLessThan(20);
    expect(Math.abs(heightDiff - 100)).toBeLessThan(20);
  });

  test('should respect minimum size constraints when resizing', async ({ page }) => {
    // Navigate to the test harness using the dev server
    const harnessUrl = `http://localhost:3000/tests/e2e/isolated-with-harness/resize-test.html`;
    await page.goto(harnessUrl);

    // Wait for the floating window to render
    await page.waitForSelector('.floating-window', { timeout: 5000 });

    // Click reset to ensure we start with default size
    await page.click('#reset-window');
    await page.waitForTimeout(500);

    // Wait for new window
    await page.waitForSelector('.floating-window', { timeout: 5000 });

    // Get initial size
    const windowElement = await page.locator('.floating-window').first();
    const initialBounds = await windowElement.boundingBox();
    expect(initialBounds).toBeTruthy();

    if (!initialBounds) {
      throw new Error('Could not find initial bounds');
    }

    // Try to resize the window to be smaller than minimum (300x200)
    const handleX = initialBounds.x + initialBounds.width - 6;
    const handleY = initialBounds.y + initialBounds.height - 6;

    // Drag inward to try to make it very small (100x100)
    await page.mouse.move(handleX, handleY);
    await page.mouse.down();

    // Move to a position that would make the window 100x100
    const targetX = initialBounds.x + 100;
    const targetY = initialBounds.y + 100;
    await page.mouse.move(targetX, targetY, { steps: 10 });
    await page.mouse.up();

    // Wait for resize to complete
    await page.waitForTimeout(500);

    // Get new size
    const newBounds = await windowElement.boundingBox();
    expect(newBounds).toBeTruthy();

    console.log('After trying to make very small:', {
      width: newBounds?.width,
      height: newBounds?.height
    });

    // Assert minimum size constraints are respected
    // The window should not be smaller than 300x200
    expect(newBounds?.width).toBeGreaterThanOrEqual(300);
    expect(newBounds?.height).toBeGreaterThanOrEqual(200);
  });

  test('should show visual resize handle indicator', async ({ page }) => {
    // Navigate to the test harness using the dev server
    const harnessUrl = `http://localhost:3000/tests/e2e/isolated-with-harness/resize-test.html`;
    await page.goto(harnessUrl);

    // Wait for the floating window to render
    await page.waitForSelector('.floating-window', { timeout: 5000 });

    // Check for the visual resize handle indicator (SVG in bottom-right corner)
    const resizeIndicator = await page.locator('.floating-window svg').first();
    const isVisible = await resizeIndicator.isVisible();

    expect(isVisible).toBeTruthy();

    // The SVG should be positioned in the bottom-right corner
    const svgBounds = await resizeIndicator.boundingBox();
    const windowBounds = await page.locator('.floating-window').first().boundingBox();

    if (svgBounds && windowBounds) {
      // Check that SVG is near the bottom-right corner
      const rightDistance = (windowBounds.x + windowBounds.width) - (svgBounds.x + svgBounds.width);
      const bottomDistance = (windowBounds.y + windowBounds.height) - (svgBounds.y + svgBounds.height);

      expect(rightDistance).toBeLessThan(20); // Should be within 20px of right edge
      expect(bottomDistance).toBeLessThan(20); // Should be within 20px of bottom edge
    }
  });
});