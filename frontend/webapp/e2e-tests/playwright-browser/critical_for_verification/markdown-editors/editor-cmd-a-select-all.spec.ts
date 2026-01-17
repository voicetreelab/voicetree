/**
 * Browser-based test for Cmd+A select all in CodeMirror editor
 *
 * Tests that Cmd+A selects all text in an editor with multiple lines of content.
 * Verifies functionality by typing to replace selected content.
 */

import { test, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  sendGraphDelta,
  waitForCytoscapeReady,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils';
import type { GraphDelta } from '@/pure/graph';

test.describe('Editor Cmd+A Select All (Browser)', () => {
  test('Cmd+A should select all text in editor with multiple lines', async ({ page }) => {
    // Setup
    await setupMockElectronAPI(page);
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);

    // Create a test node with multi-line content
    const multiLineContent = `# Test Document

This is the first paragraph with some content.
It spans multiple lines to test selection.

## Section Two

- Bullet point one
- Bullet point two
- Bullet point three

## Section Three

Final paragraph of content here.`;

    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'cmd-a-test-node.md',
          contentWithoutYamlOrLinks: multiLineContent,
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 300, y: 300 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      }
    ];
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(30);

    // Open editor via tap event
    await page.evaluate((): void => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#cmd-a-test-node.md');
      if (node.length === 0) throw new Error('cmd-a-test-node.md not found');
      node.trigger('tap');
    });

    // Wait for editor to appear and be ready
    const editorSelector = '#window-cmd-a-test-node\\.md-editor';
    await page.waitForSelector(editorSelector, { timeout: 5000 });
    await page.waitForSelector(`${editorSelector} .cm-content`, { timeout: 3000 });
    await page.waitForTimeout(200);

    // Click in editor to focus it
    const editorContent = page.locator(`${editorSelector} .cm-content`);
    await editorContent.click();
    await page.waitForTimeout(100);

    // Verify editor is focused
    const editorFocused = await page.evaluate((selector): boolean => {
      const cmEditor = document.querySelector(`${selector} .cm-editor`);
      return cmEditor?.classList.contains('cm-focused') ?? false;
    }, editorSelector);
    expect(editorFocused).toBe(true);

    // Take screenshot before
    await page.screenshot({ path: 'e2e-tests/screenshots/cmd-a-before.png' });

    // Press Cmd+A to select all
    await page.keyboard.press('Meta+a');
    await page.waitForTimeout(200);

    // Take screenshot after
    await page.screenshot({ path: 'e2e-tests/screenshots/cmd-a-after.png' });

    // Verify selection covers all content using native selection API
    const selectionInfo = await page.evaluate((selector): {
      nativeSelectionLength: number;
      contentLength: number;
    } => {
      const cmContent = document.querySelector(`${selector} .cm-content`);
      const nativeSel = window.getSelection();
      return {
        nativeSelectionLength: nativeSel?.toString().length ?? 0,
        contentLength: cmContent?.textContent?.length ?? 0
      };
    }, editorSelector);

    // Selection should cover most of the content (allowing for minor whitespace differences)
    expect(selectionInfo.nativeSelectionLength).toBeGreaterThanOrEqual(selectionInfo.contentLength - 10);

    // Functional verification: type to replace all selected content
    await page.keyboard.type('REPLACED');
    await page.waitForTimeout(100);

    const contentAfterType = await page.evaluate((selector): string => {
      const cmContent = document.querySelector(`${selector} .cm-content`);
      return cmContent?.textContent ?? '';
    }, editorSelector);

    // If Cmd+A selected ALL text, typing "REPLACED" should have replaced everything
    expect(contentAfterType).toContain('REPLACED');
    expect(contentAfterType).not.toContain('Test Document');
    expect(contentAfterType).not.toContain('Section Two');
    expect(contentAfterType).not.toContain('Bullet point');
    expect(contentAfterType).not.toContain('Section Three');
  });
});
