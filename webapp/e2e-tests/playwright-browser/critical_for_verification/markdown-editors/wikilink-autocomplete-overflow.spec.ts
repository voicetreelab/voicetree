/**
 * Screenshot test for wikilink autocomplete overflow fix
 * Ensures autocomplete dropdown is visible even when cursor is at bottom of editor
 *
 * Bug: When cursor was near the end of a markdown file, the autocomplete dropdown
 * would be clipped by the editor's overflow:auto container.
 *
 * Fix: Added tooltips({ parent: document.body }) to render tooltips outside the
 * clipping container.
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  selectMockProject,
  sendGraphDelta,
  waitForCytoscapeReady,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils';
import type { GraphDelta } from '@/pure/graph';

// Custom fixture to capture console logs and only show on failure
type ConsoleCapture = {
  consoleLogs: string[];
  pageErrors: string[];
  testLogs: string[];
};

const test = base.extend<{ consoleCapture: ConsoleCapture }>({
  consoleCapture: async ({ page }, use, testInfo) => {
    const consoleLogs: string[] = [];
    const pageErrors: string[] = [];
    const testLogs: string[] = [];

    page.on('console', msg => {
      consoleLogs.push(`[Browser ${msg.type()}] ${msg.text()}`);
    });

    page.on('pageerror', error => {
      pageErrors.push(`[Browser Error] ${error.message}\n${error.stack ?? ''}`);
    });

    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      testLogs.push(args.map(arg => String(arg)).join(' '));
    };

    await use({ consoleLogs, pageErrors, testLogs });

    console.log = originalLog;

    if (testInfo.status !== 'passed') {
      console.log('\n=== Test Logs ===');
      testLogs.forEach(log => console.log(log));
      console.log('\n=== Browser Console Logs ===');
      consoleLogs.forEach(log => console.log(log));
      if (pageErrors.length > 0) {
        console.log('\n=== Browser Errors ===');
        pageErrors.forEach(err => console.log(err));
      }
    }
  }
});

test.describe('Wikilink Autocomplete Overflow Fix', () => {
  test('should show autocomplete dropdown when cursor is at bottom of editor', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting wikilink autocomplete overflow test ===');

    await setupMockElectronAPI(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);

    // Create nodes that will appear in autocomplete suggestions
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'target-node-1.md',
          contentWithoutYamlOrLinks: '# Target Node One\n\nFirst target node.',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 600, y: 100 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      },
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'target-node-2.md',
          contentWithoutYamlOrLinks: '# Target Node Two\n\nSecond target node.',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 600, y: 250 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      },
      // Main node with content that fills the editor, with cursor at bottom
      // The wikilink will be typed at the very end
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'test-editor.md',
          contentWithoutYamlOrLinks: `# Test Editor

This is a test to verify the autocomplete dropdown is visible when the cursor
is at the bottom of the editor content.

## Section 1

Some content here to fill space.

## Section 2

More content to ensure the editor has enough height.

## Section 3

Even more content.

## Section 4

Additional content to push the bottom further down.

## Section 5

Yet more content.

## Last Section

Type a wikilink here: `,
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 200, y: 200 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      }
    ];

    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(300);

    // Open editor via tap event on cytoscape node
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#test-editor.md');
      if (node.length === 0) throw new Error('test-editor.md not found');
      node.trigger('tap');
    });
    await page.waitForTimeout(500);

    // Wait for editor to appear
    const editorSelector = '#window-test-editor\\.md-editor';
    await page.waitForSelector(editorSelector, { timeout: 5000 });
    const cmContent = page.locator(`${editorSelector} .cm-content`);
    await cmContent.waitFor({ timeout: 3000 });

    // Click at the end of the editor content to position cursor
    await cmContent.click();
    await page.waitForTimeout(100);

    // Move cursor to end of document
    await page.keyboard.press('Meta+End'); // macOS: Cmd+End to go to end
    await page.waitForTimeout(100);

    // Type [[ to trigger autocomplete
    await page.keyboard.type('[[');
    await page.waitForTimeout(500);

    // The autocomplete tooltip should now be visible
    // It has class .cm-tooltip-autocomplete
    const autocompleteTooltip = page.locator('.cm-tooltip-autocomplete');

    // Take screenshot of the full page to see the autocomplete
    await page.screenshot({
      path: 'e2e-tests/screenshots/wikilink-autocomplete-overflow.png'
    });

    // Verify the autocomplete tooltip is visible
    await expect(autocompleteTooltip).toBeVisible({ timeout: 2000 });

    // Verify it contains our target nodes
    const tooltipText = await autocompleteTooltip.textContent();
    expect(tooltipText).toContain('Target Node');

    console.log('Screenshot saved to e2e-tests/screenshots/wikilink-autocomplete-overflow.png');
    console.log('Autocomplete tooltip is visible and contains expected options');
  });
});
