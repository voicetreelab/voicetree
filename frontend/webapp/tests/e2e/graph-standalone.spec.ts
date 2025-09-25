import { test, expect } from '@playwright/test';

test('standalone graph module renders markdown nodes', async ({ page }) => {
  // Navigate to standalone test page
  await page.goto('http://localhost:3001/graph-test.html');

  // Wait for canvas to appear
  await page.waitForSelector('#graph-container canvas', { timeout: 5000 });

  // Verify nodes are rendered
  const nodeCount = await page.evaluate(() => {
    return window.cy ? window.cy.nodes().length : 0;
  });
  expect(nodeCount).toBe(6); // 6 files in example_small

  // Verify edges exist
  const edgeCount = await page.evaluate(() => {
    return window.cy ? window.cy.edges().length : 0;
  });
  expect(edgeCount).toBeGreaterThan(0); // At least some edges from wikilinks

  // Verify nodes are positioned (not all at origin)
  const boundingBox = await page.evaluate(() => {
    if (!window.cy) return null;
    const bb = window.cy.elements().boundingBox();
    return { width: bb.w, height: bb.h };
  });
  expect(boundingBox.width).toBeGreaterThan(100);
  expect(boundingBox.height).toBeGreaterThan(100);

  // Take screenshot for visual confirmation
  await page.screenshot({ path: 'tests/screenshots/graph-standalone.png', fullPage: true });

  console.log(`✓ Graph rendered with ${nodeCount} nodes and ${edgeCount} edges`);
});