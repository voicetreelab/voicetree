import { test, expect } from '@playwright/test';

test('standalone graph module renders markdown nodes', async ({ page }) => {
  // Navigate to standalone test page
  await page.goto('/graph-test.html');

  // Wait for canvas to appear
  await page.waitForSelector('#graph-container canvas', { timeout: 5000 });

  // Verify nodes are rendered
  const nodeCount = await page.evaluate(() => {
    return window.cy ? window.cy.nodes().length : 0;
  });
  expect(nodeCount).toBe(6); // 6 files in example_small

  // Verify edges exist with relationship labels
  const edgeData = await page.evaluate(() => {
    if (!window.cy) return { count: 0, labels: [] };
    const edges = window.cy.edges();
    const labels = edges.map(edge => edge.data('label')).filter(Boolean);
    return {
      count: edges.length,
      labels: labels
    };
  });

  expect(edgeData.count).toBeGreaterThan(0); // At least some edges from wikilinks
  expect(edgeData.labels.length).toBeGreaterThan(0); // At least some edges have relationship labels

  // Verify specific relationship types are displayed
  const expectedRelationships = [
    'is_a_bug_identified_during',
    'is_the_immediate_outcome_of',
    'is_an_immediate_observation_during'
  ];

  const hasExpectedRelationships = expectedRelationships.some(rel =>
    edgeData.labels.some(label => label.includes(rel))
  );
  expect(hasExpectedRelationships).toBe(true);

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

  console.log(`✓ Graph rendered with ${nodeCount} nodes and ${edgeData.count} edges`);
  console.log(`✓ Relationship labels found: ${edgeData.labels.join(', ')}`);
});