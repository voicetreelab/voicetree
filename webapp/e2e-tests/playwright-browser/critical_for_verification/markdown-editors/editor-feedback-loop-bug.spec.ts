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

interface ExtendedWindowWithGraph extends ExtendedWindow {
  hostAPI?: {
    main?: {
      applyGraphDeltaToDBAndMem: (delta: GraphDelta) => Promise<{ success: boolean }>;
      getGraph: () => Promise<{ nodes: Record<string, GraphNode> }>;
      _graphState: { nodes: Record<string, GraphNode> };
    };
    graph?: {
      _projectedGraphCallback?: (graph: unknown) => void;
    };
  };
}

// Editor access goes through the production `vanillaFloatingWindowInstances` store
// and the public CodeMirrorEditorView API (focusAtEnd/getValue). The older approach
// of reading CodeMirror's internal `cmView` property off `.cm-content` stopped
// working in @codemirror/view 6.43, which replaced it with `cmTile`. The store
// lookup is version-agnostic and lets us drive real `page.keyboard` input so CM
// tags transactions as user events (which the production autosave path requires).
type EditorInstance = { getValue: () => string; focusAtEnd: () => void };

async function waitForEditorInstance(page: Page, editorInstanceId: string): Promise<void> {
  await page.waitForFunction(async (id) => {
    const store = await import('/src/shell/edge/UI-edge/state/stores/UIAppState.ts' as string);
    return store.vanillaFloatingWindowInstances.has(id);
  }, editorInstanceId, { timeout: 5000 });
}

async function focusEditorAtEnd(page: Page, editorInstanceId: string): Promise<void> {
  await page.evaluate(async (id) => {
    const store = await import('/src/shell/edge/UI-edge/state/stores/UIAppState.ts' as string);
    const instance = store.vanillaFloatingWindowInstances.get(id) as unknown as EditorInstance | undefined;
    if (!instance) throw new Error(`Editor instance not registered: ${id}`);
    if (typeof instance.focusAtEnd !== 'function') throw new Error('Editor lacks focusAtEnd');
    instance.focusAtEnd();
  }, editorInstanceId);
}

async function readEditorValue(page: Page, editorInstanceId: string): Promise<string> {
  return page.evaluate(async (id) => {
    const store = await import('/src/shell/edge/UI-edge/state/stores/UIAppState.ts' as string);
    const instance = store.vanillaFloatingWindowInstances.get(id) as unknown as EditorInstance | undefined;
    if (!instance) throw new Error(`Editor instance not registered: ${id}`);
    if (typeof instance.getValue !== 'function') throw new Error('Editor lacks getValue');
    return instance.getValue();
  }, editorInstanceId);
}

/**
 * Enhanced mock that simulates the debounced save and filesystem feedback loop
 */
async function setupMockWithFilesystemFeedback(page: Page): Promise<void> {
  await setupMockElectronAPI(page);

  await page.addInitScript(() => {
    const api = (window as unknown as ExtendedWindowWithGraph).hostAPI;
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
            graphState.nodes[node.absoluteFilePathIsID] = node;
            savedContent = node.contentWithoutYamlOrLinks;
            nodeId = node.absoluteFilePathIsID;
            console.log('[Mock] Captured save for node:', nodeId, 'content length:', savedContent.length);
          } else if (nodeDelta.type === 'DeleteNode') {
            delete graphState.nodes[nodeDelta.nodeId];
          }
        });

        // Call original implementation
        const result = await originalApplyGraphDelta(delta);

        // SIMULATE FILESYSTEM FEEDBACK with a delay
        // In the real app, this would come from chokidar watching the file
        const updateCallback = api.graph?._projectedGraphCallback;
        if (savedContent !== null && nodeId !== null && updateCallback) {
          console.log('[Mock] Scheduling filesystem feedback for node:', nodeId);

          // Simulate the time it takes for:
          // 1. File to be written to disk
          // 2. Chokidar to detect the change
          // 3. Event to propagate back to renderer
          setTimeout(() => {
            void (async () => {
              const feedbackDelta: GraphDelta = [
                {
                  type: 'UpsertNode',
                  nodeToUpsert: graphState.nodes[nodeId!],
                  previousNode: { _tag: 'Some', value: graphState.nodes[nodeId!] } as const
                }
              ];
              console.log('[Mock] Triggering filesystem feedback for node:', nodeId);
              const { projectDelta } = await import('/src/shell/edge/UI-edge/graph/integration-tests/projectGraphDelta.ts');
              updateCallback(projectDelta(feedbackDelta));
            })();
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
          absoluteFilePathIsID: nodeId,
          contentWithoutYamlOrLinks: initialContent,
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
    const editorInstanceId = `${nodeId}-editor`; // Matches getEditorId(): `${nodeId}-editor`

    // Wait for editor to open
    await page.waitForSelector(editorSelector, { timeout: 5000 });
    console.log('✓ Editor opened');

    // Wait for CodeMirror to render
    await page.waitForSelector(`${editorSelector} .cm-editor`, { timeout: 5000 });

    // Wait for the editor instance to be registered in the production store
    // before reading/writing through it.
    await waitForEditorInstance(page, editorInstanceId);

    // Production autosave debounce (set in FloatingEditorCRUD). Keep in sync if it changes.
    const AUTOSAVE_DEBOUNCE_MS = 150;
    // Mock filesystem-feedback delay scheduled below.
    const MOCK_FS_FEEDBACK_DELAY_MS = 100;

    // Install a writeMarkdownFile mock that captures the saved content and, after a small
    // delay, drives a projected-graph update carrying that (now-stale) content back into
    // the renderer — i.e. simulates chokidar's filesystem-watch echo.
    //
    // Why install it here instead of upgrading the shared `setupMockWithFilesystemFeedback`:
    //   the shared mock still wires the older `applyGraphDeltaToDBAndMem` path which production
    //   no longer calls from autosave (saves now go through `writeMarkdownFile`). Updating the
    //   shared mock would also retarget the peer-owned :307 test, so we install the mock here
    //   for :204 only and flag the shared-mock staleness in the agent report.
    await page.evaluate(({ feedbackDelayMs }) => {
      type GraphNodeLike = {
        absoluteFilePathIsID: string;
        contentWithoutYamlOrLinks: string;
      };
      const win = window as unknown as {
        hostAPI?: {
          main?: {
            writeMarkdownFile?: (nodeId: string, body: string, writerId: string) => Promise<unknown>;
          };
          graph?: {
            _graphState?: { nodes: Record<string, GraphNodeLike> };
            _projectedGraphCallback?: (graph: unknown) => void;
          };
        };
      };
      const api = win.hostAPI;
      if (!api?.main || !api.graph) {
        throw new Error('hostAPI mock is not initialised');
      }
      const graphState = api.graph._graphState;
      if (!graphState) {
        throw new Error('mock graph state is not initialised');
      }
      api.main.writeMarkdownFile = async (nodeIdArg: string, body: string, _writerId: string) => {
        // Update the mock graph with what was saved (this is the content the FS will echo back).
        const existing = graphState.nodes[nodeIdArg];
        const savedNode: GraphNodeLike = existing
          ? { ...existing, contentWithoutYamlOrLinks: body }
          : { absoluteFilePathIsID: nodeIdArg, contentWithoutYamlOrLinks: body };
        graphState.nodes[nodeIdArg] = savedNode;

        // Schedule the FS-echo: project a delta whose nodeToUpsert matches what we just saved,
        // with previousNode also pointing at that saved snapshot (= what was on disk pre-save
        // when chokidar fires after a UI-initiated write). EditorSync should refuse to overwrite
        // the editor's newer content because currentEditorContent no longer matches prevContent.
        setTimeout(() => {
          void (async () => {
            const feedbackDelta = [
              {
                type: 'UpsertNode',
                nodeToUpsert: savedNode,
                previousNode: { _tag: 'Some', value: savedNode } as const,
              },
            ];
            const { projectDelta } = await import('/src/shell/edge/UI-edge/graph/integration-tests/projectGraphDelta.ts' as string);
            const projected = projectDelta(feedbackDelta as unknown as Parameters<typeof projectDelta>[0]);
            api.graph?._projectedGraphCallback?.(projected);
          })();
        }, feedbackDelayMs);

        return { ok: true, absolutePath: nodeIdArg, preservedSuffix: null };
      };
    }, { feedbackDelayMs: MOCK_FS_FEEDBACK_DELAY_MS });

    console.log('=== Step 6: Reproduce the feedback loop bug ===');

    // Focus the editor with cursor at end so subsequent keystrokes append to existing content.
    await focusEditorAtEnd(page, editorInstanceId);

    // Simulate the sequence of events:
    // 1. User types "Hello world"
    console.log('[Bug Repro Step 1] User types "Hello world"');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Hello world');

    const contentAfterFirstType = await readEditorValue(page, editorInstanceId);
    console.log('Content after first type:', contentAfterFirstType.substring(contentAfterFirstType.length - 50));
    expect(contentAfterFirstType).toContain('Hello world');

    // 2. Wait long enough for the autosave debounce to fire on the FIRST burst.
    //    Once the debounce fires, the mock captures `Hello world` as the saved content
    //    and schedules a filesystem-feedback callback MOCK_FS_FEEDBACK_DELAY_MS later.
    console.log('[Bug Repro Step 2] Waiting for debounced save to fire...');
    await page.waitForTimeout(AUTOSAVE_DEBOUNCE_MS + 30);

    // 3. User continues typing MORE content AFTER the save fired.
    //    The editor now holds "...Hello world and more text" but the in-flight FS feedback
    //    still carries only "...Hello world".
    console.log('[Bug Repro Step 3] User types " and more text" AFTER debounce fired');
    await page.keyboard.type(' and more text');

    const contentAfterSecondType = await readEditorValue(page, editorInstanceId);
    console.log('Content after second type:', contentAfterSecondType.substring(contentAfterSecondType.length - 50));
    expect(contentAfterSecondType).toContain('Hello world and more text');

    // 4. Wait for the filesystem feedback (with stale content) to arrive.
    //    Feedback was scheduled at save-fire time = ~AUTOSAVE_DEBOUNCE_MS, so it lands
    //    ~MOCK_FS_FEEDBACK_DELAY_MS after that. Add headroom for projection + dispatch.
    console.log('[Bug Repro Step 4] Waiting for filesystem event to arrive with stale content...');
    await page.waitForTimeout(MOCK_FS_FEEDBACK_DELAY_MS + 80);

    // 5. CRITICAL ASSERTION: Editor should STILL have the full content (no overwrite).
    const finalContent = await readEditorValue(page, editorInstanceId);
    console.log('Final editor content:', finalContent.substring(finalContent.length - 50));

    expect(finalContent).toContain('Hello world and more text');
    console.log('✓ Editor preserved all typed content despite filesystem feedback');

    // Additional verification: content should NOT have been truncated back to the saved snapshot.
    if (!finalContent.includes('and more text')) {
      console.error('❌ BUG REPRODUCED: Editor lost "and more text" after filesystem feedback!');
      console.error('Editor only has:', finalContent.substring(finalContent.length - 50));
    }
  });

  test('should demonstrate the race condition with multiple rapid edits', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Testing rapid edits race condition ===');

    await setupMockWithFilesystemFeedback(page);
    await page.goto('/');
    await waitForCytoscapeReady(page);

    const nodeId = 'test-rapid-edits.md';
    const initialContent = '# Rapid Edits Test\n';
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: nodeId,
          contentWithoutYamlOrLinks: initialContent,
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
    await page.waitForTimeout(50);

    // Open editor
    await page.evaluate((nId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      cy.getElementById(nId).trigger('tap');
    }, nodeId);

    const editorWindowId = `window-${nodeId}-editor`;
    const editorSelector = `#${editorWindowId.replace(/\./g, '\\.')}`; // Escape dots for CSS selector
    const editorInstanceId = `${nodeId}-editor`; // Matches getEditorId(): `${nodeId}-editor`

    await page.waitForSelector(`${editorSelector} .cm-editor`, { timeout: 5000 });
    await waitForEditorInstance(page, editorInstanceId);

    console.log('=== Simulating rapid typing pattern ===');

    // Focus once with cursor at end; the four rapid types below append in sequence.
    await focusEditorAtEnd(page, editorInstanceId);

    await page.keyboard.type('Line 1\n');
    console.log('[Rapid] Typed "Line 1"');
    await page.waitForTimeout(10);

    await page.keyboard.type('Line 2\n');
    console.log('[Rapid] Typed "Line 2"');
    await page.waitForTimeout(10);

    await page.keyboard.type('Line 3\n');
    console.log('[Rapid] Typed "Line 3"');

    // Wait for debounce
    await page.waitForTimeout(35);

    // Type "Line 4" AFTER debounce
    await page.keyboard.type('Line 4\n');
    console.log('[Rapid] Typed "Line 4" after debounce');

    // Wait for filesystem feedback
    await page.waitForTimeout(20);

    const finalContent = await readEditorValue(page, editorInstanceId);
    console.log('Final content after rapid edits:', finalContent);

    // All lines should be present
    expect(finalContent).toContain('Line 1');
    expect(finalContent).toContain('Line 2');
    expect(finalContent).toContain('Line 3');
    expect(finalContent).toContain('Line 4');

    console.log('✓ All lines preserved after rapid edits');
  });
});
