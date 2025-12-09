/**
 * Browser-based test for floating anchored markdown editor
 * Tests editor creation with child shadow node, content display, anchoring behavior, close/reopen
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
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

    // Capture browser console
    page.on('console', msg => {
      consoleLogs.push(`[Browser ${msg.type()}] ${msg.text()}`);
    });

    page.on('pageerror', error => {
      pageErrors.push(`[Browser Error] ${error.message}\n${error.stack ?? ''}`);
    });

    // Capture test's own console.log
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      testLogs.push(args.map(arg => String(arg)).join(' '));
    };

    await use({ consoleLogs, pageErrors, testLogs });

    // Restore original console.log
    console.log = originalLog;

    // After test completes, check if it failed and print logs
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

test.describe('Floating Anchored Editor (Browser)', () => {
  test('should create editor anchored to child shadow node, show content, follow parent node, and cleanup on close', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting floating anchored editor test (Browser) ===');

    console.log('=== Step 1: Setup mock Electron API ===');
    await setupMockElectronAPI(page);
    console.log('✓ Electron API mock prepared');

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    console.log('✓ React rendered');

    await page.waitForTimeout(50);
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
          contentWithoutYamlOrLinks: testContent,
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 400, y: 400 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      }
    ];
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(30);
    console.log('✓ Graph delta sent');

    console.log('=== Step 5: Open editor via tap event ===');
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#test-editor-node.md');
      if (node.length === 0) throw new Error('test-editor-node.md not found');
      node.trigger('tap');
    });
    await page.waitForTimeout(50);
    console.log('✓ Tap event triggered');

    console.log('=== Step 6: Verify editor window and content ===');
    const editorSelector = '#window-test-editor-node\\.md-editor';
    await page.waitForSelector(editorSelector, { timeout: 3000 });
    console.log('✓ Editor window appeared');

    await page.waitForSelector(`${editorSelector} .cm-content`, { timeout: 3000 });
    console.log('✓ CodeMirror rendered');

    const editorContent = await page.evaluate((selector) => {
      const cmContent = document.querySelector(`${selector} .cm-content`);
      return cmContent?.textContent ?? '';
    }, editorSelector);

    console.log(`  Editor content: "${editorContent}"`);
    expect(editorContent).toContain('Test Node');
    expect(editorContent).toContain('This is test content for the floating editor');
    console.log('✓ Content verified in editor');

    // Verify heading1 has smaller font size (24px instead of default 32px)
    const headingFontSize = await page.evaluate((selector) => {
      const cmContent = document.querySelector(`${selector} .cm-content`);
      if (!cmContent) return null;
      // Find the span containing the heading text (after the # mark)
      const spans = cmContent.querySelectorAll('.cm-line span');
      for (const span of spans) {
        if (span.textContent?.includes('Test Node')) {
          return window.getComputedStyle(span).fontSize;
        }
      }
      return null;
    }, editorSelector);
    console.log(`  Heading1 font-size: ${headingFontSize}`);
    expect(headingFontSize).toBe('24px');

    console.log('=== Step 7: Verify child shadow node exists and get dimensions ===');
    const initialDims = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      // The editor is now anchored to a shadow node
      // Shadow node ID format: {nodeId}-editor-anchor-shadowNode
      // For nodeId 'test-editor-node.md', editorId is 'test-editor-node.md-editor'
      // So shadow node ID is 'test-editor-node.md-editor-anchor-shadowNode'
      const childShadowNode = cy.$('#test-editor-node\\.md-editor-anchor-shadowNode');
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

    console.log('=== Step 8: Verify window has resizable CSS class ===');
    const hasResizableClass = await page.evaluate((selector) => {
      const windowEl = document.querySelector(selector);
      return windowEl?.classList.contains('resizable') ?? false;
    }, editorSelector);
    expect(hasResizableClass).toBe(true);
    console.log('✓ Window is resizable via CSS');

    console.log('=== Step 9: Drag parent node and verify child shadow follows ===');
    const initialNodePos = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#test-editor-node.md');
      return node.position();
    });
    console.log(`  Initial anchor node pos: (${initialNodePos.x}, ${initialNodePos.y})`);

    // Drag the anchor node (Cola layout may adjust the position)
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#test-editor-node.md');
      node.position({ x: 600, y: 600 });
    });
    await page.waitForTimeout(50); // Wait for layout to settle
    console.log('✓ Dragged anchor node');

    const newNodePos = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#test-editor-node.md');
      return node.position();
    });
    console.log(`  New anchor node pos: (${newNodePos.x}, ${newNodePos.y})`);
    // Check that position moved significantly (Cola layout may adjust exact position)
    const xMoved = Math.abs(newNodePos.x - initialNodePos.x) > 10;
    const yMoved = Math.abs(newNodePos.y - initialNodePos.y) > 5;
    expect(xMoved || yMoved).toBe(true);

    // Verify child shadow node also moved (it should be a child of the parent node)
    const childShadowNodePos = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const childShadowNode = cy.$('#test-editor-node\\.md-editor-anchor-shadowNode');
      return childShadowNode.position();
    });
    console.log(`  Child shadow node pos: (${childShadowNodePos.x}, ${childShadowNodePos.y})`);
    // Child shadow should be near the parent node (with some offset)
    expect(Math.abs(childShadowNodePos.x - newNodePos.x)).toBeLessThan(500);
    expect(Math.abs(childShadowNodePos.y - newNodePos.y)).toBeLessThan(500);

    console.log('=== Step 10: Close editor and verify cleanup ===');
    // Close the editor by clicking the close button via DOM (avoids viewport issues)
    await page.evaluate((selector) => {
      const closeBtn = document.querySelector(`${selector} .cy-floating-window-close`) as HTMLButtonElement;
      if (closeBtn) closeBtn.click();
    }, editorSelector);
    await page.waitForTimeout(30);
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
      const childShadowNode = cy.$('#test-editor-node\\.md-editor-anchor-shadowNode');
      return childShadowNode.length === 0;
    });
    expect(childShadowNodeRemoved).toBe(true);
    console.log('✓ Child shadow node removed');

    console.log('=== Step 11: Reopen editor ===');
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#test-editor-node.md');
      node.trigger('tap');
    });
    await page.waitForTimeout(50);
    console.log('✓ Tap event triggered again');

    // Verify editor reopened
    await page.waitForSelector(editorSelector, { timeout: 3000 });
    console.log('✓ Editor window reopened');

    await page.waitForSelector(`${editorSelector} .cm-content`, { timeout: 3000 });
    const reopenedContent = await page.evaluate((selector) => {
      const cmContent = document.querySelector(`${selector} .cm-content`);
      return cmContent?.textContent ?? '';
    }, editorSelector);

    expect(reopenedContent).toContain('Test Node');
    expect(reopenedContent).toContain('This is test content for the floating editor');
    console.log('✓ Content verified in reopened editor');

    console.log('✓ Floating anchored editor test completed successfully');
  });
});
