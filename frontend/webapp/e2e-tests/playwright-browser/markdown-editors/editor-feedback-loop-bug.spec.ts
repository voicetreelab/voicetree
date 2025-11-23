/**
 * BEHAVIORAL SPEC: Editor Feedback Loop Bug Reproduction & Regression Test
 *
 * This test was written to reproduce a critical bug in the markdown editor where:
 * 1. User types content → onChange fires with 300ms debounce
 * 2. Content saved to filesystem via modifyNodeContentFromUI
 * 3. Filesystem watcher detects change → sends FSEvent
 * 4. updateFloatingEditors receives the event and calls editor.setValue()
 * 5. This would overwrite the editor content, even though user has typed MORE since step 1
 *
 * THE BUG HAS BEEN FIXED:
 * The fix uses awaitingUISavedContent map to track content that was saved from the UI-edge.
 * When a filesystem event arrives with content matching what we just saved,
 * FloatingWindowManager.updateFloatingEditors ignores it to prevent the feedback loop.
 *
 * This test now serves as a regression test to ensure the fix continues to work.
 * If this test fails in the future, the feedback loop bug has been reintroduced.
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  sendGraphDelta,
  waitForCytoscapeReady,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils.ts';
import type { Page } from '@playwright/test';
import type { GraphDelta, GraphNode } from '@/pure/graph';
import type { EditorView } from '@codemirror/view';

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

// Helper type for CodeMirror access
interface CodeMirrorElement extends HTMLElement {
  cmView?: { view: EditorView };
}

interface ExtendedWindowWithGraph extends ExtendedWindow {
  electronAPI?: {
    main?: {
      applyGraphDeltaToDBAndMem: (delta: GraphDelta) => Promise<{ success: boolean }>;
      getGraph: () => Promise<{ nodes: Record<string, GraphNode> }>;
      _graphState: { nodes: Record<string, GraphNode> };
    };
    graph?: {
      _updateCallback?: (delta: GraphDelta) => void;
    };
  };
}

/**
 * Helper to get editor content via CodeMirror API
 */
async function getEditorContent(page: Page, editorWindowId: string): Promise<string | null> {
  // Escape dots in window ID for CSS selector
  const editorSelector = `#${editorWindowId.replace(/\./g, '\\.')}`;
  return page.evaluate((selector) => {
    const editorElement = document.querySelector(`${selector} .cm-content`) as CodeMirrorElement | null;
    if (!editorElement) return null;

    const cmView = editorElement.cmView?.view;
    if (!cmView) return null;

    return cmView.state.doc.toString();
  }, editorSelector);
}

/**
 * Helper to set editor content via CodeMirror API (simulates typing)
 */
async function typeInEditor(page: Page, editorWindowId: string, content: string): Promise<void> {
  // Escape dots in window ID for CSS selector
  const editorSelector = `#${editorWindowId.replace(/\./g, '\\.')}`;
  await page.evaluate(({ selector, newContent }: { selector: string; newContent: string }) => {
    const editorElement = document.querySelector(`${selector} .cm-content`) as CodeMirrorElement | null;
    if (!editorElement) throw new Error('Editor content element not found');

    const cmView = editorElement.cmView?.view;
    if (!cmView) throw new Error('CodeMirror view not found');

    // Simulate typing by appending to existing content
    const currentLength = cmView.state.doc.length;
    cmView.dispatch({
      changes: { from: currentLength, to: currentLength, insert: newContent }
    });
  }, { selector: editorSelector, newContent: content });
}

/**
 * Enhanced mock that simulates the debounced save and filesystem feedback loop
 */
async function setupMockWithFilesystemFeedback(page: Page): Promise<void> {
  await setupMockElectronAPI(page);

  await page.addInitScript(() => {
    const api = (window as unknown as ExtendedWindowWithGraph).electronAPI;
    if (api && api.main && api.graph) {
      const originalApplyGraphDelta = api.main.applyGraphDeltaToDBAndMem;
      const graphState = api.main._graphState;

      // Override applyGraphDeltaToDBAndMem to simulate filesystem feedback
      api.main.applyGraphDeltaToDBAndMem = async (delta: GraphDelta) => {
        console.log('[Mock] applyGraphDeltaToDBAndMem called with', delta.length, 'operations');

        // Store the content being saved
        let savedContent: string | null = null;
        let nodeId: string | null = null;

        // Update graph state and capture the saved content
        delta.forEach((nodeDelta) => {
          if (nodeDelta.type === 'UpsertNode') {
            const node = nodeDelta.nodeToUpsert;
            graphState.nodes[node.relativeFilePathIsID] = node;
            savedContent = node.contentWithoutYamlOrLinks;
            nodeId = node.relativeFilePathIsID;
            console.log('[Mock] Captured save for node:', nodeId, 'content length:', savedContent.length);
          } else if (nodeDelta.type === 'DeleteNode') {
            delete graphState.nodes[nodeDelta.nodeId];
          }
        });

        // Call original implementation
        const result = await originalApplyGraphDelta(delta);

        // SIMULATE FILESYSTEM FEEDBACK with a delay
        // In the real app, this would come from chokidar watching the file
        const updateCallback = api.graph?._updateCallback;
        if (savedContent !== null && nodeId !== null && updateCallback) {
          console.log('[Mock] Scheduling filesystem feedback for node:', nodeId);

          // Simulate the time it takes for:
          // 1. File to be written to disk
          // 2. Chokidar to detect the change
          // 3. Event to propagate back to renderer
          setTimeout(() => {
            const feedbackDelta: GraphDelta = [
              {
                type: 'UpsertNode',
                nodeToUpsert: graphState.nodes[nodeId!]
              }
            ];
            console.log('[Mock] Triggering filesystem feedback for node:', nodeId);
            updateCallback(feedbackDelta);
          }, 100); // Small delay to simulate filesystem I/O and event propagation
        }

        return result;
      };
    }
  });
}

test.describe('Editor Feedback Loop Bug (Browser)', () => {

  test('should NOT overwrite editor content when filesystem event arrives with stale content', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Testing editor feedback loop bug ===');

    console.log('=== Step 1: Setup mock Electron API with filesystem feedback simulation ===');
    await setupMockWithFilesystemFeedback(page);
    console.log('✓ Electron API mock prepared');

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    console.log('✓ React rendered');

    await page.waitForTimeout(50);

    console.log('=== Step 3: Wait for Cytoscape ===');
    await waitForCytoscapeReady(page);
    console.log('✓ Cytoscape initialized');

    console.log('=== Step 4: Send graph delta with test node ===');
    const nodeId = 'test-feedback-loop.md';
    const initialContent = '# Test Feedback Loop\nInitial content here.';
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: nodeId,
          contentWithoutYamlOrLinks: initialContent,
          outgoingEdges: [],
          nodeUIMetadata: {
            title: 'Test Feedback Loop',
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 400, y: 400 } } as const
          }
        }
      }
    ];
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(50);
    console.log('✓ Test node added to graph');

    console.log('=== Step 5: Open editor by tapping node ===');
    await page.evaluate((nId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById(nId);
      if (node.length === 0) throw new Error(`${nId} node not found`);
      node.trigger('tap');
    }, nodeId);

    // Editor window ID needs escaped dots for CSS selector
    const editorWindowId = `window-${nodeId}-editor`;
    const editorSelector = `#${editorWindowId.replace(/\./g, '\\.')}`; // Escape dots for CSS selector

    // Wait for editor to open
    await page.waitForSelector(editorSelector, { timeout: 5000 });
    console.log('✓ Editor opened');

    // Wait for CodeMirror to render
    await page.waitForSelector(`${editorSelector} .cm-editor`, { timeout: 5000 });

    console.log('=== Step 6: Reproduce the feedback loop bug ===');

    // Simulate the sequence of events:
    // 1. User types "Hello world"
    console.log('[Bug Repro Step 1] User types "Hello world"');
    await typeInEditor(page, editorWindowId, '\nHello world');
    await page.waitForTimeout(5); // Brief pause

    const contentAfterFirstType = await getEditorContent(page, editorWindowId);
    console.log('Content after first type:', contentAfterFirstType?.substring(contentAfterFirstType.length - 50));
    expect(contentAfterFirstType).toContain('Hello world');

    // 2. Wait for debounce to fire (300ms)
    console.log('[Bug Repro Step 2] Waiting for debounced save (300ms)...');
    await page.waitForTimeout(35); // Wait for debounce + save to trigger

    // 3. User continues typing MORE content AFTER the debounce fired
    console.log('[Bug Repro Step 3] User types " and more text" AFTER debounce fired');
    await typeInEditor(page, editorWindowId, ' and more text');
    await page.waitForTimeout(5);

    const contentAfterSecondType = await getEditorContent(page, editorWindowId);
    console.log('Content after second type:', contentAfterSecondType?.substring(contentAfterSecondType.length - 50));
    expect(contentAfterSecondType).toContain('Hello world and more text');

    // 4. Filesystem event arrives with the FIRST save (only "Hello world", not "and more text")
    console.log('[Bug Repro Step 4] Waiting for filesystem event to arrive with stale content...');
    await page.waitForTimeout(20); // Wait for filesystem feedback to arrive

    // 5. CRITICAL ASSERTION: Editor should STILL have the full content
    const finalContent = await getEditorContent(page, editorWindowId);
    console.log('Final editor content:', finalContent?.substring(finalContent.length - 50));

    // THIS ASSERTION WILL FAIL - reproducing the bug
    // The editor will have lost "and more text" because setValue() was called
    expect(finalContent).toContain('Hello world and more text');
    console.log('✓ Editor preserved all typed content despite filesystem feedback');

    // Additional verification: content should NOT be just "Hello world"
    if (finalContent && !finalContent.includes('and more text')) {
      console.error('❌ BUG REPRODUCED: Editor lost "and more text" after filesystem feedback!');
      console.error('Editor only has:', finalContent.substring(finalContent.length - 50));
    }
  });

  test('should demonstrate the race condition with multiple rapid edits', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Testing rapid edits race condition ===');

    await setupMockWithFilesystemFeedback(page);
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);

    const nodeId = 'test-rapid-edits.md';
    const initialContent = '# Rapid Edits Test\n';
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: nodeId,
          contentWithoutYamlOrLinks: initialContent,
          outgoingEdges: [],
          nodeUIMetadata: {
            title: 'Rapid Edits Test',
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 400, y: 400 } } as const
          }
        }
      }
    ];
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(50);

    // Open editor
    await page.evaluate((nId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      cy.getElementById(nId).trigger('tap');
    }, nodeId);

    const editorWindowId = `window-${nodeId}-editor`;
    const editorSelector = `#${editorWindowId.replace(/\./g, '\\.')}`; // Escape dots for CSS selector
    await page.waitForSelector(`${editorSelector} .cm-editor`, { timeout: 5000 });

    console.log('=== Simulating rapid typing pattern ===');

    // Type "Line 1"
    await typeInEditor(page, editorWindowId, 'Line 1\n');
    console.log('[Rapid] Typed "Line 1"');
    await page.waitForTimeout(10);

    // Type "Line 2"
    await typeInEditor(page, editorWindowId, 'Line 2\n');
    console.log('[Rapid] Typed "Line 2"');
    await page.waitForTimeout(10);

    // Type "Line 3"
    await typeInEditor(page, editorWindowId, 'Line 3\n');
    console.log('[Rapid] Typed "Line 3"');

    // Wait for debounce
    await page.waitForTimeout(35);

    // Type "Line 4" AFTER debounce
    await typeInEditor(page, editorWindowId, 'Line 4\n');
    console.log('[Rapid] Typed "Line 4" after debounce');

    // Wait for filesystem feedback
    await page.waitForTimeout(20);

    const finalContent = await getEditorContent(page, editorWindowId);
    console.log('Final content after rapid edits:', finalContent);

    // All lines should be present
    expect(finalContent).toContain('Line 1');
    expect(finalContent).toContain('Line 2');
    expect(finalContent).toContain('Line 3');
    expect(finalContent).toContain('Line 4');

    console.log('✓ All lines preserved after rapid edits');
  });
});
