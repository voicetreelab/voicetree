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
} from '@e2e/playwright-browser/graph-delta-test-utils.ts';
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

    console.log('=== Step 3: Wait for Cytoscape ===');
    await waitForCytoscapeReady(page);
    console.log('✓ Cytoscape initialized');

    console.log('=== Step 4: Send graph delta with test node ===');
    const testContent = '# Test Node\nThis is test content for the floating editor.';
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'test-editor-node.md',
          contentWithoutYamlOrLinks: testContent,
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 400, y: 400 } } as const,
            additionalYAMLProps: {},
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

    console.log('=== Step 7: Verify editor is anchored to real node ===');
    const anchorInfo = await page.evaluate((selector) => {
      const windowEl = document.querySelector(selector) as HTMLElement | null;
      if (!windowEl) throw new Error('Editor window not found');
      const shadowNodeId = windowEl.dataset.shadowNodeId;
      return { shadowNodeId };
    }, editorSelector);
    console.log(`  Editor anchored to: ${anchorInfo.shadowNodeId}`);
    expect(anchorInfo.shadowNodeId).toBe('test-editor-node.md');

    console.log('=== Step 8: Verify window has resizable CSS class ===');
    const hasResizableClass = await page.evaluate((selector) => {
      const windowEl = document.querySelector(selector);
      return windowEl?.classList.contains('resizable') ?? false;
    }, editorSelector);
    expect(hasResizableClass).toBe(true);
    console.log('✓ Window is resizable via CSS');

    console.log('=== Step 9: Verify real node is hidden (anchored editor hides circle) ===');
    const nodeHidden = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#test-editor-node.md');
      const bgOpacity = node.style('background-opacity');
      return parseFloat(bgOpacity) === 0;
    });
    expect(nodeHidden).toBe(true);
    console.log('✓ Real node circle is hidden (opacity 0)');

    console.log('=== Step 10: Close editor and verify cleanup ===');
    // Close the editor by clicking the close button via DOM (avoids viewport issues)
    await page.evaluate((selector) => {
      const closeBtn = document.querySelector(`${selector} .traffic-light-close`) as HTMLButtonElement;
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

    // Verify real node circle is restored (opacity back to 1)
    const nodeRestored = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#test-editor-node.md');
      const bgOpacity = node.style('background-opacity');
      return parseFloat(bgOpacity) === 1;
    });
    expect(nodeRestored).toBe(true);
    console.log('✓ Real node circle restored');

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
