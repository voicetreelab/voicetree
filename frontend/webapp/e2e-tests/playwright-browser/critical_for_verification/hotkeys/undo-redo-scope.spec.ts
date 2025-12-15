/**
 * Browser-based test for undo/redo hotkey scope isolation
 * Tests that:
 * - Cmd+Z in editor undoes editor changes only (NOT graph changes)
 * - Cmd+Z outside editor triggers graph undo only
 * - Cmd+Shift+Z follows the same pattern for redo
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

// Helper type for CodeMirror access
interface CodeMirrorElement extends HTMLElement {
  cmView?: {
    view: {
      state: { doc: { length: number; toString: () => string } };
      dispatch: (spec: unknown) => void;
      focus: () => void;
    }
  };
}

// Extended window type with undo tracking
interface ExtendedWindowWithUndoTracking extends ExtendedWindow {
  _undoRedoTracker?: {
    undoCalls: number;
    redoCalls: number;
  };
}

/**
 * Sets up mock Electron API with undo/redo call tracking
 */
async function setupMockElectronAPIWithUndoTracking(page: import('@playwright/test').Page): Promise<void> {
  await setupMockElectronAPI(page);

  // Add undo/redo tracking
  await page.addInitScript(() => {
    // Initialize tracker
    (window as unknown as ExtendedWindowWithUndoTracking)._undoRedoTracker = {
      undoCalls: 0,
      redoCalls: 0
    };

    const api = (window as unknown as { electronAPI?: { main: Record<string, unknown> } }).electronAPI;
    if (api && api.main) {
      // Mock performUndo with tracking
      api.main.performUndo = async () => {
        const tracker = (window as unknown as ExtendedWindowWithUndoTracking)._undoRedoTracker;
        if (tracker) {
          tracker.undoCalls++;
          console.log(`[Mock] performUndo called (total: ${tracker.undoCalls})`);
        }
        return true;
      };

      // Mock performRedo with tracking
      api.main.performRedo = async () => {
        const tracker = (window as unknown as ExtendedWindowWithUndoTracking)._undoRedoTracker;
        if (tracker) {
          tracker.redoCalls++;
          console.log(`[Mock] performRedo called (total: ${tracker.redoCalls})`);
        }
        return true;
      };
    }
  });
}

test.describe('Undo/Redo Hotkey Scope Isolation (Browser)', () => {

  test('Cmd+Z in editor should only undo editor changes, not graph changes', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting undo scope isolation test ===');

    console.log('=== Step 1: Setup mock Electron API with undo tracking ===');
    await setupMockElectronAPIWithUndoTracking(page);
    console.log('✓ Electron API mock prepared with undo/redo tracking');

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    console.log('✓ React rendered');

    console.log('=== Step 3: Wait for Cytoscape ===');
    await waitForCytoscapeReady(page);
    console.log('✓ Cytoscape initialized');

    console.log('=== Step 4: Send graph delta with test node ===');
    const testContent = '# Test Node\nOriginal content.';
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'undo-test-node.md',
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
    await page.waitForTimeout(50);
    console.log('✓ Graph delta sent');

    console.log('=== Step 5: Open editor via tap event ===');
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#undo-test-node.md');
      if (node.length === 0) throw new Error('undo-test-node.md not found');
      node.trigger('tap');
    });
    await page.waitForTimeout(100);
    console.log('✓ Tap event triggered');

    console.log('=== Step 6: Wait for editor to render ===');
    const editorSelector = '#window-undo-test-node\\.md-editor';
    await page.waitForSelector(editorSelector, { timeout: 3000 });
    await page.waitForSelector(`${editorSelector} .cm-content`, { timeout: 3000 });
    console.log('✓ Editor window and CodeMirror rendered');

    console.log('=== Step 7: Focus the editor and type some text ===');
    // Focus the editor
    await page.evaluate((selector) => {
      const editorElement = document.querySelector(`${selector} .cm-content`) as CodeMirrorElement | null;
      if (!editorElement) throw new Error('Editor content element not found');

      const cmView = editorElement.cmView?.view;
      if (!cmView) throw new Error('CodeMirror view not found');

      cmView.focus();
    }, editorSelector);
    await page.waitForTimeout(50);

    // Type some text into the editor
    await page.keyboard.type(' Added text.');
    await page.waitForTimeout(50);
    console.log('✓ Text typed into editor');

    // Verify the text was added
    const contentAfterTyping = await page.evaluate((selector) => {
      const cmContent = document.querySelector(`${selector} .cm-content`);
      return cmContent?.textContent ?? '';
    }, editorSelector);
    console.log(`  Content after typing: "${contentAfterTyping}"`);
    expect(contentAfterTyping).toContain('Added text');

    console.log('=== Step 8: Press Cmd+Z while in editor - should undo editor change only ===');
    // Reset the undo tracker to ensure clean count
    await page.evaluate(() => {
      const tracker = (window as unknown as ExtendedWindowWithUndoTracking)._undoRedoTracker;
      if (tracker) {
        tracker.undoCalls = 0;
        tracker.redoCalls = 0;
      }
    });

    // Press Cmd+Z while focused in the editor
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(100);
    console.log('✓ Cmd+Z pressed while in editor');

    // Check that graph undo was NOT called
    const undoCallsAfterEditorUndo = await page.evaluate(() => {
      return (window as unknown as ExtendedWindowWithUndoTracking)._undoRedoTracker?.undoCalls ?? -1;
    });
    console.log(`  Graph undo calls: ${undoCallsAfterEditorUndo}`);
    expect(undoCallsAfterEditorUndo).toBe(0);
    console.log('✓ Graph undo was NOT called while in editor');

    // Check that editor content was actually undone
    const contentAfterEditorUndo = await page.evaluate((selector) => {
      const cmContent = document.querySelector(`${selector} .cm-content`);
      return cmContent?.textContent ?? '';
    }, editorSelector);
    console.log(`  Content after editor undo: "${contentAfterEditorUndo}"`);
    // After undo, "Added text." should be partially or fully removed
    // Note: CodeMirror may undo character by character or by transaction
    expect(contentAfterEditorUndo.length).toBeLessThan(contentAfterTyping.length);
    console.log('✓ Editor content was undone');

    console.log('=== Step 9: Blur editor focus ===');
    // Blur the editor by focusing the document body
    await page.evaluate(() => {
      // Remove focus from the editor
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      // Focus the body to ensure keyboard events don't go to editor
      document.body.focus();
    });
    await page.waitForTimeout(100);
    console.log('✓ Editor blurred');

    // Verify editor is no longer focused
    const isFocusedInEditor = await page.evaluate(() => {
      const activeElement = document.activeElement;
      return activeElement?.classList.contains('cm-content') ||
             activeElement?.closest('.cm-editor') !== null;
    });
    console.log(`  Focus in editor: ${isFocusedInEditor}`);
    expect(isFocusedInEditor).toBe(false);

    console.log('=== Step 10: Press Cmd+Z while NOT in editor - should trigger graph undo ===');
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(100);
    console.log('✓ Cmd+Z pressed while outside editor');

    const undoCallsAfterGraphUndo = await page.evaluate(() => {
      return (window as unknown as ExtendedWindowWithUndoTracking)._undoRedoTracker?.undoCalls ?? -1;
    });
    console.log(`  Graph undo calls: ${undoCallsAfterGraphUndo}`);
    expect(undoCallsAfterGraphUndo).toBe(1);
    console.log('✓ Graph undo WAS called when outside editor');

    console.log('✓ Undo scope isolation test completed successfully');
  });

  test('Cmd+Shift+Z redo should follow same scope rules as undo', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting redo scope isolation test ===');

    console.log('=== Step 1: Setup mock Electron API with redo tracking ===');
    await setupMockElectronAPIWithUndoTracking(page);
    console.log('✓ Electron API mock prepared');

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    console.log('✓ React rendered');

    console.log('=== Step 3: Wait for Cytoscape ===');
    await waitForCytoscapeReady(page);
    console.log('✓ Cytoscape initialized');

    console.log('=== Step 4: Send graph delta with test node ===');
    const testContent = '# Redo Test\nOriginal.';
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'redo-test-node.md',
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
    await page.waitForTimeout(50);
    console.log('✓ Graph delta sent');

    console.log('=== Step 5: Open editor ===');
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#redo-test-node.md');
      node.trigger('tap');
    });
    await page.waitForTimeout(100);

    const editorSelector = '#window-redo-test-node\\.md-editor';
    await page.waitForSelector(editorSelector, { timeout: 3000 });
    await page.waitForSelector(`${editorSelector} .cm-content`, { timeout: 3000 });
    console.log('✓ Editor opened');

    console.log('=== Step 6: Focus editor, type text, then undo ===');
    await page.evaluate((selector) => {
      const editorElement = document.querySelector(`${selector} .cm-content`) as CodeMirrorElement | null;
      if (!editorElement) throw new Error('Editor not found');
      editorElement.cmView?.view.focus();
    }, editorSelector);
    await page.waitForTimeout(50);

    await page.keyboard.type('XYZ');
    await page.waitForTimeout(50);
    console.log('✓ Typed "XYZ"');

    // Undo the typing
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(50);
    console.log('✓ Undid typing');

    console.log('=== Step 7: Press Cmd+Shift+Z in editor - should redo editor change only ===');
    // Reset tracker
    await page.evaluate(() => {
      const tracker = (window as unknown as ExtendedWindowWithUndoTracking)._undoRedoTracker;
      if (tracker) {
        tracker.undoCalls = 0;
        tracker.redoCalls = 0;
      }
    });

    await page.keyboard.press('Meta+Shift+z');
    await page.waitForTimeout(100);
    console.log('✓ Cmd+Shift+Z pressed while in editor');

    const redoCallsInEditor = await page.evaluate(() => {
      return (window as unknown as ExtendedWindowWithUndoTracking)._undoRedoTracker?.redoCalls ?? -1;
    });
    console.log(`  Graph redo calls: ${redoCallsInEditor}`);
    expect(redoCallsInEditor).toBe(0);
    console.log('✓ Graph redo was NOT called while in editor');

    console.log('=== Step 8: Blur editor and press Cmd+Shift+Z - should trigger graph redo ===');
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      document.body.focus();
    });
    await page.waitForTimeout(100);

    await page.keyboard.press('Meta+Shift+z');
    await page.waitForTimeout(100);
    console.log('✓ Cmd+Shift+Z pressed outside editor');

    const redoCallsOutsideEditor = await page.evaluate(() => {
      return (window as unknown as ExtendedWindowWithUndoTracking)._undoRedoTracker?.redoCalls ?? -1;
    });
    console.log(`  Graph redo calls: ${redoCallsOutsideEditor}`);
    expect(redoCallsOutsideEditor).toBe(1);
    console.log('✓ Graph redo WAS called when outside editor');

    console.log('✓ Redo scope isolation test completed successfully');
  });
});
