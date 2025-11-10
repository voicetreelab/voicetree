/**
 * BEHAVIORAL SPEC: Link Duplication Feedback Loop Bug
 *
 * BUG DESCRIPTION:
 * When editing a markdown file with a link in the floating editor, the link gets duplicated
 * in a feedback loop:
 * 1. User edits content with [[link]] → saves to file
 * 2. fromNodeToMarkdownContent appends outgoingEdges as wikilinks
 * 3. Content already has [[link]], and appending adds another [[link]]
 * 4. File watcher detects change → parses two [[link]]s
 * 5. Graph delta updates editor → editor saves again → adds two more links
 * 6. Infinite loop!
 *
 * ROOT CAUSE:
 * - fromNodeToMarkdownContent (node_to_markdown.ts:29-32) appends outgoingEdges as wikilinks
 * - But the content already contains these links (markdown is source of truth)
 * - This violates the principle: "MARKDOWN IS SOURCE OF TRUTH FOR EDGES"
 *
 * This test reproduces the bug by:
 * 1. Creating a node with a link in content
 * 2. Opening floating editor
 * 3. Making a small edit
 * 4. Waiting 5 seconds
 * 5. Verifying link count hasn't increased (test should FAIL with current code)
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { EditorView } from '@codemirror/view';

// Use temp directory for this test
const PROJECT_ROOT = path.resolve(process.cwd());
const TEST_VAULT_PATH = path.join(PROJECT_ROOT, 'tests', 'fixtures', 'temp-link-bug-test');

// Type definitions
interface ExtendedWindow extends Window {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: {
    startFileWatching: (dir: string) => Promise<{ success: boolean; directory?: string; error?: string }>;
    stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
    getWatchStatus: () => Promise<{ isWatching: boolean; directory?: string }>;
  };
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
    const electronApp = await electron.launch({
      args: [path.join(PROJECT_ROOT, 'dist-electron/main/index.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1'
      }
    });

    await use(electronApp);

    // Graceful shutdown
    try {
      const page = await electronApp.firstWindow();
      await page.evaluate(async () => {
        const api = (window as ExtendedWindow).electronAPI;
        if (api) {
          await api.stopFileWatching();
        }
      });
      await page.waitForTimeout(300);
    } catch {
      console.log('Note: Could not stop file watching during cleanup');
    }

    await electronApp.close();
  },

  appWindow: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();

    // Log console messages
    page.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    page.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => (window as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
    await page.waitForTimeout(1000);

    await use(page);
  }
});

test.describe('Link Duplication Bug', () => {
  test.beforeEach(async () => {
    // Create temp test directory
    await fs.mkdir(TEST_VAULT_PATH, { recursive: true });
  });

  test.afterEach(async ({ appWindow }) => {
    // Stop file watching before cleanup
    try {
      await appWindow.evaluate(async () => {
        const api = (window as ExtendedWindow).electronAPI;
        if (api) {
          await api.stopFileWatching();
        }
      });
      await appWindow.waitForTimeout(200);
    } catch {
      // Window might be closed
    }

    // Clean up test directory
    try {
      await fs.rm(TEST_VAULT_PATH, { recursive: true, force: true });
    } catch (error) {
      console.log('Cleanup error:', error);
    }
  });

  test('should NOT duplicate links when editing markdown in floating editor', async ({ appWindow }) => {
    console.log('=== Testing link duplication bug ===');

    // 1. Create a test markdown file with a link
    const testNodeId = 'test-node-with-link';
    const linkedNodeId = 'linked-node';

    const initialContent = `---
---
# Test Node

This is a test node with a link to [[${linkedNodeId}]].

Some more content here.`;

    const testFilePath = path.join(TEST_VAULT_PATH, `${testNodeId}.md`);
    await fs.writeFile(testFilePath, initialContent, 'utf-8');
    console.log('✓ Created test file with link');

    // Create the linked node too (so the link is valid)
    const linkedFilePath = path.join(TEST_VAULT_PATH, `${linkedNodeId}.md`);
    await fs.writeFile(linkedFilePath, '---\n---\n# Linked Node\n\nThis is the linked node.', 'utf-8');
    console.log('✓ Created linked node file');

    // 2. Start watching the vault
    await appWindow.evaluate(async (vaultPath) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.startFileWatching(vaultPath);
    }, TEST_VAULT_PATH);

    await appWindow.waitForTimeout(1000);
    console.log('✓ Started file watching');

    // 3. Wait for node to load in graph
    await expect.poll(async () => {
      return appWindow.evaluate((nId) => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return false;
        return cy.getElementById(nId).length > 0;
      }, testNodeId);
    }, {
      message: `Waiting for ${testNodeId} node to load`,
      timeout: 10000
    }).toBe(true);

    console.log('✓ Node loaded in graph');

    // 4. Open the floating editor by clicking the node
    await appWindow.evaluate((nId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById(nId);
      if (node.length === 0) throw new Error(`${nId} node not found`);
      node.trigger('tap');
    }, testNodeId);

    // Wait for editor window to appear
    const editorWindowId = `window-editor-${testNodeId}`;
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

    // Wait for CodeMirror to render
    await appWindow.waitForSelector(`#${editorWindowId} .cm-editor`, { timeout: 5000 });
    console.log('✓ CodeMirror editor rendered');

    // 5. Read current file content to count initial link occurrences
    const contentBeforeEdit = await fs.readFile(testFilePath, 'utf-8');
    const linkPattern = new RegExp(`\\[\\[${linkedNodeId}\\]\\]`, 'g');
    const initialLinkCount = (contentBeforeEdit.match(linkPattern) || []).length;
    console.log(`✓ Initial link count in file: ${initialLinkCount}`);

    // 6. Make a small edit (add text that doesn't touch the link)
    await appWindow.evaluate(({ windowId, insertText }: { windowId: string; insertText: string }) => {
      const editorElement = document.querySelector(`#${windowId} .cm-content`) as HTMLElement | null;
      if (!editorElement) throw new Error('Editor content element not found');

      const cmView = (editorElement as CodeMirrorElement).cmView?.view;
      if (!cmView) throw new Error('CodeMirror view not found');

      // Insert text at the end of the document
      const docLength = cmView.state.doc.length;
      cmView.dispatch({
        changes: { from: docLength, insert: `\n\n${insertText}` }
      });
    }, { windowId: editorWindowId, insertText: 'This is an edit that should not duplicate the link.' });

    console.log('✓ Made edit to content');

    // 7. Wait for auto-save and file watcher cycle
    await appWindow.waitForTimeout(500);
    console.log('✓ Waited for auto-save');

    // 8. Wait 5 seconds to let any feedback loops manifest
    console.log('⏳ Waiting 5 seconds to observe potential feedback loop...');
    await appWindow.waitForTimeout(5000);

    // 9. Read file content and count link occurrences
    const contentAfterEdit = await fs.readFile(testFilePath, 'utf-8');
    const finalLinkCount = (contentAfterEdit.match(linkPattern) || []).length;

    console.log(`📊 Initial link count: ${initialLinkCount}`);
    console.log(`📊 Final link count: ${finalLinkCount}`);
    console.log('\nFile content after edit:');
    console.log('---START---');
    console.log(contentAfterEdit);
    console.log('---END---');

    // THE KEY ASSERTION: Link count should NOT have increased
    if (finalLinkCount > initialLinkCount) {
      console.error(`❌ BUG REPRODUCED: Link was duplicated ${finalLinkCount - initialLinkCount} time(s)!`);
      console.error(`Expected ${initialLinkCount} occurrences of [[${linkedNodeId}]], but found ${finalLinkCount}`);
    } else {
      console.log(`✅ No link duplication detected (count stayed at ${initialLinkCount})`);
    }

    // This assertion will FAIL with the current buggy code
    expect(finalLinkCount).toBe(initialLinkCount);

    console.log('✓ Link duplication test completed');
  });
});

export { test };
