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
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { EditorView } from '@codemirror/view';

// Use temp directory for this test
const PROJECT_ROOT = path.resolve(process.cwd());

// Type definitions
interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: {
    main: {
      startFileWatching: (dir: string) => Promise<{ success: boolean; directory?: string; error?: string }>;
      stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
      getWatchStatus: () => Promise<{ isWatching: boolean; directory?: string }>;
      getGraph: () => Promise<{ nodes: Record<string, unknown> } | undefined>;
    };
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
  testVaultPath: string;
}>({
  // Create temp userData directory with embedded vault + config
  // The config auto-loads the vault during app initialization
  // IMPORTANT: Files must be in {watchedFolder}/voicetree/ due to default vaultSuffix
  electronApp: [async ({}, use, testInfo) => {
    // Create temp userData directory
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-link-bug-test-'));

    // Create the watched folder (what config points to)
    const watchedFolder = path.join(tempUserDataPath, 'test-vault');
    await fs.mkdir(watchedFolder, { recursive: true });

    // Create the actual vault path with default suffix 'voicetree'
    // The app looks for .md files in {watchedFolder}/voicetree/
    const vaultPath = path.join(watchedFolder, 'voicetree');
    await fs.mkdir(vaultPath, { recursive: true });

    // Create test files that will be used by the tests
    // File names without vault prefix for filesystem operations
    // (Node IDs in the graph will have 'voicetree/' prefix)
    const testNodeFilename = 'test-node-with-link.md';
    const linkedNodeFilename = 'linked-node.md';
    const testNodeFilename2 = 'test-node-remove-link.md';
    const linkedNodeFilename2 = 'target-node.md';

    const initialContent = `---
---
# Test Node

This is a test node with a link to [[${linkedNodeFilename}]].

Some more content here.`;

    const initialContent2 = `---
---
# Test Node

This node has a link: [[${linkedNodeFilename2}]]

End of content.`;

    await fs.writeFile(path.join(vaultPath, testNodeFilename), initialContent, 'utf-8');
    await fs.writeFile(path.join(vaultPath, linkedNodeFilename), '---\n---\n# Linked Node\n\nThis is the linked node.', 'utf-8');
    await fs.writeFile(path.join(vaultPath, testNodeFilename2), initialContent2, 'utf-8');
    await fs.writeFile(path.join(vaultPath, linkedNodeFilename2), '---\n---\n# Target Node\n\nTarget.', 'utf-8');

    // Write config to auto-load the watched folder (vault = watchedFolder + 'voicetree')
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: watchedFolder }, null, 2), 'utf8');
    console.log('[Test] Watched folder:', watchedFolder);
    console.log('[Test] Vault path (with suffix):', vaultPath);

    // Store vaultPath for test access via testInfo (the actual path where .md files live)
    (testInfo as unknown as { vaultPath: string }).vaultPath = vaultPath;

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}` // Isolate test userData
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1'
      },
      timeout: 8000  // NO INCREASING, DO NOT RANDOMLY INTRODUCE HUGE TIMEOUTS INTO OUR TESTS. IF ITS TIMING OUT THERES PROBABLY A PROBLEM or we ARE TESTING BADLY

    });

    await use(electronApp);

    // Graceful shutdown
    try {
      const page = await electronApp.firstWindow();
      await page.evaluate(async () => {
        const api = (window as ExtendedWindow).electronAPI;
        if (api) {
          await api.main.stopFileWatching();
        }
      });
      await page.waitForTimeout(300);
    } catch {
      console.log('Note: Could not stop file watching during cleanup');
    }

    await electronApp.close();

    // Cleanup entire temp directory (includes vault)
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
    console.log('[Test] Cleaned up temp directory');
  }, { timeout: 45000 }],

  // Get vault path from testInfo (set by electronApp fixture)
  testVaultPath: async ({}, use, testInfo) => {
    // Wait for electronApp fixture to set vaultPath
    await use((testInfo as unknown as { vaultPath: string }).vaultPath);
  },

  appWindow: [async ({ electronApp, testVaultPath: _testVaultPath }, use) => {
    const page = await electronApp.firstWindow();

    // Log console messages
    page.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    page.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
      console.error('Stack:', error.stack);
    });

    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });

    // Check for errors before waiting for cytoscapeInstance
    const hasErrors = await page.evaluate(() => {
      const errors: string[] = [];
      // Check if React rendered
      if (!document.querySelector('#root')) errors.push('No #root element');
      // Check if any error boundaries triggered
      const errorText = document.body.textContent;
      if (errorText?.includes('Error') || errorText?.includes('error')) {
        errors.push(`Page contains error text: ${errorText.substring(0, 200)}`);
      }
      return errors;
    });

    if (hasErrors.length > 0) {
      console.error('Pre-initialization errors:', hasErrors);
    }

    await page.waitForFunction(() => (window as ExtendedWindow).cytoscapeInstance, { timeout: 30000 });

    // Wait for electronAPI to be available
    await page.waitForFunction(() => (window as ExtendedWindow).electronAPI?.main, { timeout: 30000 });
    await page.waitForTimeout(500); // Give extra time for auto-load to complete

    await use(page);
  }, { timeout: 30000 }]
});

test.describe('Link Duplication Bug', () => {
  test('should NOT duplicate links when editing markdown in floating editor', async ({ appWindow, testVaultPath }) => {
    test.setTimeout(60000); // Increase timeout to 60s for this test (has 5s wait)
    console.log('=== Testing link duplication bug ===');
    console.log('[Test] Vault path:', testVaultPath);

    // Files are already created in electronApp fixture
    // Node IDs include vaultSuffix prefix (e.g., 'voicetree/filename.md')
    const testNodeId = 'voicetree/test-node-with-link.md';
    const testFilePath = path.join(testVaultPath, 'test-node-with-link.md');

    // Vault is auto-loaded via config - wait for graph to have nodes
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return 0;
        return cy.nodes().length;
      });
    }, {
      message: 'Waiting for graph to load nodes (auto-loaded via config)',
      timeout: 15000
    }).toBeGreaterThan(0);

    console.log('✓ Graph loaded with nodes');

    // Wait for specific node to load in graph
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

    console.log('✓ Test node loaded in graph');

    // Wait for node to exist in main process graph (not just cytoscape UI)
    await expect.poll(async () => {
      return appWindow.evaluate(async (nId) => {
        const api = (window as ExtendedWindow).electronAPI;
        const graph = await api?.main.getGraph();
        if (!graph) return false;
        return nId in graph.nodes;
      }, testNodeId);
    }, {
      message: `Waiting for ${testNodeId} to exist in main process graph`,
      timeout: 10000
    }).toBe(true);

    console.log('✓ Node exists in main process graph');

    // 4. Open the floating editor by clicking the node
    await appWindow.evaluate((nId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById(nId);
      if (node.length === 0) throw new Error(`${nId} node not found`);
      node.trigger('tap');
    }, testNodeId);

    // Wait for editor window to appear
    // Window ID format is: window-${nodeId}-editor
    const editorWindowId = `window-${testNodeId}-editor`;
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
    const escapedEditorWindowId = editorWindowId.replace(/\./g, '\\.').replace(/\//g, '\\/');
    await appWindow.waitForSelector(`#${escapedEditorWindowId} .cm-editor`, { timeout: 5000 });
    console.log('✓ CodeMirror editor rendered');

    // 5. Read current file content to count initial link occurrences
    const contentBeforeEdit = await fs.readFile(testFilePath, 'utf-8');
    // Wikilinks use filename only, not the full node ID with vault prefix
    const linkPattern = new RegExp(`\\[\\[linked-node\\.md\\]\\]`, 'g');
    const initialLinkCount = (contentBeforeEdit.match(linkPattern) ?? []).length;
    console.log(`✓ Initial link count in file: ${initialLinkCount}`);

    // 6. Make a small edit (add text that doesn't touch the link)
    await appWindow.evaluate(({ windowId, insertText }: { windowId: string; insertText: string }) => {
      // Use CSS.escape to properly escape window ID for querySelector
      const escapedWindowId = CSS.escape(windowId);
      const editorElement = document.querySelector(`#${escapedWindowId} .cm-content`) as HTMLElement | null;
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
    const finalLinkCount = (contentAfterEdit.match(linkPattern) ?? []).length;

    console.log(`📊 Initial link count: ${initialLinkCount}`);
    console.log(`📊 Final link count: ${finalLinkCount}`);
    console.log('\nFile content after edit:');
    console.log('---START---');
    console.log(contentAfterEdit);
    console.log('---END---');

    // THE KEY ASSERTION: Link count should NOT have increased
    if (finalLinkCount > initialLinkCount) {
      console.error(`❌ BUG REPRODUCED: Link was duplicated ${finalLinkCount - initialLinkCount} time(s)!`);
      console.error(`Expected ${initialLinkCount} occurrences of [[linked-node.md]], but found ${finalLinkCount}`);
    } else {
      console.log(`✅ No link duplication detected (count stayed at ${initialLinkCount})`);
    }

    // This assertion will FAIL with the current buggy code
    expect(finalLinkCount).toBe(initialLinkCount);

    console.log('✓ Link duplication test completed');
  });

  test('should remove link from markdown file and graph when deleted in editor', async ({ appWindow, testVaultPath }) => {
    test.setTimeout(60000); // Increase timeout to 60s for this test (has 5s wait)
    console.log('=== Testing link removal behavior ===');
    console.log('[Test] Vault path:', testVaultPath);

    // Files are already created in electronApp fixture
    // Node IDs include vaultSuffix prefix (e.g., 'voicetree/filename.md')
    const testNodeId = 'voicetree/test-node-remove-link.md';
    const linkedNodeId = 'voicetree/target-node.md';
    const testFilePath = path.join(testVaultPath, 'test-node-remove-link.md');

    // Vault is auto-loaded via config - wait for graph to have nodes
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return 0;
        return cy.nodes().length;
      });
    }, {
      message: 'Waiting for graph to load nodes (auto-loaded via config)',
      timeout: 15000
    }).toBeGreaterThan(0);

    console.log('✓ Graph loaded with nodes');

    // Wait for specific node to load in graph
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

    console.log('✓ Test node loaded in graph');

    // Wait for node to exist in main process graph (not just cytoscape UI)
    await expect.poll(async () => {
      return appWindow.evaluate(async (nId) => {
        const api = (window as ExtendedWindow).electronAPI;
        const graph = await api?.main.getGraph();
        if (!graph) return false;
        return nId in graph.nodes;
      }, testNodeId);
    }, {
      message: `Waiting for ${testNodeId} to exist in main process graph`,
      timeout: 10000
    }).toBe(true);

    console.log('✓ Node exists in main process graph');

    // Verify edge exists in graph
    const edgeExistsInitially = await appWindow.evaluate(({ sourceId, targetId }) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return false;
      const edges = cy.edges(`[source = "${sourceId}"][target = "${targetId}"]`);
      return edges.length > 0;
    }, { sourceId: testNodeId, targetId: linkedNodeId });

    expect(edgeExistsInitially).toBe(true);
    console.log('✓ Edge exists in graph initially');

    // 4. Open the floating editor
    await appWindow.evaluate((nId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById(nId);
      if (node.length === 0) throw new Error(`${nId} node not found`);
      node.trigger('tap');
    }, testNodeId);

    // Window ID format is: window-${nodeId}-editor
    const editorWindowId = `window-${testNodeId}-editor`;
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
    const escapedEditorWindowId = editorWindowId.replace(/\./g, '\\.').replace(/\//g, '\\/');
    await appWindow.waitForSelector(`#${escapedEditorWindowId} .cm-editor`, { timeout: 5000 });
    console.log('✓ CodeMirror editor rendered');

    // 5. REMOVE the wikilink from the content
    await appWindow.evaluate(({ windowId }: { windowId: string }) => {
      // Use CSS.escape to properly escape window ID for querySelector
      const escapedWindowId = CSS.escape(windowId);
      const editorElement = document.querySelector(`#${escapedWindowId} .cm-content`) as HTMLElement | null;
      if (!editorElement) throw new Error('Editor content element not found');

      const cmView = (editorElement as CodeMirrorElement).cmView?.view;
      if (!cmView) throw new Error('CodeMirror view not found');

      // Get current content
      const currentContent = cmView.state.doc.toString();

      // Remove the wikilink (use filename only, not full node ID)
      const linkPattern = '[[target-node.md]]';
      const newContent = currentContent.replace(linkPattern, '');

      // Replace entire document
      cmView.dispatch({
        changes: { from: 0, to: cmView.state.doc.length, insert: newContent }
      });

      console.log('Removed wikilink from editor');
    }, { windowId: editorWindowId });

    console.log('✓ Removed wikilink from content in editor');

    // 6. Wait for auto-save and file watcher cycle
    await appWindow.waitForTimeout(500);
    console.log('✓ Waited for auto-save');

    // 7. Wait 3 seconds to let feedback loop manifest if bug exists
    console.log('⏳ Waiting 3 seconds to observe if link reappears...');
    await appWindow.waitForTimeout(3000);

    // 8. Read file content and verify link is GONE (not restored)
    const contentAfterEdit = await fs.readFile(testFilePath, 'utf-8');
    // Wikilinks use filename only, not the full node ID with vault prefix
    const linkPattern = new RegExp(`\\[\\[target-node\\.md\\]\\]`, 'g');
    const finalLinkCount = (contentAfterEdit.match(linkPattern) ?? []).length;

    console.log('\nFile content after link removal:');
    console.log('---START---');
    console.log(contentAfterEdit);
    console.log('---END---');

    console.log(`📊 Final link count: ${finalLinkCount}`);

    // THE KEY ASSERTION: Link should be REMOVED from markdown
    // When a link is deleted in the editor, it should be removed from the file
    // The file watcher will update the graph to remove the edge
    if (finalLinkCount === 0) {
      console.log(`✅ Link was removed from markdown as expected`);
    } else {
      console.error(`❌ UNEXPECTED: Expected link to be removed (count 0), but found ${finalLinkCount}`);
    }

    expect(finalLinkCount).toBe(0);

    // 9. Verify edge behavior in graph after link removal
    // Wait for file watcher to process the change and update the graph UI-edge
    console.log('⏳ Waiting for file watcher to update graph UI-edge...');
    await appWindow.waitForTimeout(5000);

    const edgeExistsAfterRemoval = await appWindow.evaluate(({ sourceId, targetId }) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return false;
      const edges = cy.edges(`[source = "${sourceId}"][target = "${targetId}"]`);
      return edges.length > 0;
    }, { sourceId: testNodeId, targetId: linkedNodeId });

    // EXPECTED BEHAVIOR: Edge should be removed from graph when link is removed from markdown
    // The file watcher parses the updated markdown and updates the graph
    // applyGraphDeltaToUI then removes edges that are no longer in outgoingEdges
    expect(edgeExistsAfterRemoval).toBe(false);
    console.log('✓ Edge was removed from graph as expected');

    console.log('✓ Link removal test completed');
  });
});

export { test };
