/**
 * Browser-based test for Cmd+Enter hotkey in hover editor
 * Tests that clicking inside an editor selects the node,
 * enabling Cmd+Enter to run a terminal for that node
 */

import { test, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  sendGraphDelta,
  waitForCytoscapeReady,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils.ts';
import type { GraphDelta } from '@/pure/graph';

test.describe('Editor Cmd+Enter Hotkey (Browser)', () => {
  test('clicking inside editor selects node, enabling Cmd+Enter to run terminal', async ({ page }) => {
    console.log('\n=== Starting Editor Cmd+Enter test (Browser) ===');

    console.log('=== Step 1: Setup mock Electron API ===');
    await setupMockElectronAPI(page);
    console.log('✓ Electron API mock prepared');

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    console.log('✓ React rendered');

    await page.waitForTimeout(50);

    console.log('=== Step 3: Wait for Cytoscape ready ===');
    await waitForCytoscapeReady(page);
    console.log('✓ Cytoscape ready');

    console.log('=== Step 4: Send graph delta with test node ===');
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'test-node-1.md',
          contentWithoutYamlOrLinks: 'Test content\n\nPress Cmd+Enter to run terminal',
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
    console.log('✓ Test node created');

    console.log('=== Step 5: Verify node is NOT selected initially ===');
    const initialSelectedCount: number = await page.evaluate((): number => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return cy.$(':selected').length;
    });
    expect(initialSelectedCount).toBe(0);
    console.log('✓ No nodes selected initially');

    console.log('=== Step 6: Hover over node to open editor ===');
    // Trigger hover on the node
    await page.evaluate((): void => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#test-node-1.md');
      if (node.length === 0) throw new Error('test-node-1.md not found');
      node.trigger('mouseover');
    });

    // Wait for hover editor to appear
    await page.waitForSelector('.cy-floating-window', { timeout: 5000 });
    console.log('✓ Hover editor appeared');

    // Wait for editor content to load
    await page.waitForTimeout(500);

    console.log('=== Step 7: Click inside editor and verify node is selected ===');
    // Click inside the editor content area
    const editorContent = page.locator('.cy-floating-window .cm-content');
    await editorContent.click();
    await page.waitForTimeout(100);

    // KEY VERIFICATION: Node should now be selected because we clicked in its editor
    const isNodeSelected: boolean = await page.evaluate((): boolean => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#test-node-1.md');
      return node.selected();
    });
    expect(isNodeSelected).toBe(true);
    console.log('✓ Node is selected after clicking in editor (this is the key behavior!)');

    // NOTE: Terminal spawning requires full Electron API mocking which is complex.
    // The key behavior (clicking in editor selects node) is verified above.
    // The second test verifies multi-editor selection behavior.
    // Full terminal spawning is tested in electron e2e tests.

    console.log('\n=== Test completed successfully! ===');
    console.log('Key behavior verified: clicking in editor selects the associated node');
  });

  test('clicking in different editors selects their respective nodes', async ({ page }) => {
    console.log('\n=== Starting multi-editor selection test ===');

    await setupMockElectronAPI(page);
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);

    // Create two nodes
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'node-A.md',
          contentWithoutYamlOrLinks: 'Node A content',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 200, y: 300 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      },
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'node-B.md',
          contentWithoutYamlOrLinks: 'Node B content',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 500, y: 300 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      }
    ];
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(50);

    // Click on node A to create anchored editor
    await page.evaluate((): void => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      cy.$('#node-A.md').trigger('tap');
    });
    await page.waitForSelector('.cy-floating-window', { timeout: 5000 });
    await page.waitForTimeout(300);

    // Click on node B to create second anchored editor
    await page.evaluate((): void => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      cy.$('#node-B.md').trigger('tap');
    });
    await page.waitForTimeout(300);

    // Now we have two editors - click in the first one (node A)
    const editors = page.locator('.cy-floating-window');
    const firstEditor = editors.first();
    const firstEditorContent = firstEditor.locator('.cm-content');
    await firstEditorContent.click();
    await page.waitForTimeout(100);

    // Verify node A is selected
    const selectedAfterClickA: string[] = await page.evaluate((): string[] => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return cy.$(':selected').map((n: { id: () => string }) => n.id());
    });
    expect(selectedAfterClickA).toContain('node-A.md');
    expect(selectedAfterClickA).not.toContain('node-B.md');
    console.log('✓ After clicking in editor A, only node A is selected');

    // Click in the second editor (node B)
    const secondEditor = editors.last();
    const secondEditorContent = secondEditor.locator('.cm-content');
    await secondEditorContent.click();
    await page.waitForTimeout(100);

    // Verify node B is now selected (and A is not)
    const selectedAfterClickB: string[] = await page.evaluate((): string[] => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return cy.$(':selected').map((n: { id: () => string }) => n.id());
    });
    expect(selectedAfterClickB).toContain('node-B.md');
    expect(selectedAfterClickB).not.toContain('node-A.md');
    console.log('✓ After clicking in editor B, only node B is selected');

    console.log('\n=== Multi-editor selection test completed! ===');
  });
});
