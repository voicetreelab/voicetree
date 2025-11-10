/**
 * Browser-based test for external markdown content updates in floating editors
 * Tests that when a graph delta event updates node content, the floating editor reflects the change
 */

import { test, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  sendGraphDelta,
  waitForCytoscapeReady,
  type ExtendedWindow
} from '@test/playwright-browser/graph-delta-test-utils.ts';
import type { GraphDelta } from '@/functional_graph/pure/types.ts';

test.describe('External Content Update (Browser)', () => {
  test('should update floating editor content when graph delta event arrives', async ({ page }) => {
    console.log('\n=== Starting external content update test (Browser) ===');

    // Listen for console messages (errors, warnings, logs)
    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      console.log(`[Browser ${type}] ${text}`);
    });

    // Listen for page errors (uncaught exceptions)
    page.on('pageerror', error => {
      console.error('[Browser Error]', error.message);
      console.error(error.stack);
    });

    console.log('=== Step 1: Mock Electron API BEFORE navigation ===');
    await setupMockElectronAPI(page);
    console.log('✓ Electron API mock prepared');

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/'); // Vite dev server URL

    // Wait for React to render
    await page.waitForSelector('#root', { timeout: 5000 });
    console.log('✓ React rendered');

    // Wait for graph update handler to be registered
    await page.waitForTimeout(500);
    console.log('✓ Graph update handler should be registered');

    console.log('=== Step 3: Wait for Cytoscape to initialize ===');
    await waitForCytoscapeReady(page);
    console.log('✓ Cytoscape initialized');

    console.log('=== Step 4: Send initial graph delta with a node ===');
    const initialContent = '# Initial Content\nThis is the initial markdown content.';
    const initialGraphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'test-node.md',
          content: initialContent,
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 300, y: 300 } } as const
          }
        }
      }
    ];
    await sendGraphDelta(page, initialGraphDelta);

    // Wait for node to be added to graph
    await page.waitForTimeout(300);
    console.log('✓ Initial graph delta sent');

    console.log('=== Step 5: Open markdown editor by triggering tap event on node ===');
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#test-node.md');
      if (node.length === 0) throw new Error('test-node.md not found');

      // Trigger tap event to open editor (dbltap is handled as tap in setupCytoscape)
      node.trigger('tap');
    });

    // Wait for editor to open and render
    await page.waitForTimeout(500);
    console.log('✓ Triggered tap event on node');

    console.log('=== Step 6: Wait for editor window to appear and verify initial content ===');
    // Wait for the editor window to be visible
    await page.waitForSelector('#window-editor-test-node\\.md', { timeout: 3000 });
    console.log('✓ Editor window appeared in DOM');

    // Wait for CodeMirror to render
    await page.waitForSelector('#window-editor-test-node\\.md .cm-content', { timeout: 3000 });
    console.log('✓ CodeMirror editor rendered');

    // Get initial editor content
    const initialEditorContent = await page.evaluate(() => {
      const cmContent = document.querySelector('#window-editor-test-node\\.md .cm-content');
      return cmContent?.textContent || '';
    });

    console.log(`  Initial editor content: "${initialEditorContent.substring(0, 50)}..."`);
    expect(initialEditorContent).toContain('Initial Content');
    expect(initialEditorContent).toContain('This is the initial markdown content');
    console.log('✓ Initial content verified in editor');

    console.log('=== Step 7: Send graph delta event with updated content ===');
    const updatedContent = '# Updated Content\nThis content was updated externally!';
    const updateGraphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'test-node.md',
          content: updatedContent,
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 300, y: 300 } } as const
          }
        }
      }
    ];
    await sendGraphDelta(page, updateGraphDelta);

    // Wait for content to update
    await page.waitForTimeout(500);
    console.log('✓ Update graph delta sent');

    console.log('=== Step 8: Verify editor content has been updated ===');
    // Get updated editor content
    const updatedEditorContent = await page.evaluate(() => {
      const cmContent = document.querySelector('#window-editor-test-node\\.md .cm-content');
      return cmContent?.textContent || '';
    });

    console.log(`  Updated editor content: "${updatedEditorContent.substring(0, 50)}..."`);

    // Verify the content has changed
    expect(updatedEditorContent).not.toContain('Initial Content');
    expect(updatedEditorContent).not.toContain('This is the initial markdown content');
    expect(updatedEditorContent).toContain('Updated Content');
    expect(updatedEditorContent).toContain('This content was updated externally');
    console.log('✓ Editor content successfully updated from external graph delta event');

    console.log('✓ External content update test completed successfully');
  });
});
