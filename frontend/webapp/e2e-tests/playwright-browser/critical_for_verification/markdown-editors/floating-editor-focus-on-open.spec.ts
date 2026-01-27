/**
 * Browser-based test for floating editor focus on open
 *
 * BUG: When a floating editor is created, the CodeMirror editor should receive
 * focus immediately so the user can start typing without clicking.
 * Currently the focus is not set correctly, requiring a click to start typing.
 *
 * This test demonstrates the bug - it should FAIL until the issue is fixed.
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

test.describe('Floating Editor Focus On Open (Browser)', () => {
  test('should focus CodeMirror editor immediately when opening floating editor via tap', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting floating editor focus test ===');

    console.log('=== Step 1: Setup mock Electron API ===');
    await setupMockElectronAPI(page);
    console.log('✓ Electron API mock prepared');

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    console.log('✓ React rendered');

    await page.waitForTimeout(50);
    console.log('✓ Graph update handler registered');

    console.log('=== Step 3: Wait for Cytoscape ===');
    await waitForCytoscapeReady(page);
    console.log('✓ Cytoscape initialized');

    console.log('=== Step 4: Send graph delta with test node ===');
    const testContent = '# Focus Test Node\nThis is test content for focus verification.';
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'focus-test-node.md',
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
      const node = cy.$('#focus-test-node.md');
      if (node.length === 0) throw new Error('focus-test-node.md not found');
      node.trigger('tap');
    });
    await page.waitForTimeout(100); // Wait for editor to fully render
    console.log('✓ Tap event triggered');

    console.log('=== Step 6: Verify editor window appeared ===');
    const editorSelector = '#window-focus-test-node\\.md-editor';
    await page.waitForSelector(editorSelector, { timeout: 3000 });
    console.log('✓ Editor window appeared');

    await page.waitForSelector(`${editorSelector} .cm-content`, { timeout: 3000 });
    console.log('✓ CodeMirror rendered');

    console.log('=== Step 7: Verify CodeMirror editor has focus ===');
    // Check if the CodeMirror editor is focused
    // The .cm-focused class is added when the editor has focus
    const editorHasFocus = await page.evaluate((selector) => {
      const cmEditor = document.querySelector(`${selector} .cm-editor`);
      if (!cmEditor) return { hasFocusClass: false, activeElement: 'null' };

      const hasFocusClass = cmEditor.classList.contains('cm-focused');
      const activeElement = document.activeElement?.className ?? 'null';

      return { hasFocusClass, activeElement };
    }, editorSelector);

    console.log(`  Editor .cm-focused class: ${editorHasFocus.hasFocusClass}`);
    console.log(`  Active element class: ${editorHasFocus.activeElement}`);

    // This is the critical assertion - the editor should be focused immediately
    expect(editorHasFocus.hasFocusClass).toBe(true);

    console.log('=== Step 8: Verify we can type immediately without clicking ===');
    // Type some text - this should work if the editor is focused
    await page.keyboard.type('Hello');

    // Verify the text was typed into the editor
    const editorContent = await page.evaluate((selector) => {
      const cmContent = document.querySelector(`${selector} .cm-content`);
      return cmContent?.textContent ?? '';
    }, editorSelector);

    console.log(`  Editor content after typing: "${editorContent}"`);
    expect(editorContent).toContain('Hello');

    console.log('✓ Floating editor focus test completed successfully');
  });

  test('should allow immediate typing in newly opened editor without mouse click', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting immediate typing test ===');

    await setupMockElectronAPI(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);

    // Create a test node
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'typing-test-node.md',
          contentWithoutYamlOrLinks: '# Typing Test\nOriginal content.',
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

    // Open editor via tap
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#typing-test-node.md');
      if (node.length === 0) throw new Error('typing-test-node.md not found');
      node.trigger('tap');
    });

    const editorSelector = '#window-typing-test-node\\.md-editor';
    await page.waitForSelector(`${editorSelector} .cm-content`, { timeout: 3000 });
    await page.waitForTimeout(100); // Extra wait for focus to settle

    // Immediately try to type without clicking anywhere first
    // This simulates the user expectation: open editor, start typing
    await page.keyboard.type('TYPED_WITHOUT_CLICK');

    // Get the content and check if our typing appeared
    const contentAfterTyping = await page.evaluate((selector) => {
      const cmContent = document.querySelector(`${selector} .cm-content`);
      return cmContent?.textContent ?? '';
    }, editorSelector);

    console.log(`Content after immediate typing: "${contentAfterTyping}"`);

    // The typed text should appear in the editor
    // This will FAIL if the editor doesn't have focus automatically
    expect(contentAfterTyping).toContain('TYPED_WITHOUT_CLICK');

    console.log('✓ Immediate typing test completed');
  });
});
