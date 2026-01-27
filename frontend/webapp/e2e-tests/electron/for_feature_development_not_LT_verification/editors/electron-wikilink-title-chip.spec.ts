/**
 * Test: Wikilink Title Chip Display
 *
 * Verifies the wikilink title chip feature works correctly:
 * 1. Creates a vault with a parent node containing a wikilink [[child-node]]
 * 2. Creates a child node that the wikilink resolves to
 * 3. Opens the parent editor and takes a screenshot showing the title chip
 * 4. Types text to verify no flickering/cursor issues
 *
 * The implementation uses Mark decorations + CSS ::after for stable cursor behavior.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore, NodeSingular } from 'cytoscape';
import type { EditorView } from '@codemirror/view';
import type { ElectronAPI } from '@/shell/electron';

const PROJECT_ROOT = path.resolve(process.cwd());

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

interface CodeMirrorElement extends HTMLElement {
  cmView?: { view: EditorView };
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  testVaultPath: string;
  screenshotsDir: string;
}>({
  // Create temp userData directory with embedded vault + config
  electronApp: async ({}, use, testInfo) => {
    // Create temp userData directory
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-wikilink-chip-'));

    // Create the watched folder (what config points to)
    const watchedFolder = path.join(tempUserDataPath, 'test-vault');
    await fs.mkdir(watchedFolder, { recursive: true });

    // Create the actual vault path with default suffix 'voicetree'
    const vaultPath = path.join(watchedFolder, 'voicetree');
    await fs.mkdir(vaultPath, { recursive: true });

    // Create a child node first (so the wikilink can resolve to it)
    const childContent = '# My Child Node\n\nThis is the child node with a title.';
    await fs.writeFile(path.join(vaultPath, 'child-node.md'), childContent, 'utf-8');

    // Create a parent node with a wikilink to the child
    const parentContent = '# Parent Node\n\nThis node links to [[child-node.md]].\n\nMore content here.';
    await fs.writeFile(path.join(vaultPath, 'parent.md'), parentContent, 'utf-8');

    // Create projects.json with a pre-saved project (required for project selection)
    const projectsPath = path.join(tempUserDataPath, 'projects.json');
    const savedProject = {
      id: 'wikilink-chip-test-project',
      path: watchedFolder,
      name: 'test-vault',
      type: 'folder',
      lastOpened: Date.now(),
      voicetreeInitialized: true
    };
    await fs.writeFile(projectsPath, JSON.stringify([savedProject], null, 2), 'utf8');

    // Write legacy config for backwards compatibility
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: watchedFolder }, null, 2), 'utf8');
    console.log('[Test] Watched folder:', watchedFolder);
    console.log('[Test] Vault path (with suffix):', vaultPath);

    // Store vaultPath for test access
    (testInfo as unknown as { vaultPath: string }).vaultPath = vaultPath;

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
        VOICETREE_PERSIST_STATE: '1'
      },
      timeout: 30000
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
      console.log('[Test] Could not stop file watching during cleanup');
    }

    await electronApp.close();
    console.log('[Test] Electron app closed');

    // Cleanup entire temp directory
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
    console.log('[Test] Cleaned up temp directory');
  },

  testVaultPath: async ({}, use, testInfo) => {
    await use((testInfo as unknown as { vaultPath: string }).vaultPath);
  },

  screenshotsDir: async ({}, use) => {
    const dir = path.join(PROJECT_ROOT, 'e2e-tests/screenshots/wikilink-title-chip');
    await fs.mkdir(dir, { recursive: true });
    await use(dir);
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();

    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded', { timeout: 60000 });

    // Wait for project selection screen
    await window.waitForSelector('text=VoiceTree', { timeout: 10000 });
    console.log('[Test] Project selection screen loaded');

    // Wait for saved projects and click the test project
    await window.waitForSelector('text=Recent Projects', { timeout: 10000 });
    console.log('[Test] Recent Projects section visible');

    // Click the saved project to navigate to graph view
    const projectButton = window.locator('button:has-text("test-vault")').first();
    await projectButton.click();
    console.log('[Test] Clicked project to navigate to graph view');

    // Wait for graph view to load
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 20000 });
    await window.waitForTimeout(500); // Give extra time for auto-load to complete

    await use(window);
  }
});

test.describe('Wikilink Title Chip Display', () => {
  test('should display title chip for resolved wikilinks and allow stable typing', async ({ appWindow, screenshotsDir }) => {
    test.setTimeout(120000);
    console.log('=== Testing wikilink title chip display ===');

    // Wait for graph to have nodes
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return 0;
        return cy.nodes().length;
      });
    }, {
      message: 'Waiting for graph to load nodes',
      timeout: 15000
    }).toBeGreaterThanOrEqual(2);

    console.log('[Test] Graph loaded with nodes');

    // Verify nodes exist
    const initialState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return {
        nodeCount: cy.nodes().length,
        nodes: cy.nodes().map((n: NodeSingular) => ({ id: n.id(), label: n.data('label') }))
      };
    });

    console.log('[Test] Initial state:', JSON.stringify(initialState, null, 2));

    // Find parent and child nodes by their labels (more reliable than hardcoded IDs)
    const parentNode = initialState.nodes.find(n => n.label === 'Parent Node');
    const childNode = initialState.nodes.find(n => n.label === 'My Child Node');
    expect(parentNode).toBeDefined();
    expect(childNode).toBeDefined();
    console.log('[Test] Parent node ID:', parentNode?.id);
    console.log('[Test] Child node ID:', childNode?.id);

    const parentNodeId = parentNode!.id;

    // Screenshot 1: Initial graph state
    await appWindow.screenshot({ path: path.join(screenshotsDir, '1-initial-graph.png') });
    console.log('[Test] Screenshot 1: Initial graph');

    // Open parent editor by clicking the node
    await appWindow.evaluate((nodeId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById(nodeId);
      if (node.length === 0) throw new Error('Parent node not found');
      node.trigger('tap');
    }, parentNodeId);

    // Wait for editor to open
    const editorWindowId = `window-${parentNodeId}-editor`;

    await expect.poll(async () => {
      return appWindow.evaluate((winId) => {
        return document.getElementById(winId) !== null;
      }, editorWindowId);
    }, { message: 'Waiting for editor', timeout: 5000 }).toBe(true);

    // Use evaluate to find editor since ID may have special chars
    await appWindow.waitForFunction((winId) => {
      const el = document.getElementById(winId);
      return el && el.querySelector('.cm-editor') !== null;
    }, editorWindowId, { timeout: 5000 });
    console.log('[Test] Parent editor opened');

    // Wait for wikilink title chip to render
    // The chip is rendered via CSS ::after on elements with class .cm-wikilink-title
    await appWindow.waitForTimeout(500); // Allow time for decorations to render

    // Screenshot 2: Editor with wikilink (before checking chip)
    await appWindow.screenshot({ path: path.join(screenshotsDir, '2-editor-opened.png') });
    console.log('[Test] Screenshot 2: Editor opened');

    // Check if title chip element exists with the right data attribute
    const chipInfo = await appWindow.evaluate((winId) => {
      const editorWindow = document.getElementById(winId);
      if (!editorWindow) return { found: false, reason: 'No editor window found' };

      const editor = editorWindow.querySelector('.cm-editor');
      if (!editor) return { found: false, reason: 'No editor found' };

      // Look for the wikilink title element
      const wikilinkTitle = editor.querySelector('.cm-wikilink-title');
      if (!wikilinkTitle) return { found: false, reason: 'No .cm-wikilink-title element found' };

      const title = wikilinkTitle.getAttribute('data-title');
      const nodeId = wikilinkTitle.getAttribute('data-node-id');

      // Check computed styles to verify CSS is working
      const computedStyle = window.getComputedStyle(wikilinkTitle, '::after');
      const content = computedStyle.content;

      return {
        found: true,
        title,
        nodeId,
        afterContent: content,
        element: wikilinkTitle.outerHTML
      };
    }, editorWindowId);

    console.log('[Test] Chip info:', JSON.stringify(chipInfo, null, 2));

    // Verify the wikilink title chip is present
    expect(chipInfo.found).toBe(true);
    expect(chipInfo.title).toBe('My Child Node'); // Title from the child node's # heading

    // Screenshot 3: Editor with title chip
    await appWindow.screenshot({ path: path.join(screenshotsDir, '3-editor-with-title-chip.png') });
    console.log('[Test] Screenshot 3: Editor with title chip');

    // Test typing to verify no flickering/cursor issues
    console.log('[Test] Testing typing stability...');

    // Click at the end of the first line to position cursor
    await appWindow.evaluate((winId) => {
      const editorWindow = document.getElementById(winId);
      if (!editorWindow) throw new Error('Editor window not found');
      const editorElement = editorWindow.querySelector('.cm-content') as CodeMirrorElement | null;
      if (!editorElement) throw new Error('Editor not found');
      const cmView = editorElement.cmView?.view;
      if (!cmView) throw new Error('CodeMirror view not found');

      // Position cursor at end of document
      const doc = cmView.state.doc;
      cmView.dispatch({
        selection: { anchor: doc.length }
      });
      cmView.focus();
    }, editorWindowId);

    // Type some text
    const testText = '\n\nTyping test: The cursor should remain stable.';
    await appWindow.evaluate((args) => {
      const { winId, text } = args;
      const editorWindow = document.getElementById(winId);
      if (!editorWindow) throw new Error('Editor window not found');
      const editorElement = editorWindow.querySelector('.cm-content') as CodeMirrorElement | null;
      if (!editorElement) throw new Error('Editor not found');
      const cmView = editorElement.cmView?.view;
      if (!cmView) throw new Error('CodeMirror view not found');

      // Insert text at cursor position
      const cursor = cmView.state.selection.main.head;
      cmView.dispatch({
        changes: { from: cursor, insert: text },
        selection: { anchor: cursor + text.length },
        userEvent: 'input'
      });
    }, { winId: editorWindowId, text: testText });

    await appWindow.waitForTimeout(500);

    // Screenshot 4: After typing
    await appWindow.screenshot({ path: path.join(screenshotsDir, '4-after-typing.png') });
    console.log('[Test] Screenshot 4: After typing');

    // Verify content was added correctly
    const contentAfterTyping = await appWindow.evaluate((winId) => {
      const editorWindow = document.getElementById(winId);
      if (!editorWindow) return null;
      const editorElement = editorWindow.querySelector('.cm-content') as CodeMirrorElement | null;
      if (!editorElement) return null;
      const cmView = editorElement.cmView?.view;
      if (!cmView) return null;
      return cmView.state.doc.toString();
    }, editorWindowId);

    console.log('[Test] Content after typing:', contentAfterTyping);
    expect(contentAfterTyping).toContain('Typing test: The cursor should remain stable.');
    expect(contentAfterTyping).toContain('[[child-node.md]]'); // Wikilink preserved

    // Verify title chip is still present after typing
    const chipInfoAfterTyping = await appWindow.evaluate((winId) => {
      const editorWindow = document.getElementById(winId);
      if (!editorWindow) return { found: false };
      const editor = editorWindow.querySelector('.cm-editor');
      if (!editor) return { found: false };
      const wikilinkTitle = editor.querySelector('.cm-wikilink-title');
      return {
        found: !!wikilinkTitle,
        title: wikilinkTitle?.getAttribute('data-title')
      };
    }, editorWindowId);

    console.log('[Test] Chip info after typing:', JSON.stringify(chipInfoAfterTyping, null, 2));
    expect(chipInfoAfterTyping.found).toBe(true);
    expect(chipInfoAfterTyping.title).toBe('My Child Node');

    // Screenshot 5: Final state
    await appWindow.screenshot({ path: path.join(screenshotsDir, '5-final-state.png') });
    console.log('[Test] Screenshot 5: Final state');

    console.log('=== Test completed successfully ===');
    console.log(`Screenshots saved to: ${screenshotsDir}`);
  });

  test('should show raw ID when cursor is inside wikilink (editing mode)', async ({ appWindow, screenshotsDir }) => {
    test.setTimeout(120000);
    console.log('=== Testing wikilink editing mode ===');

    // Wait for graph to load
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return 0;
        return cy.nodes().length;
      });
    }, { timeout: 15000 }).toBeGreaterThanOrEqual(2);

    // Find parent node ID dynamically
    const parentNodeId = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const parentNode = cy.nodes().filter((n: NodeSingular) => n.data('label') === 'Parent Node').first();
      if (parentNode.empty()) throw new Error('Parent node not found');
      return parentNode.id();
    });

    console.log('[Test] Parent node ID:', parentNodeId);

    // Open parent editor
    await appWindow.evaluate((nodeId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById(nodeId);
      node.trigger('tap');
    }, parentNodeId);

    const editorWindowId = `window-${parentNodeId}-editor`;

    // Wait for editor to open
    await appWindow.waitForFunction((winId) => {
      const el = document.getElementById(winId);
      return el && el.querySelector('.cm-editor') !== null;
    }, editorWindowId, { timeout: 5000 });
    await appWindow.waitForTimeout(500);

    // Verify chip is showing (cursor not inside wikilink)
    const chipBeforeEdit = await appWindow.evaluate((winId) => {
      const editorWindow = document.getElementById(winId);
      if (!editorWindow) return { found: false, hasEditingClass: false };
      const editor = editorWindow.querySelector('.cm-editor');
      if (!editor) return { found: false, hasEditingClass: false };
      const wikilinkTitle = editor.querySelector('.cm-wikilink-title');
      return {
        found: !!wikilinkTitle,
        hasEditingClass: wikilinkTitle?.classList.contains('cm-wikilink-editing') ?? false
      };
    }, editorWindowId);

    console.log('[Test] Before moving cursor into wikilink:', chipBeforeEdit);
    expect(chipBeforeEdit.found).toBe(true);
    expect(chipBeforeEdit.hasEditingClass).toBe(false);

    // Screenshot: chip visible
    await appWindow.screenshot({ path: path.join(screenshotsDir, '6-chip-visible-mode.png') });

    // Move cursor inside the wikilink
    await appWindow.evaluate((winId) => {
      const editorWindow = document.getElementById(winId);
      if (!editorWindow) throw new Error('Editor window not found');
      const editorElement = editorWindow.querySelector('.cm-content') as CodeMirrorElement | null;
      if (!editorElement) throw new Error('Editor not found');
      const cmView = editorElement.cmView?.view;
      if (!cmView) throw new Error('CodeMirror view not found');

      // Find the wikilink in the content and position cursor inside
      const content = cmView.state.doc.toString();
      const wikilinkMatch = content.match(/\[\[([^\]]+)\]\]/);
      if (!wikilinkMatch || wikilinkMatch.index === undefined) {
        throw new Error('Wikilink not found in content');
      }

      // Position cursor inside the wikilink (after [[)
      const cursorPos = wikilinkMatch.index + 3; // After [[ and first char
      cmView.dispatch({
        selection: { anchor: cursorPos }
      });
      cmView.focus();
    }, editorWindowId);

    await appWindow.waitForTimeout(300);

    // Verify editing class is now present
    const chipDuringEdit = await appWindow.evaluate((winId) => {
      const editorWindow = document.getElementById(winId);
      if (!editorWindow) return { found: false, hasEditingClass: false };
      const editor = editorWindow.querySelector('.cm-editor');
      if (!editor) return { found: false, hasEditingClass: false };
      const wikilinkTitle = editor.querySelector('.cm-wikilink-title');
      return {
        found: !!wikilinkTitle,
        hasEditingClass: wikilinkTitle?.classList.contains('cm-wikilink-editing') ?? false
      };
    }, editorWindowId);

    console.log('[Test] With cursor inside wikilink:', chipDuringEdit);
    expect(chipDuringEdit.found).toBe(true);
    expect(chipDuringEdit.hasEditingClass).toBe(true);

    // Screenshot: editing mode (should show raw ID)
    await appWindow.screenshot({ path: path.join(screenshotsDir, '7-editing-mode-raw-id.png') });

    console.log('=== Editing mode test completed ===');
  });
});

export { test };
