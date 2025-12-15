/**
 * Screenshot test for user feedback dialog
 * Verifies feedback dialog appears after creating enough nodes and captures user input
 */

import { test, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  waitForCytoscapeReady,
  sendGraphDelta,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils';
import type { GraphDelta, NodeDelta } from '@/pure/graph';

/**
 * Creates a batch of test nodes for triggering feedback dialog.
 * The feedback threshold is 40 deltas with new nodes.
 */
function createBatchGraphDelta(startIndex: number, count: number): GraphDelta {
  const nodes: NodeDelta[] = [];
  for (let i = 0; i < count; i++) {
    const index = startIndex + i;
    nodes.push({
      type: 'UpsertNode' as const,
      nodeToUpsert: {
        relativeFilePathIsID: `batch-node-${index}.md`,
        contentWithoutYamlOrLinks: `# Node ${index}\nContent for node ${index}.`,
        outgoingEdges: [],
        nodeUIMetadata: {
          color: { _tag: 'None' } as const,
          position: { _tag: 'Some', value: { x: 100 + index * 50, y: 100 + index * 30 } } as const,
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      },
      previousNode: { _tag: 'None' } as const
    });
  }
  return nodes;
}

test.describe('Feedback Dialog Screenshot', () => {
  test('should show feedback dialog after 40 graph delta applications and capture user input', async ({ page }) => {
    await setupMockElectronAPI(page);
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);

    // The feedback threshold is 40 delta applications (not 40 nodes)
    // Each sendGraphDelta call that creates at least 1 new node increments sessionDeltaCount
    for (let i = 0; i < 40; i++) {
      await sendGraphDelta(page, createBatchGraphDelta(i, 1));
      await page.waitForTimeout(30);
    }

    // Wait for the dialog to appear
    const dialog = page.locator('#feedback-dialog');
    await expect(dialog).toBeVisible({ timeout: 2000 });

    // Verify dialog content
    await expect(dialog.locator('h2')).toContainText('glad to see you are using this');
    await expect(dialog.locator('textarea')).toBeVisible();
    await expect(dialog.locator('#feedback-submit')).toBeVisible();
    await expect(dialog.locator('#feedback-cancel')).toBeVisible();

    // Take screenshot with dialog visible
    await page.screenshot({
      path: 'e2e-tests/screenshots/feedback-dialog.png'
    });

    // Enter feedback and submit
    await dialog.locator('#feedback-input').fill('This is test feedback from Playwright!');
    await dialog.locator('#feedback-submit').click();

    // Dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 1000 });

    // Verify nodes were created (40 nodes, one per delta)
    const nodeCount = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      return cy ? cy.nodes().length : 0;
    });
    expect(nodeCount).toBe(40);
  });

  test('should only show feedback dialog once per session', async ({ page }) => {
    await setupMockElectronAPI(page);
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);

    // Send 45 separate deltas (more than threshold of 40)
    for (let i = 0; i < 45; i++) {
      await sendGraphDelta(page, createBatchGraphDelta(i, 1));
      await page.waitForTimeout(30);
    }

    // Wait for dialog
    const dialog = page.locator('#feedback-dialog');
    await expect(dialog).toBeVisible({ timeout: 2000 });

    // Close by clicking cancel
    await dialog.locator('#feedback-cancel').click();
    await expect(dialog).not.toBeVisible({ timeout: 1000 });

    // Send more deltas - dialog should not reappear
    for (let i = 45; i < 50; i++) {
      await sendGraphDelta(page, createBatchGraphDelta(i, 1));
      await page.waitForTimeout(30);
    }

    // Dialog should not be visible again
    await page.waitForTimeout(500);
    await expect(dialog).not.toBeVisible();
  });

  test('should close dialog on backdrop click', async ({ page }) => {
    await setupMockElectronAPI(page);
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);

    // Trigger feedback dialog
    for (let i = 0; i < 40; i++) {
      await sendGraphDelta(page, createBatchGraphDelta(i, 1));
      await page.waitForTimeout(30);
    }

    // Wait for dialog
    const dialog = page.locator('#feedback-dialog');
    await expect(dialog).toBeVisible({ timeout: 2000 });

    // Click outside the dialog (on the backdrop)
    // The dialog's backdrop covers the viewport, clicking at (0,0) should hit it
    await page.mouse.click(5, 5);

    // Dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 1000 });
  });
});
