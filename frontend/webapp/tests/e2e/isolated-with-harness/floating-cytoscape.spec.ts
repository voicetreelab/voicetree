import { test, expect } from '@playwright/test';

test.describe('Floating Editor in Cytoscape', () => {

  test('should open editor on node click and move with pan', async ({ page }) => {
    // Navigate to the test page in cytoscape mode
    await page.goto('/tests/e2e/isolated-with-harness/harness.html?mode=cytoscape');

    // Wait for Cytoscape to initialize
    await page.waitForTimeout(1000);

    // Verify page loaded
    await expect(page.locator('h1:has-text("Cytoscape Editor Test")')).toBeVisible();
    await expect(page.locator('.cytoscape-container')).toBeVisible();

    // Click on the first node to open editor
    await page.evaluate(() => {
      const cy = (window as typeof window & { cy: unknown }).cy;
      if (cy) {
        // Trigger tap event on node1
        cy.$('#node1').trigger('tap');
      }
    });

    // Verify floating window appears
    const window = page.locator('.floating-window');
    await expect(window).toBeVisible();
    await expect(window.locator('.window-title-bar')).toContainText('Node Editor');
    await expect(window.locator('.w-md-editor-text-input')).toHaveValue('# Content for node1');

    // Get initial position
    const initialPos = await window.boundingBox();
    expect(initialPos).not.toBeNull();

    // Pan the cytoscape canvas
    await page.evaluate(() => {
      const cy = (window as typeof window & { cy: unknown }).cy;
      if (cy) {
        // Pan the view by 100px to the right and 50px down
        cy.pan({ x: cy.pan().x + 100, y: cy.pan().y + 50 });
      }
    });

    // Wait for position update
    await page.waitForTimeout(100);

    // Get new position
    const newPos = await window.boundingBox();
    expect(newPos).not.toBeNull();

    // Verify the window moved with the pan
    if (initialPos && newPos) {
      expect(Math.abs(newPos.x - initialPos.x - 100)).toBeLessThan(5);
      expect(Math.abs(newPos.y - initialPos.y - 50)).toBeLessThan(5);
    }

    // Test editing content
    const editorInput = window.locator('.w-md-editor-text-input');
    await editorInput.fill('# Updated Content');
    await expect(editorInput).toHaveValue('# Updated Content');

    // Test save
    await window.locator('button:has-text("Save")').click();

    // Verify save was called
    await expect.poll(async () => {
      return page.evaluate(() => (window as typeof window & { _test_savedPayload?: unknown })._test_savedPayload);
    }).toEqual({
      filePath: 'test/node.md',
      content: '# Updated Content'
    });

    // Test close button
    await window.locator('button[aria-label="Close"]').click();
    await expect(window).not.toBeVisible();

    // Click another node
    await page.evaluate(() => {
      const cy = (window as typeof window & { cy: unknown }).cy;
      if (cy) {
        cy.$('#node2').trigger('tap');
      }
    });

    // Verify new editor opens with different content
    await expect(window).toBeVisible();
    await expect(window.locator('.w-md-editor-text-input')).toHaveValue('# Content for node2');
  });
});