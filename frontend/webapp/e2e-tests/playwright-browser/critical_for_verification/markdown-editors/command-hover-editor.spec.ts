/**
 * Browser-based test for hover markdown editor
 * Tests editor creation on hover, content display, click outside to close, and reopen
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

test.describe('Hover Editor (Browser)', () => {
  test('should show editor on hover, display content, close on click outside, and reopen', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting hover editor test (Browser) ===');

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
    const testContent = '# Hover Test\nThis content should appear on command+hover.';
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'hover-test-node.md',
          contentWithoutYamlOrLinks: testContent,
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 500, y: 500 } } as const,
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

    console.log('=== Step 5: Get node position for hover ===');
    const nodePosition = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#hover-test-node.md');
      if (node.length === 0) throw new Error('hover-test-node.md not found');
      return node.renderedPosition();
    });
    console.log(`  Node position: (${nodePosition.x}, ${nodePosition.y})`);

    console.log('=== Step 6: Trigger mouseover ===');
    // Trigger mouseover on the node
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#hover-test-node.md');
      if (node.length === 0) throw new Error('hover-test-node.md not found');
      node.emit('mouseover');
    });
    await page.waitForTimeout(50);
    console.log('✓ Mouseover triggered');

    console.log('=== Step 7: Verify hover editor appears with content ===');
    const hoverEditorSelector = '#window-hover-test-node\\.md-editor';
    await page.waitForSelector(hoverEditorSelector, { timeout: 3000 });
    console.log('✓ Hover editor window appeared');

    await page.waitForSelector(`${hoverEditorSelector} .cm-content`, { timeout: 3000 });
    console.log('✓ CodeMirror rendered in hover editor');

    const hoverContent = await page.evaluate((selector) => {
      const cmContent = document.querySelector(`${selector} .cm-content`);
      return cmContent?.textContent ?? '';
    }, hoverEditorSelector);

    console.log(`  Hover editor content: "${hoverContent}"`);
    expect(hoverContent).toContain('Hover Test');
    expect(hoverContent).toContain('This content should appear on command+hover');
    console.log('✓ Content verified in hover editor');

    console.log('=== Step 8: Click outside to close hover editor ===');
    // Wait for mousedown listener to be registered (100ms delay in FloatingWindowManager)
    await page.waitForTimeout(150);

    // Click somewhere outside the editor window
    await page.mouse.click(100, 100);
    console.log('✓ Clicked outside editor');

    // Wait for editor to be removed from DOM (use Playwright's built-in waiting)
    await page.waitForSelector(hoverEditorSelector, { state: 'detached', timeout: 500 });
    console.log('✓ Hover editor closed on click outside');

    console.log('=== Step 9: Reopen hover editor with hover ===');
    // Trigger mouseover again
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#hover-test-node.md');
      if (node.length === 0) throw new Error('hover-test-node.md not found');
      node.emit('mouseover');
    });
    await page.waitForTimeout(50);
    console.log('✓ Mouseover triggered again');

    // Verify editor reopened
    await page.waitForSelector(hoverEditorSelector, { timeout: 3000 });
    console.log('✓ Hover editor reopened');

    await page.waitForSelector(`${hoverEditorSelector} .cm-content`, { timeout: 3000 });
    const reopenedContent = await page.evaluate((selector) => {
      const cmContent = document.querySelector(`${selector} .cm-content`);
      return cmContent?.textContent ?? '';
    }, hoverEditorSelector);

    expect(reopenedContent).toContain('Hover Test');
    expect(reopenedContent).toContain('This content should appear on command+hover');
    console.log('✓ Content verified in reopened hover editor');

    console.log('✓ Hover editor test completed successfully');
  });

  test('should prevent duplicate editors: click+click, hover+hover, click+hover, hover+click', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Testing multiple editor prevention ===');

    // Setup
    await setupMockElectronAPI(page);
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);

    // Create two test nodes
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'node-a.md',
          contentWithoutYamlOrLinks: '# Node A\nContent for node A.',
          outgoingEdges: [],
          nodeUIMetadata: { color: { _tag: 'None' } as const, position: { _tag: 'Some', value: { x: 200, y: 200 } } as const, additionalYAMLProps: new Map(), isContextNode: false }
        },
        previousNode: { _tag: 'None' } as const
      },
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'node-b.md',
          contentWithoutYamlOrLinks: '# Node B\nContent for node B.',
          outgoingEdges: [],
          nodeUIMetadata: { color: { _tag: 'None' } as const, position: { _tag: 'Some', value: { x: 400, y: 200 } } as const, additionalYAMLProps: new Map(), isContextNode: false }
        },
        previousNode: { _tag: 'None' } as const
      }
    ];
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(50);

    const countEditors = async () => page.evaluate(() => document.querySelectorAll('[id^="window-"][id$="-editor"]').length);
    const nodeAEditorSelector = '#window-node-a\\.md-editor';
    const nodeBEditorSelector = '#window-node-b\\.md-editor';

    // === Test 1: Click + Click (same node) - second click should not create duplicate ===
    console.log('--- Test: Click + Click (same node) ---');
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance!;
      cy.$('#node-a.md').emit('tap');
    });
    await page.waitForSelector(nodeAEditorSelector, { timeout: 2000 });
    expect(await countEditors()).toBe(1);

    // Click same node again - should still be 1 editor
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance!;
      cy.$('#node-a.md').emit('tap');
    });
    await page.waitForTimeout(100);
    expect(await countEditors()).toBe(1);
    console.log('✓ Click+Click: No duplicate editor created');

    // Close editor for next test
    await page.evaluate((sel) => {
      document.querySelector(`${sel} .cy-floating-window-close`)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, nodeAEditorSelector);
    await page.waitForSelector(nodeAEditorSelector, { state: 'detached', timeout: 1000 });

    // === Test 2: Hover + Hover (different nodes) - should close first, open second ===
    console.log('--- Test: Hover + Hover (different nodes) ---');
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance!;
      cy.$('#node-a.md').emit('mouseover');
    });
    await page.waitForSelector(nodeAEditorSelector, { timeout: 2000 });
    expect(await countEditors()).toBe(1);

    // Hover on node B - should close A's hover editor and open B's
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance!;
      cy.$('#node-b.md').emit('mouseover');
    });
    await page.waitForSelector(nodeBEditorSelector, { timeout: 2000 });
    await page.waitForSelector(nodeAEditorSelector, { state: 'detached', timeout: 500 });
    expect(await countEditors()).toBe(1);
    console.log('✓ Hover+Hover: First closed, second opened, only 1 editor');

    // Close hover editor - wait for click-outside handler to be registered (100ms delay in FloatingWindowManager)
    await page.waitForTimeout(150);
    await page.mouse.click(50, 50);
    await page.waitForSelector(nodeBEditorSelector, { state: 'detached', timeout: 1000 });

    // === Test 3: Click + Hover (permanent then hover same node) - hover should be skipped ===
    console.log('--- Test: Click + Hover (permanent editor blocks hover) ---');
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance!;
      cy.$('#node-a.md').emit('tap');
    });
    await page.waitForSelector(nodeAEditorSelector, { timeout: 2000 });
    expect(await countEditors()).toBe(1);

    // Hover on same node - should NOT create duplicate (skipped because permanent exists)
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance!;
      cy.$('#node-a.md').emit('mouseover');
    });
    await page.waitForTimeout(100);
    expect(await countEditors()).toBe(1);
    console.log('✓ Click+Hover: Hover skipped for node with permanent editor');

    // Close permanent editor
    await page.evaluate((sel) => {
      document.querySelector(`${sel} .cy-floating-window-close`)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, nodeAEditorSelector);
    await page.waitForSelector(nodeAEditorSelector, { state: 'detached', timeout: 1000 });

    // === Test 4: Hover + Click (hover then click same node) - should convert to permanent ===
    console.log('--- Test: Hover + Click (hover then permanent on same node) ---');
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance!;
      cy.$('#node-a.md').emit('mouseover');
    });
    await page.waitForSelector(nodeAEditorSelector, { timeout: 2000 });
    expect(await countEditors()).toBe(1);

    // Click same node - hover editor already exists, click should not create duplicate
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance!;
      cy.$('#node-a.md').emit('tap');
    });
    await page.waitForTimeout(100);
    expect(await countEditors()).toBe(1);
    console.log('✓ Hover+Click: No duplicate, editor still exists');

    console.log('✓ All multiple editor prevention tests passed');
  });
});
