/**
 * Browser-based test for command-hover markdown editor
 * Tests editor creation on Cmd+hover, content display, click outside to close, and reopen
 */

import { test, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  sendGraphDelta,
  waitForCytoscapeReady,
  type ExtendedWindow
} from '@test/playwright-browser/graph-delta-test-utils.ts';
import type { GraphDelta } from '@/functional/pure/graph/types.ts';

test.describe('Command Hover Editor (Browser)', () => {
  test('should show editor on Cmd+hover, display content, close on click outside, and reopen', async ({ page }) => {
    console.log('\n=== Starting command hover editor test (Browser) ===');

    // Listen for console messages
    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      console.log(`[Browser ${type}] ${text}`);
    });

    page.on('pageerror', error => {
      console.error('[Browser Error]', error.message);
      console.error(error.stack);
    });

    console.log('=== Step 1: Setup mock Electron API ===');
    await setupMockElectronAPI(page);
    console.log('✓ Electron API mock prepared');

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    console.log('✓ React rendered');

    await page.waitForTimeout(500);
    console.log('✓ Graph update handler registered');

    console.log('=== Step 3: Wait for Cytoscape ===');
    await waitForCytoscapeReady(page);
    console.log('✓ Cytoscape initialized');

    console.log('=== Step 4: Send graph delta with test node ===');
    const testContent = '# Hover Test\nThis content should appear on command+hover.';
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'hover-test-node.md',
          content: testContent,
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 500, y: 500 } } as const
          }
        }
      }
    ];
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(300);
    console.log('✓ Graph delta sent');

    console.log('=== Step 5: Get node position for hover ===');
    const nodePosition = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#hover-test-node.md');
      if (node.length === 0) throw new Error('hover-test-node.md not found');
      return node.renderedPosition();
    });
    console.log(`  Node position: (${nodePosition.x}, ${nodePosition.y})`);

    console.log('=== Step 6: Hold Meta key and trigger mouseover ===');
    // Simulate Meta key press
    await page.keyboard.down('Meta');
    await page.waitForTimeout(100);

    // Trigger mouseover on the node
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#hover-test-node.md');
      if (node.length === 0) throw new Error('hover-test-node.md not found');
      node.emit('mouseover');
    });
    await page.waitForTimeout(500);
    console.log('✓ Mouseover with Meta key triggered');

    console.log('=== Step 7: Verify hover editor appears with content ===');
    const hoverEditorSelector = '#window-editor-hover-test-node\\.md';
    await page.waitForSelector(hoverEditorSelector, { timeout: 3000 });
    console.log('✓ Hover editor window appeared');

    await page.waitForSelector(`${hoverEditorSelector} .cm-content`, { timeout: 3000 });
    console.log('✓ CodeMirror rendered in hover editor');

    const hoverContent = await page.evaluate((selector) => {
      const cmContent = document.querySelector(`${selector} .cm-content`);
      return cmContent?.textContent || '';
    }, hoverEditorSelector);

    console.log(`  Hover editor content: "${hoverContent}"`);
    expect(hoverContent).toContain('Hover Test');
    expect(hoverContent).toContain('This content should appear on command+hover');
    console.log('✓ Content verified in hover editor');

    // Release Meta key
    await page.keyboard.up('Meta');
    await page.waitForTimeout(100);
    console.log('✓ Meta key released');

    console.log('=== Step 8: Click outside to close hover editor ===');
    // Click somewhere outside the editor window
    await page.mouse.click(100, 100);
    await page.waitForTimeout(300);
    console.log('✓ Clicked outside editor');

    // Verify editor is gone
    const editorGone = await page.evaluate((selector) => {
      return document.querySelector(selector) === null;
    }, hoverEditorSelector);
    expect(editorGone).toBe(true);
    console.log('✓ Hover editor closed on click outside');

    console.log('=== Step 9: Reopen hover editor with Cmd+hover ===');
    // Hold Meta key again
    await page.keyboard.down('Meta');
    await page.waitForTimeout(100);

    // Trigger mouseover again
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#hover-test-node.md');
      if (node.length === 0) throw new Error('hover-test-node.md not found');
      node.emit('mouseover');
    });
    await page.waitForTimeout(500);
    console.log('✓ Mouseover with Meta key triggered again');

    // Verify editor reopened
    await page.waitForSelector(hoverEditorSelector, { timeout: 3000 });
    console.log('✓ Hover editor reopened');

    await page.waitForSelector(`${hoverEditorSelector} .cm-content`, { timeout: 3000 });
    const reopenedContent = await page.evaluate((selector) => {
      const cmContent = document.querySelector(`${selector} .cm-content`);
      return cmContent?.textContent || '';
    }, hoverEditorSelector);

    expect(reopenedContent).toContain('Hover Test');
    expect(reopenedContent).toContain('This content should appear on command+hover');
    console.log('✓ Content verified in reopened hover editor');

    // Release Meta key
    await page.keyboard.up('Meta');

    console.log('✓ Command hover editor test completed successfully');
  });
});
