/**
 * BEHAVIORAL SPEC:
 * E2E test for flush editor content before agent spawn
 *
 * This test verifies the race condition fix where editor content is flushed
 * before context node creation when user types and immediately presses Cmd+Enter.
 *
 * PROBLEM BEING TESTED:
 * - Editor has 300ms debounce on autosave
 * - User types content, then immediately clicks Run (or Cmd+Enter)
 * - Without flush: context node reads stale graph state (missing typed content)
 * - With flush: editor content is saved immediately before context creation
 *
 * TEST FLOW:
 * 1. Load example_small fixture
 * 2. Open editor on a node
 * 3. Type unique test content
 * 4. Immediately press Cmd+Enter (before 300ms debounce fires)
 * 5. Verify context node file contains the just-typed content
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';
import type { EditorView } from '@codemirror/view';

// Use absolute paths for example_folder_fixtures
const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');

// Type definitions
interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

// Helper type for CodeMirror access
interface CodeMirrorElement extends HTMLElement {
  cmView?: { view: EditorView };
}

// Extend test with Electron app
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    // Create a temporary userData directory for this test
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-flush-editor-test-'));

    // Write the config file to auto-load the test vault
    // Set empty suffix to use directory directly (without /voicetree subfolder)
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({
      lastDirectory: FIXTURE_VAULT_PATH,
      suffixes: {
        [FIXTURE_VAULT_PATH]: '' // Empty suffix means use directory directly
      }
    }, null, 2), 'utf8');
    console.log('[Test] Created config file to auto-load:', FIXTURE_VAULT_PATH);

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}` // Use temp userData to isolate test config
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
        VOICETREE_PERSIST_STATE: '1'
      },
      timeout: 10000 // 10 second timeout for app launch
    });

    await use(electronApp);

    // Graceful shutdown
    try {
      const window = await electronApp.firstWindow();
      await window.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (api) {
          await api.main.stopFileWatching();
        }
      });
      await window.waitForTimeout(300);
    } catch {
      console.log('Note: Could not stop file watching during cleanup');
    }

    await electronApp.close();

    // Cleanup temp directory
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15000 });

    // Log console messages for debugging
    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    // Capture page errors
    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');

    // Wait for cytoscape instance with retry logic
    try {
      await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
    } catch (error) {
      console.error('Failed to initialize cytoscape instance:', error);
      throw error;
    }

    await window.waitForTimeout(1000);

    await use(window);
  }
});

test.describe('Flush Editor Before Agent Spawn', () => {
  // Cleanup: Remove any created ctx-nodes after test
  test.afterEach(async () => {
    const ctxNodesDir = path.join(FIXTURE_VAULT_PATH, 'ctx-nodes');
    try {
      await fs.rm(ctxNodesDir, { recursive: true, force: true });
      console.log('[Cleanup] Removed ctx-nodes directory');
    } catch {
      // Directory might not exist, that's fine
    }
  });

  test('should include just-typed content in context node when Cmd+Enter pressed immediately after typing', async ({ appWindow }) => {
    test.setTimeout(60000); // 60 second timeout

    // Unique content to verify flush worked - include timestamp to avoid false positives
    const uniqueContent = `FLUSH_TEST_CONTENT_${Date.now()}`;
    const nodeId = '6_Personal_Logistics_and_Requests.md';

    console.log('=== STEP 1: Wait for auto-load to complete ===');
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) return 0;
        return cy.nodes().length;
      });
    }, {
      message: 'Waiting for graph to auto-load nodes',
      timeout: 15000,
      intervals: [500, 1000, 1000]
    }).toBeGreaterThan(0);

    console.log('✓ Graph auto-loaded with nodes');

    console.log('=== STEP 2: Verify node exists in graph ===');
    const nodeExists = await appWindow.evaluate((nId) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) return false;
      const node = cy.getElementById(nId);
      return node.length > 0;
    }, nodeId);

    expect(nodeExists).toBe(true);
    console.log(`✓ Node ${nodeId} exists in graph`);

    console.log('=== STEP 3: Click node to open editor ===');
    await appWindow.evaluate((nId) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const node = cy.getElementById(nId);
      if (node.length === 0) throw new Error(`${nId} node not found`);

      // Trigger tap event to open editor
      node.trigger('tap');
    }, nodeId);

    // Wait for editor window to appear in DOM
    const editorWindowId = `window-${nodeId}-editor`;
    const escapedEditorWindowId = editorWindowId.replace(/[./]/g, '\\$&');

    await expect.poll(async () => {
      return appWindow.evaluate((winId) => {
        const editorWindow = document.getElementById(winId);
        return editorWindow !== null;
      }, editorWindowId);
    }, {
      message: 'Waiting for editor window to appear',
      timeout: 5000
    }).toBe(true);

    console.log('✓ Editor window opened');

    // Wait for CodeMirror editor to render
    await appWindow.waitForSelector(`#${escapedEditorWindowId} .cm-editor`, { timeout: 5000 });
    console.log('✓ CodeMirror editor rendered');

    console.log('=== STEP 4: Type unique content into editor ===');
    // Append unique content to existing content
    await appWindow.evaluate(({ windowId, content }: { windowId: string; content: string }) => {
      const escapedWindowId = CSS.escape(windowId);
      const editorElement = document.querySelector(`#${escapedWindowId} .cm-content`) as HTMLElement | null;
      if (!editorElement) throw new Error('Editor content element not found');

      const cmView = (editorElement as CodeMirrorElement).cmView?.view;
      if (!cmView) throw new Error('CodeMirror view not found');

      // Append unique content at the end (before the links section)
      const currentContent = cmView.state.doc.toString();
      const newContent = currentContent.replace(
        /\n-+\n_Links:_/,
        `\n\n${content}\n\n-----------------\n_Links:_`
      );

      // IMPORTANT: Must include userEvent annotation to trigger onChange handler
      cmView.dispatch({
        changes: { from: 0, to: cmView.state.doc.length, insert: newContent },
        userEvent: 'input'
      });
    }, { windowId: editorWindowId, content: uniqueContent });

    console.log(`✓ Typed unique content: ${uniqueContent}`);

    // DO NOT WAIT - this is the key test: immediately trigger agent spawn
    // If we waited 300ms+, the debounced autosave would fire and the test wouldn't be testing the fix

    console.log('=== STEP 5: Immediately press Cmd+Enter (before 300ms debounce) ===');
    // First select the node (required for Cmd+Enter to work)
    await appWindow.evaluate((nId) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const node = cy.getElementById(nId);
      node.select();
    }, nodeId);

    // Press Cmd+Enter immediately
    await appWindow.keyboard.press('Meta+Enter');
    console.log('✓ Pressed Cmd+Enter');

    console.log('=== STEP 6: Wait for context node to be created ===');
    // The context node should be created in ctx-nodes directory
    const ctxNodesDir = path.join(FIXTURE_VAULT_PATH, 'ctx-nodes');

    // Poll for ctx-nodes directory and files to appear
    let contextNodePath: string | null = null;
    const maxAttempts = 30; // 15 seconds max wait
    let attempts = 0;

    while (attempts < maxAttempts && !contextNodePath) {
      try {
        const files = await fs.readdir(ctxNodesDir);
        const ctxNodeFiles = files.filter(f => f.endsWith('.md'));
        if (ctxNodeFiles.length > 0) {
          // Get the most recent file (in case there are old ones)
          contextNodePath = path.join(ctxNodesDir, ctxNodeFiles[ctxNodeFiles.length - 1]);
          console.log(`✓ Context node created: ${ctxNodeFiles[ctxNodeFiles.length - 1]}`);
        }
      } catch {
        // Directory doesn't exist yet
      }

      if (!contextNodePath) {
        attempts++;
        await appWindow.waitForTimeout(500);
      }
    }

    expect(contextNodePath).not.toBeNull();
    console.log(`✓ Found context node at: ${contextNodePath}`);

    console.log('=== STEP 7: Verify context node contains the just-typed content ===');
    // Read the context node file
    const contextNodeContent = await fs.readFile(contextNodePath!, 'utf-8');
    console.log('Context node content length:', contextNodeContent.length);

    // The context node should contain the unique content we typed
    // This proves the editor was flushed before context node creation
    const containsTypedContent = contextNodeContent.includes(uniqueContent);

    console.log('Context node contains typed content:', containsTypedContent);
    if (!containsTypedContent) {
      console.log('--- Context node content preview (first 2000 chars) ---');
      console.log(contextNodeContent.substring(0, 2000));
      console.log('--- End preview ---');
    }

    expect(containsTypedContent).toBe(true);
    console.log('✓ Context node contains the just-typed content!');

    console.log('');
    console.log('=== TEST SUMMARY ===');
    console.log('✓ Editor opened on node');
    console.log('✓ Unique content typed into editor');
    console.log('✓ Cmd+Enter pressed immediately (before 300ms debounce)');
    console.log('✓ Context node created');
    console.log('✓ Context node contains typed content (flush worked!)');
    console.log('');
    console.log('✅ FLUSH EDITOR BEFORE AGENT SPAWN TEST PASSED');
  });
});

export { test };
