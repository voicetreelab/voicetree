import { test, expect } from '@playwright/test';

test.describe('Browser Positioning Fix Verification', () => {
  test('floating window should move with graph pan in browser', async ({ page }) => {
    // Go directly to the dev server
    await page.goto('http://localhost:3001');

    // Wait for the app to load
    await page.waitForTimeout(1000);

    // Load example files
    const loadButton = page.locator('button:has-text("Load Example Files")');
    await loadButton.click();

    // Wait for graph to be populated
    await page.waitForTimeout(2000);

    // Find and click on a node to open editor
    await page.evaluate(() => {
      // Access cytoscape instance directly
      const cy = (window as any).cy;
      if (cy) {
        // Get the first node and trigger tap
        const firstNode = cy.nodes().first();
        if (firstNode.length > 0) {
          firstNode.trigger('tap');
          console.log('Tapped node:', firstNode.id());
        }
      }
    });

    // Wait for floating window to appear
    const floatingWindow = page.locator('.floating-window').first();
    await expect(floatingWindow).toBeVisible({ timeout: 5000 });

    // Get initial position
    const initialPos = await floatingWindow.boundingBox();
    expect(initialPos).not.toBeNull();
    console.log('Initial window position:', initialPos);

    // Pan the graph
    await page.evaluate(() => {
      const cy = (window as any).cy;
      if (cy) {
        const currentPan = cy.pan();
        console.log('Current pan:', currentPan);
        // Pan 100px right, 50px down
        cy.pan({ x: currentPan.x + 100, y: currentPan.y + 50 });
        console.log('New pan:', cy.pan());
      }
    });

    // Wait for position update
    await page.waitForTimeout(200);

    // Get new position
    const newPos = await floatingWindow.boundingBox();
    expect(newPos).not.toBeNull();
    console.log('New window position after pan:', newPos);

    // Verify the window moved with the pan
    if (initialPos && newPos) {
      const deltaX = newPos.x - initialPos.x;
      const deltaY = newPos.y - initialPos.y;

      console.log(`Window moved: ${deltaX}px horizontal, ${deltaY}px vertical`);

      // The window should have moved approximately by the pan amount
      expect(Math.abs(deltaX - 100)).toBeLessThan(10);
      expect(Math.abs(deltaY - 50)).toBeLessThan(10);
    }

    // Test zoom
    await page.evaluate(() => {
      const cy = (window as any).cy;
      if (cy) {
        // Zoom in
        cy.zoom(cy.zoom() * 1.5);
        console.log('Zoomed to:', cy.zoom());
      }
    });

    await page.waitForTimeout(200);

    // Window should still be visible (position will change based on zoom center)
    await expect(floatingWindow).toBeVisible();

    // Reset zoom
    await page.evaluate(() => {
      const cy = (window as any).cy;
      if (cy) {
        cy.zoom(1);
        cy.fit();
      }
    });

    await page.waitForTimeout(200);

    // Test dragging the window
    const titleBar = floatingWindow.locator('.window-title-bar');
    const titleBarBox = await titleBar.boundingBox();

    if (titleBarBox) {
      const startX = titleBarBox.x + titleBarBox.width / 2;
      const startY = titleBarBox.y + titleBarBox.height / 2;

      // Drag the window
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 50, startY + 30);
      await page.mouse.up();

      await page.waitForTimeout(200);

      const draggedPos = await floatingWindow.boundingBox();
      console.log('Position after drag:', draggedPos);

      // Now pan again to verify it still follows
      await page.evaluate(() => {
        const cy = (window as any).cy;
        if (cy) {
          const currentPan = cy.pan();
          cy.pan({ x: currentPan.x - 50, y: currentPan.y - 30 });
        }
      });

      await page.waitForTimeout(200);

      const finalPos = await floatingWindow.boundingBox();
      if (draggedPos && finalPos) {
        // Should move with the pan
        expect(Math.abs(finalPos.x - draggedPos.x + 50)).toBeLessThan(10);
        expect(Math.abs(finalPos.y - draggedPos.y + 30)).toBeLessThan(10);
      }
    }
  });
});