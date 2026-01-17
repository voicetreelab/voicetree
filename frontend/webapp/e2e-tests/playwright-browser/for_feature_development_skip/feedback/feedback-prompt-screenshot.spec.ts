/**
 * Screenshot test for user feedback dialog
 * Verifies feedback dialog appears after creating enough nodes and captures screenshot
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
 * The feedback threshold is 30 deltas with new nodes.
 */
function createBatchGraphDelta(startIndex: number, count: number): GraphDelta {
  const nodes: NodeDelta[] = [];
  for (let i = 0; i < count; i++) {
    const index = startIndex + i;
    nodes.push({
      type: 'UpsertNode' as const,
      nodeToUpsert: {
        absoluteFilePathIsID: `batch-node-${index}.md`,
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
  test('should show centered feedback dialog and capture screenshot', async ({ page }) => {
    await setupMockElectronAPI(page);
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);

    // Trigger feedback dialog (threshold is 30 deltas)
    for (let i = 0; i < 35; i++) {
      await sendGraphDelta(page, createBatchGraphDelta(i, 1));
      await page.waitForTimeout(30);
    }

    // Wait for dialog to appear
    const dialog = page.locator('#feedback-dialog');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Verify dialog has basic elements (textarea and submit)
    await expect(dialog.locator('textarea')).toBeVisible();
    await expect(dialog.locator('button[type="submit"]')).toBeVisible();

    // Take screenshot with dialog visible - this is the main verification
    await page.screenshot({
      path: 'e2e-tests/screenshots/feedback-dialog.png'
    });

    // Submit feedback to close dialog
    await dialog.locator('textarea').fill('Test feedback');
    await dialog.locator('button[type="submit"]').click();

    // Dialog should close after submit
    await expect(dialog).not.toBeVisible({ timeout: 2000 });
  });

  test('should only show feedback dialog once per session', async ({ page }) => {
    await setupMockElectronAPI(page);
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);

    // Trigger feedback dialog
    for (let i = 0; i < 35; i++) {
      await sendGraphDelta(page, createBatchGraphDelta(i, 1));
      await page.waitForTimeout(30);
    }

    // Wait for dialog
    const dialog = page.locator('#feedback-dialog');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Submit to close
    await dialog.locator('textarea').fill('Test');
    await dialog.locator('button[type="submit"]').click();
    await expect(dialog).not.toBeVisible({ timeout: 2000 });

    // Send more deltas - dialog should not reappear
    for (let i = 35; i < 45; i++) {
      await sendGraphDelta(page, createBatchGraphDelta(i, 1));
      await page.waitForTimeout(30);
    }

    // Dialog should not be visible again
    await page.waitForTimeout(500);
    await expect(dialog).not.toBeVisible();
  });
});
