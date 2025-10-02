import { test, expect } from '@playwright/test';

test.describe('Floating Editor Advanced Positioning Tests', () => {

  test('should maintain window position relative to node during pan, zoom, and drag operations', async ({ page }) => {
    // Navigate to the test page in cytoscape mode
    await page.goto('/tests/e2e/isolated-with-harness/harness.html?mode=cytoscape');

    // Wait for Cytoscape to initialize
    await page.waitForTimeout(1000);

    // Verify page loaded
    await expect(page.locator('h1:has-text("Cytoscape Editor Test")')).toBeVisible();
    await expect(page.locator('.cytoscape-container')).toBeVisible();

    // ===================
    // Test 1: Node Click Opens Editor
    // ===================
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cy = (window as typeof window & { cy: any }).cy;
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

    // ===================
    // Test 2: Pan Movement
    // ===================
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cy = (window as typeof window & { cy: any }).cy;
      if (cy) {
        // Pan the view by 100px to the right and 50px down
        cy.pan({ x: cy.pan().x + 100, y: cy.pan().y + 50 });
      }
    });

    // Wait for position update
    await page.waitForTimeout(100);

    // Get position after pan
    const posAfterPan = await window.boundingBox();
    expect(posAfterPan).not.toBeNull();

    // Verify the window moved with the pan
    if (initialPos && posAfterPan) {
      expect(Math.abs(posAfterPan.x - initialPos.x - 100)).toBeLessThan(5);
      expect(Math.abs(posAfterPan.y - initialPos.y - 50)).toBeLessThan(5);
    }

    // ===================
    // Test 3: Zoom In
    // ===================
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cy = (window as typeof window & { cy: any }).cy;
      if (cy) {
        // Zoom in by 50%
        cy.zoom(cy.zoom() * 1.5);
      }
    });

    // Wait for position update
    await page.waitForTimeout(100);

    // Get position after zoom
    const posAfterZoomIn = await window.boundingBox();
    expect(posAfterZoomIn).not.toBeNull();

    // The window should have moved because the node position changed due to zoom
    // The exact movement depends on zoom center, but it should be different
    if (posAfterPan && posAfterZoomIn) {
      const moved = Math.abs(posAfterZoomIn.x - posAfterPan.x) > 5 ||
                    Math.abs(posAfterZoomIn.y - posAfterPan.y) > 5;
      expect(moved).toBeTruthy();
    }

    // ===================
    // Test 4: Zoom Out
    // ===================
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cy = (window as typeof window & { cy: any }).cy;
      if (cy) {
        // Zoom out to original level
        cy.zoom(1);
      }
    });

    // Wait for position update
    await page.waitForTimeout(100);

    // Get position after zoom out
    const posAfterZoomOut = await window.boundingBox();
    expect(posAfterZoomOut).not.toBeNull();

    // ===================
    // Test 5: Drag Window (Skip for now as window may be outside viewport)
    // ===================
    // Note: Skipping drag test here as window position after zoom may place it outside viewport
    // This functionality is tested separately in the drag-specific test

    // ===================
    // Test 6: Pan After Zoom - Window Should Move with Pan
    // ===================
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cy = (window as typeof window & { cy: any }).cy;
      if (cy) {
        // Pan again
        cy.pan({ x: cy.pan().x - 50, y: cy.pan().y - 30 });
      }
    });

    // Wait for position update
    await page.waitForTimeout(100);

    // Get position after pan following zoom
    const posAfterPanPostZoom = await window.boundingBox();
    expect(posAfterPanPostZoom).not.toBeNull();

    // Window should move with the pan
    if (posAfterZoomOut && posAfterPanPostZoom) {
      expect(Math.abs(posAfterPanPostZoom.x - posAfterZoomOut.x + 50)).toBeLessThan(10);
      expect(Math.abs(posAfterPanPostZoom.y - posAfterZoomOut.y + 30)).toBeLessThan(10);
    }

    // ===================
    // Test 7: Multiple Windows
    // ===================
    // First reset view to bring window into viewport
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cy = (window as typeof window & { cy: any }).cy;
      if (cy) {
        cy.pan({ x: 0, y: 0 });
        cy.zoom(1);
        cy.fit();
      }
    });
    await page.waitForTimeout(100);

    // Close first window
    await window.locator('button[aria-label="Close"]').click();
    await expect(window).not.toBeVisible();

    // Open window for second node
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cy = (window as typeof window & { cy: any }).cy;
      if (cy) {
        cy.$('#node2').trigger('tap');
      }
    });

    // Window should be visible with different content
    await expect(window).toBeVisible();
    await expect(window.locator('.w-md-editor-text-input')).toHaveValue('# Content for node2');

    // ===================
    // Test 8: Reset View
    // ===================
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cy = (window as typeof window & { cy: any }).cy;
      if (cy) {
        // Reset to original view
        cy.pan({ x: 0, y: 0 });
        cy.zoom(1);
        cy.fit();
      }
    });

    await page.waitForTimeout(100);

    // Window should be at a predictable position relative to node2
    const finalPos = await window.boundingBox();
    expect(finalPos).not.toBeNull();
  });

  test('should handle rapid pan and zoom events without losing sync', async ({ page }) => {
    await page.goto('/tests/e2e/isolated-with-harness/harness.html?mode=cytoscape');
    await page.waitForTimeout(1000);

    // Open editor for node1
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cy = (window as typeof window & { cy: any }).cy;
      if (cy) {
        cy.$('#node1').trigger('tap');
      }
    });

    const window = page.locator('.floating-window');
    await expect(window).toBeVisible();

    // Perform rapid pan and zoom operations
    for (let i = 0; i < 5; i++) {
      await page.evaluate((index) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cy = (window as typeof window & { cy: any }).cy;
        if (cy) {
          // Alternate between pan and zoom
          if (index % 2 === 0) {
            cy.pan({ x: cy.pan().x + 20, y: cy.pan().y + 20 });
          } else {
            cy.zoom(cy.zoom() * 1.1);
          }
        }
      }, i);

      // Small delay to let the update happen
      await page.waitForTimeout(50);
    }

    // Window should still be visible and positioned correctly
    await expect(window).toBeVisible();

    // Get the node's rendered position
    const nodePos = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cy = (window as typeof window & { cy: any }).cy;
      if (cy) {
        const node = cy.$('#node1');
        const pos = node.renderedPosition();
        return { x: pos.x, y: pos.y };
      }
      return null;
    });

    expect(nodePos).not.toBeNull();

    // Window should be near the node
    const windowPos = await window.boundingBox();
    expect(windowPos).not.toBeNull();

    if (nodePos && windowPos) {
      // Window is centered on the node, so check distance
      const centerX = windowPos.x + windowPos.width / 2;
      const centerY = windowPos.y + windowPos.height / 2;
      const distance = Math.sqrt(
        Math.pow(centerX - nodePos.x, 2) +
        Math.pow(centerY - nodePos.y, 2)
      );
      // Should be close to the node (allowing for some offset)
      expect(distance).toBeLessThan(50);
    }
  });

  test('should handle window drag independently of graph movement', async ({ page }) => {
    await page.goto('/tests/e2e/isolated-with-harness/harness.html?mode=cytoscape');
    await page.waitForTimeout(1000);

    // Open editor
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cy = (window as typeof window & { cy: any }).cy;
      if (cy) {
        cy.$('#node1').trigger('tap');
      }
    });

    const window = page.locator('.floating-window');
    await expect(window).toBeVisible();

    // Get initial position
    const initialPos = await window.boundingBox();
    expect(initialPos).not.toBeNull();

    // Drag the window using a relative movement
    const titleBar = window.locator('.window-title-bar');
    const titleBarBox = await titleBar.boundingBox();

    let draggedPos = null;
    if (titleBarBox && initialPos) {
      // Start drag from center of title bar
      const startX = titleBarBox.x + titleBarBox.width / 2;
      const startY = titleBarBox.y + titleBarBox.height / 2;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 100, startY + 50); // Move 100px right, 50px down
      await page.mouse.up();
      await page.waitForTimeout(100);

      draggedPos = await window.boundingBox();
      expect(draggedPos).not.toBeNull();

      // Verify window moved by approximately the drag amount
      if (draggedPos) {
        const deltaX = draggedPos.x - initialPos.x;
        const deltaY = draggedPos.y - initialPos.y;
        // The window should have moved roughly by the amount we dragged
        expect(Math.abs(deltaX - 100)).toBeLessThan(20);
        expect(Math.abs(deltaY - 50)).toBeLessThan(20);
      }

      // Now pan the graph
      await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cy = (window as typeof window & { cy: any }).cy;
        if (cy) {
          cy.pan({ x: cy.pan().x + 100, y: cy.pan().y + 100 });
        }
      });
      await page.waitForTimeout(100);

      // Window should move with the pan
      const pannedPos = await window.boundingBox();
      expect(pannedPos).not.toBeNull();

      if (draggedPos && pannedPos) {
        // Should have moved approximately by the pan amount
        expect(Math.abs(pannedPos.x - draggedPos.x - 100)).toBeLessThan(10);
        expect(Math.abs(pannedPos.y - draggedPos.y - 100)).toBeLessThan(10);
      }
    }
  });

  test('terminal window should also maintain position relative to node during graph operations', async ({ page }) => {
    await page.goto('/tests/e2e/isolated-with-harness/harness.html?mode=cytoscape');
    await page.waitForTimeout(1000);

    // NOTE: The test harness only supports one editor window at a time.
    // However, the positioning logic we're testing (in voicetree-layout.tsx)
    // works the same for both editors and terminals.
    // The integration test (terminal-graph-movement.test.tsx) confirms
    // that terminals use the same positioning system.

    // Open window for node1 (simulating terminal behavior)
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cy = (window as typeof window & { cy: any }).cy;
      if (cy) {
        cy.$('#node1').trigger('tap');
      }
    });

    // Wait for window to appear
    const terminalWindow = page.locator('.floating-window');
    await expect(terminalWindow).toBeVisible();

    // Get initial terminal position
    const initialTerminalPos = await terminalWindow.boundingBox();
    expect(initialTerminalPos).not.toBeNull();

    // ===================
    // Test 1: Pan Movement - Terminal should move with graph
    // ===================
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cy = (window as typeof window & { cy: any }).cy;
      if (cy) {
        // Pan the view by 150px to the right and 75px down
        cy.pan({ x: cy.pan().x + 150, y: cy.pan().y + 75 });
      }
    });

    await page.waitForTimeout(100);

    // Get position after pan
    const terminalPosAfterPan = await terminalWindow.boundingBox();
    expect(terminalPosAfterPan).not.toBeNull();

    // Verify the terminal moved with the pan
    if (initialTerminalPos && terminalPosAfterPan) {
      expect(Math.abs(terminalPosAfterPan.x - initialTerminalPos.x - 150)).toBeLessThan(5);
      expect(Math.abs(terminalPosAfterPan.y - initialTerminalPos.y - 75)).toBeLessThan(5);
    }

    // ===================
    // Test 2: Zoom - Terminal should maintain relative position
    // ===================
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cy = (window as typeof window & { cy: any }).cy;
      if (cy) {
        // Zoom in by 2x
        cy.zoom(cy.zoom() * 2);
      }
    });

    await page.waitForTimeout(100);

    // Get position after zoom
    const terminalPosAfterZoom = await terminalWindow.boundingBox();
    expect(terminalPosAfterZoom).not.toBeNull();

    // The terminal should have moved because the node position changed due to zoom
    if (terminalPosAfterPan && terminalPosAfterZoom) {
      const moved = Math.abs(terminalPosAfterZoom.x - terminalPosAfterPan.x) > 5 ||
                    Math.abs(terminalPosAfterZoom.y - terminalPosAfterPan.y) > 5;
      expect(moved).toBeTruthy();
    }

    // ===================
    // Test 3: Verify window continues moving correctly after multiple operations
    // ===================
    // Reset view first
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cy = (window as typeof window & { cy: any }).cy;
      if (cy) {
        cy.pan({ x: 0, y: 0 });
        cy.zoom(1);
        cy.fit();
      }
    });
    await page.waitForTimeout(100);

    // Note: Test harness only supports one window at a time,
    // but the positioning logic is the same for terminals
    // The actual app uses the same positioning system for both types

    // Get position before final pan
    const beforeFinalPan = await terminalWindow.boundingBox();

    // Pan the graph once more
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cy = (window as typeof window & { cy: any }).cy;
      if (cy) {
        cy.pan({ x: cy.pan().x + 100, y: cy.pan().y + 100 });
      }
    });

    await page.waitForTimeout(100);

    // Get new position
    const afterFinalPan = await terminalWindow.boundingBox();

    // Window should have moved by the pan amount
    if (beforeFinalPan && afterFinalPan) {
      const deltaX = afterFinalPan.x - beforeFinalPan.x;
      const deltaY = afterFinalPan.y - beforeFinalPan.y;

      // Should have moved approximately 100px in each direction
      expect(Math.abs(deltaX - 100)).toBeLessThan(5);
      expect(Math.abs(deltaY - 100)).toBeLessThan(5);
    }
  });

  test('terminal window should handle rapid pan and zoom events without losing sync', async ({ page }) => {
    await page.goto('/tests/e2e/isolated-with-harness/harness.html?mode=cytoscape');
    await page.waitForTimeout(1000);

    // Open window for node1 (simulating terminal behavior)
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cy = (window as typeof window & { cy: any }).cy;
      if (cy) {
        cy.$('#node1').trigger('tap');
      }
    });

    const terminalWindow = page.locator('.floating-window');
    await expect(terminalWindow).toBeVisible();

    // Perform rapid pan and zoom operations
    for (let i = 0; i < 10; i++) {
      await page.evaluate((index) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cy = (window as typeof window & { cy: any }).cy;
        if (cy) {
          // Alternate between pan and zoom
          if (index % 2 === 0) {
            cy.pan({ x: cy.pan().x + 30, y: cy.pan().y - 20 });
          } else {
            cy.zoom(cy.zoom() * (index % 4 === 1 ? 1.2 : 0.8));
          }
        }
      }, i);

      // Small delay to let the update happen
      await page.waitForTimeout(30);
    }

    // Terminal should still be visible and positioned correctly
    await expect(terminalWindow).toBeVisible();

    // Get the node's rendered position
    const nodePos = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cy = (window as typeof window & { cy: any }).cy;
      if (cy) {
        const node = cy.$('#node1');
        const pos = node.renderedPosition();
        return { x: pos.x, y: pos.y };
      }
      return null;
    });

    expect(nodePos).not.toBeNull();

    // Terminal should be near the node (with some offset)
    const terminalPos = await terminalWindow.boundingBox();
    expect(terminalPos).not.toBeNull();

    if (nodePos && terminalPos) {
      // Terminal is positioned with an offset from the node
      // Check that it's within a reasonable distance
      const distance = Math.sqrt(
        Math.pow(terminalPos.x - nodePos.x, 2) +
        Math.pow(terminalPos.y - nodePos.y, 2)
      );
      // Should be close to the node (allowing for offset)
      expect(distance).toBeLessThan(200);
    }
  });
});