/**
 * Browser-based test for floating editor auto-height feature
 * Tests that editors automatically adjust height based on content
 *
 * Bug context: Auto-height works correctly on initial editor open (new nodes),
 * but does NOT work consistently when content changes after the editor is open.
 * This test suite verifies both scenarios.
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

test.describe('Floating Editor Auto-Height (Browser)', () => {
  test('should auto-adjust editor height when content changes', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting editor auto-height test ===');

    console.log('=== Step 1: Setup mock Electron API ===');
    await setupMockElectronAPI(page);
    console.log('✓ Electron API mock prepared');

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    console.log('✓ React rendered');

    console.log('=== Step 2b: Select mock project ===');
    await selectMockProject(page);
    console.log('✓ Mock project selected');

    await page.waitForTimeout(50);

    console.log('=== Step 3: Wait for Cytoscape ===');
    await waitForCytoscapeReady(page);
    console.log('✓ Cytoscape initialized');

    console.log('=== Step 4: Send graph delta with minimal content node ===');
    // Create node with minimal content to start small
    const minimalContent = 'x';
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'auto-height-test.md',
          contentWithoutYamlOrLinks: minimalContent,
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 400, y: 300 } } as const,
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
      const node = cy.$('#auto-height-test.md');
      if (node.length === 0) throw new Error('auto-height-test.md not found');
      node.trigger('tap');
    });
    await page.waitForTimeout(100);
    console.log('✓ Tap event triggered');

    console.log('=== Step 6: Verify editor window appeared ===');
    const editorSelector = '#window-auto-height-test\\.md-editor';
    await page.waitForSelector(editorSelector, { timeout: 3000 });
    console.log('✓ Editor window appeared');

    await page.waitForSelector(`${editorSelector} .cm-content`, { timeout: 3000 });
    console.log('✓ CodeMirror rendered');

    // Wait for initial auto-height adjustment (requestAnimationFrame + render)
    await page.waitForTimeout(150);

    console.log('=== Step 7: Capture initial height and screenshot ===');
    const initialHeight = await page.evaluate((selector) => {
      const windowEl = document.querySelector(selector) as HTMLElement;
      return windowEl ? parseInt(windowEl.style.height || '0', 10) : 0;
    }, editorSelector);
    console.log(`  Initial editor height: ${initialHeight}px`);

    // Take screenshot of minimal content state
    await page.screenshot({
      path: 'e2e-tests/screenshots/editor-auto-height-minimal.png',
      fullPage: true
    });
    console.log('✓ Screenshot taken: editor-auto-height-minimal.png');

    console.log('=== Step 8: Type title and subtitle content ===');
    // Focus the editor and type content
    const cmEditor = page.locator(`${editorSelector} .cm-content`);
    await cmEditor.click();
    await page.waitForTimeout(50);

    // Clear existing content and type new multi-line content
    await page.keyboard.press('Meta+a');
    await page.keyboard.type('# My Title\n\n## Subtitle\n\nSome body text here.\n\nMore content on another line.\n\nAnd even more content.');

    // Wait for debounce (100ms) + extra time for render
    await page.waitForTimeout(250);
    console.log('✓ Content typed');

    console.log('=== Step 9: Capture new height and screenshot ===');
    const newHeight = await page.evaluate((selector) => {
      const windowEl = document.querySelector(selector) as HTMLElement;
      return windowEl ? parseInt(windowEl.style.height || '0', 10) : 0;
    }, editorSelector);
    console.log(`  New editor height: ${newHeight}px`);

    // Take screenshot of expanded content state
    await page.screenshot({
      path: 'e2e-tests/screenshots/editor-auto-height-expanded.png',
      fullPage: true
    });
    console.log('✓ Screenshot taken: editor-auto-height-expanded.png');

    console.log('=== Step 10: Verify height changed ===');
    // Initial should be at minimum (200px) since content was minimal
    expect(initialHeight).toBeGreaterThanOrEqual(200);
    expect(initialHeight).toBeLessThanOrEqual(400);

    // After adding content, height should have increased (or stayed at max if already maxed)
    expect(newHeight).toBeGreaterThanOrEqual(200);
    expect(newHeight).toBeLessThanOrEqual(400);

    // Height should have increased with more content
    console.log(`  Height change: ${initialHeight}px → ${newHeight}px`);
    expect(newHeight).toBeGreaterThanOrEqual(initialHeight);

    console.log('✓ Auto-height test completed successfully');
  });

  /**
   * This test reproduces a specific bug: editor height auto-resizing does not work
   * consistently after the editor is already open. It works on initial open but
   * adding new lines does not trigger height adjustment.
   *
   * The test opens an editor with multi-line content, then adds MORE lines via
   * pressing Enter repeatedly, and verifies that height increases accordingly.
   */
  test('should increase height when pressing Enter to add new lines (bug repro)', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting editor auto-height on Enter key test (bug repro) ===');

    await setupMockElectronAPI(page);
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await selectMockProject(page);
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);

    // Create node with some initial content (not minimal, to have a reasonable starting height)
    const initialContent = '# Title\n\nLine 1\nLine 2\nLine 3';
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'enter-height-test.md',
          contentWithoutYamlOrLinks: initialContent,
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 400, y: 300 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      }
    ];
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(30);

    // Open editor via tap
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#enter-height-test.md');
      if (node.length === 0) throw new Error('enter-height-test.md not found');
      node.trigger('tap');
    });

    const editorSelector = '#window-enter-height-test\\.md-editor';
    await page.waitForSelector(editorSelector, { timeout: 3000 });
    await page.waitForSelector(`${editorSelector} .cm-content`, { timeout: 3000 });

    // Wait for initial auto-height adjustment
    await page.waitForTimeout(200);

    // Capture initial height after editor opened with initial content
    const initialHeight = await page.evaluate((selector) => {
      const windowEl = document.querySelector(selector) as HTMLElement;
      return windowEl ? parseInt(windowEl.style.height || '0', 10) : 0;
    }, editorSelector);
    console.log(`  Initial editor height (with 5 lines): ${initialHeight}px`);

    // Take screenshot before adding lines
    await page.screenshot({
      path: 'e2e-tests/screenshots/editor-auto-height-before-enter.png',
      fullPage: true
    });

    // Focus editor and move cursor to end
    const cmEditor = page.locator(`${editorSelector} .cm-content`);
    await cmEditor.click();
    await page.keyboard.press('Meta+End'); // Go to end of document
    await page.waitForTimeout(50);

    // Press Enter multiple times to add new lines (this is where the bug manifests)
    const linesToAdd = 10;
    for (let i = 0; i < linesToAdd; i++) {
      await page.keyboard.press('Enter');
      await page.keyboard.type(`New line ${i + 1}`);
    }

    // Wait for geometry change event and height update
    await page.waitForTimeout(300);

    // Capture new height after adding lines
    const newHeight = await page.evaluate((selector) => {
      const windowEl = document.querySelector(selector) as HTMLElement;
      return windowEl ? parseInt(windowEl.style.height || '0', 10) : 0;
    }, editorSelector);
    console.log(`  New editor height (after adding ${linesToAdd} lines): ${newHeight}px`);

    // Take screenshot after adding lines
    await page.screenshot({
      path: 'e2e-tests/screenshots/editor-auto-height-after-enter.png',
      fullPage: true
    });

    // Also get the CodeMirror content height for debugging
    const contentHeight = await page.evaluate((selector) => {
      const cmScroller = document.querySelector(`${selector} .cm-scroller`) as HTMLElement;
      const cmContent = document.querySelector(`${selector} .cm-content`) as HTMLElement;
      return {
        scrollerHeight: cmScroller?.scrollHeight ?? 0,
        contentHeight: cmContent?.scrollHeight ?? 0,
        scrollerClientHeight: cmScroller?.clientHeight ?? 0,
      };
    }, editorSelector);
    console.log(`  CodeMirror scroller scrollHeight: ${contentHeight.scrollerHeight}px`);
    console.log(`  CodeMirror content scrollHeight: ${contentHeight.contentHeight}px`);
    console.log(`  CodeMirror scroller clientHeight: ${contentHeight.scrollerClientHeight}px`);

    // The bug: height should INCREASE when adding lines, but it stays the same
    // We're testing that height increased (this should fail if the bug exists)
    console.log(`  Height change: ${initialHeight}px → ${newHeight}px`);

    // STRICT ASSERTION: Height MUST increase after adding 10 lines
    // The threshold of 5px is used in the auto-height code, so we expect at least that much increase
    const heightIncrease = newHeight - initialHeight;
    console.log(`  Height increase: ${heightIncrease}px`);

    expect(heightIncrease).toBeGreaterThan(5);

    console.log('✓ Editor height increased correctly after adding lines');
  });
});
