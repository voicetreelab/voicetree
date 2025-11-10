/**
 * Browser-based test for floating anchored markdown editor
 * Tests editor creation, content display, resize, drag, close/reopen
 */

import { test, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  sendGraphDelta,
  waitForCytoscapeReady,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils.ts';
import type { GraphDelta } from '@/functional_graph/pure/types.ts';

test.describe('Floating Anchored Editor (Browser)', () => {
  test('should create editor, show content, resize, drag, close and reopen', async ({ page }) => {
    console.log('\n=== Starting floating anchored editor test (Browser) ===');

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
    const testContent = '# Test Node\nThis is test content for the floating editor.';
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'test-editor-node.md',
          content: testContent,
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 400, y: 400 } } as const
          }
        }
      }
    ];
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(300);
    console.log('✓ Graph delta sent');

    console.log('=== Step 5: Open editor via tap event ===');
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#test-editor-node.md');
      if (node.length === 0) throw new Error('test-editor-node.md not found');
      node.trigger('tap');
    });
    await page.waitForTimeout(500);
    console.log('✓ Tap event triggered');

    console.log('=== Step 6: Verify editor window and content ===');
    const editorSelector = '#window-editor-test-editor-node\\.md';
    await page.waitForSelector(editorSelector, { timeout: 3000 });
    console.log('✓ Editor window appeared');

    await page.waitForSelector(`${editorSelector} .cm-content`, { timeout: 3000 });
    console.log('✓ CodeMirror rendered');

    const editorContent = await page.evaluate((selector) => {
      const cmContent = document.querySelector(`${selector} .cm-content`);
      return cmContent?.textContent || '';
    }, editorSelector);

    console.log(`  Editor content: "${editorContent}"`);
    expect(editorContent).toContain('Test Node');
    expect(editorContent).toContain('This is test content for the floating editor');
    console.log('✓ Content verified in editor');

    console.log('=== Step 7: Verify child shadow node exists and get dimensions ===');
    const initialDims = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      // The editor is now anchored to a child shadow node
      const childShadowNode = cy.$('#shadow-child-test-editor-node\\.md');
      if (childShadowNode.length === 0) throw new Error('Child shadow node not found');

      // Verify parent relationship
      const parentId = childShadowNode.data('parentId');
      if (parentId !== 'test-editor-node.md') {
        throw new Error(`Expected parentId to be 'test-editor-node.md', got '${parentId}'`);
      }

      return {
        width: childShadowNode.width(),
        height: childShadowNode.height(),
        parentId: parentId
      };
    });
    console.log(`  Child shadow node dims: ${initialDims.width}x${initialDims.height}`);
    console.log(`  Child shadow node parent: ${initialDims.parentId}`);
    expect(initialDims.width).toBeGreaterThan(0);
    expect(initialDims.height).toBeGreaterThan(0);
    expect(initialDims.parentId).toBe('test-editor-node.md');

    console.log('=== Step 8: Resize window smaller ===');
    const resizeHandle = await page.locator(`${editorSelector} .cy-floating-window-resize-handle`);
    const editorBox = await page.locator(editorSelector).boundingBox();
    if (!editorBox) throw new Error('Could not get editor bounding box');

    // Drag resize handle to make it smaller
    await resizeHandle.hover();
    await page.mouse.down();
    await page.mouse.move(editorBox.x + editorBox.width - 100, editorBox.y + editorBox.height - 100);
    await page.mouse.up();
    await page.waitForTimeout(300);
    console.log('✓ Resized smaller');

    const smallerDims = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const childShadowNode = cy.$('#shadow-child-test-editor-node\\.md');
      return {
        width: childShadowNode.width(),
        height: childShadowNode.height()
      };
    });
    console.log(`  Smaller shadow node dims: ${smallerDims.width}x${smallerDims.height}`);
    expect(smallerDims.width).toBeLessThan(initialDims.width);
    expect(smallerDims.height).toBeLessThan(initialDims.height);

    console.log('=== Step 9: Resize window bigger ===');
    await resizeHandle.hover();
    await page.mouse.down();
    const newBox = await page.locator(editorSelector).boundingBox();
    if (!newBox) throw new Error('Could not get editor bounding box');
    await page.mouse.move(newBox.x + newBox.width + 150, newBox.y + newBox.height + 150);
    await page.mouse.up();
    await page.waitForTimeout(300);
    console.log('✓ Resized bigger');

    const biggerDims = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const childShadowNode = cy.$('#shadow-child-test-editor-node\\.md');
      return {
        width: childShadowNode.width(),
        height: childShadowNode.height()
      };
    });
    console.log(`  Bigger shadow node dims: ${biggerDims.width}x${biggerDims.height}`);
    expect(biggerDims.width).toBeGreaterThan(smallerDims.width);
    expect(biggerDims.height).toBeGreaterThan(smallerDims.height);

    console.log('=== Step 10: Resize back to smaller ===');
    await resizeHandle.hover();
    await page.mouse.down();
    const bigBox = await page.locator(editorSelector).boundingBox();
    if (!bigBox) throw new Error('Could not get editor bounding box');
    await page.mouse.move(bigBox.x + bigBox.width - 100, bigBox.y + bigBox.height - 100);
    await page.mouse.up();
    await page.waitForTimeout(300);
    console.log('✓ Resized back to smaller');

    const finalSmallerDims = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const childShadowNode = cy.$('#shadow-child-test-editor-node\\.md');
      return {
        width: childShadowNode.width(),
        height: childShadowNode.height()
      };
    });
    console.log(`  Final smaller shadow node dims: ${finalSmallerDims.width}x${finalSmallerDims.height}`);
    expect(finalSmallerDims.width).toBeLessThan(biggerDims.width);
    expect(finalSmallerDims.height).toBeLessThan(biggerDims.height);

    console.log('=== Step 11: Drag anchor node and verify shadow follows ===');
    const initialNodePos = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#test-editor-node.md');
      return node.position();
    });
    console.log(`  Initial anchor node pos: (${initialNodePos.x}, ${initialNodePos.y})`);

    // Drag the anchor node
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#test-editor-node.md');
      node.position({ x: 600, y: 600 });
    });
    await page.waitForTimeout(300);
    console.log('✓ Dragged anchor node');

    const newNodePos = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#test-editor-node.md');
      return node.position();
    });
    console.log(`  New anchor node pos: (${newNodePos.x}, ${newNodePos.y})`);
    expect(newNodePos.x).toBe(600);
    expect(newNodePos.y).toBe(600);

    // Verify child shadow node also moved (it should be a child of the parent node)
    const childShadowNodePos = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const childShadowNode = cy.$('#shadow-child-test-editor-node\\.md');
      return childShadowNode.position();
    });
    console.log(`  Child shadow node pos: (${childShadowNodePos.x}, ${childShadowNodePos.y})`);
    // Child shadow should be near the parent node (with some offset)
    expect(Math.abs(childShadowNodePos.x - newNodePos.x)).toBeLessThan(500);
    expect(Math.abs(childShadowNodePos.y - newNodePos.y)).toBeLessThan(500);

    console.log('=== Step 12: Close editor and verify cleanup ===');
    const closeButton = await page.locator(`${editorSelector} .cy-floating-window-close`);
    await closeButton.click();
    await page.waitForTimeout(300);
    console.log('✓ Clicked close button');

    // Verify editor is gone
    const editorGone = await page.evaluate((selector) => {
      return document.querySelector(selector) === null;
    }, editorSelector);
    expect(editorGone).toBe(true);
    console.log('✓ Editor window closed');

    // Verify child shadow node is also removed
    const childShadowNodeRemoved = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const childShadowNode = cy.$('#shadow-child-test-editor-node\\.md');
      return childShadowNode.length === 0;
    });
    expect(childShadowNodeRemoved).toBe(true);
    console.log('✓ Child shadow node removed');

    console.log('=== Step 13: Reopen editor ===');
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#test-editor-node.md');
      node.trigger('tap');
    });
    await page.waitForTimeout(500);
    console.log('✓ Tap event triggered again');

    // Verify editor reopened
    await page.waitForSelector(editorSelector, { timeout: 3000 });
    console.log('✓ Editor window reopened');

    await page.waitForSelector(`${editorSelector} .cm-content`, { timeout: 3000 });
    const reopenedContent = await page.evaluate((selector) => {
      const cmContent = document.querySelector(`${selector} .cm-content`);
      return cmContent?.textContent || '';
    }, editorSelector);

    expect(reopenedContent).toContain('Test Node');
    expect(reopenedContent).toContain('This is test content for the floating editor');
    console.log('✓ Content verified in reopened editor');

    console.log('✓ Floating anchored editor test completed successfully');
  });
});
