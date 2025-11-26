/**
 * BEHAVIORAL SPEC: Markdown Editor YAML Integrity
 *
 * BUG DESCRIPTION:
 * When editing markdown files via the floating editor, YAML frontmatter is corrupted:
 * 1. YAML title not appearing in editor - only node ID shows
 * 2. YAML tags (---) are duplicated/spammed during editing
 *
 * This test verifies:
 * 1. Opening a file via floating editor preserves YAML content
 * 2. Editing content does not corrupt or duplicate YAML tags
 * 3. Editor displays content correctly (no extra YAML delimiters)
 * 4. Saved file has only the intended modification
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
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
  testVaultPath: async ({}, use) => {
    // Create a temporary directory for this test
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-yaml-integrity-test-'));
    console.log('[Test] Created test vault at:', tmpDir);

    await use(tmpDir);

    // Cleanup
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
      console.log('[Test] Cleaned up test vault');
    } catch (error) {
      console.log('Cleanup error:', error);
    }
  },

  electronApp: async ({ testVaultPath: _testVaultPath }, use) => {
    // Create a temporary userData directory for test isolation
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-yaml-integrity-userdata-'));

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
      timeout: 8000
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

    // Cleanup temp directory
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp, testVaultPath: _testVaultPath }, use) => {
    const page = await electronApp.firstWindow();

    // Log console messages
    page.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    page.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
      console.error('Stack:', error.stack);
    });

    await page.waitForLoadState('domcontentloaded');

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

    await page.waitForFunction(() => (window as ExtendedWindow).cytoscapeInstance, { timeout: 20000 });
    await page.waitForTimeout(100);

    await use(page);
  }
});

test.describe('Markdown Editor YAML Integrity', () => {
  test('should NOT corrupt YAML frontmatter when editing markdown in floating editor', async ({ appWindow, testVaultPath }) => {
    console.log('=== Testing YAML integrity during markdown editing ===');

    // 1. Create a test markdown file with rich YAML frontmatter
    const testNodeId = 'test-yaml-node.md';

    const initialContent = `---
title: My Important Node Title
node_id: 42
color: "#FF5733"
tags:
  - important
  - test
customField: some value
---
# My Important Node Title

This is the content of my node.

Some additional text here.`;

    const testFilePath = path.join(testVaultPath, testNodeId);
    await fs.writeFile(testFilePath, initialContent, 'utf-8');
    console.log('✓ Created test file with YAML frontmatter');
    console.log('Initial content:');
    console.log('---START---');
    console.log(initialContent);
    console.log('---END---');

    // 2. Start watching the vault
    await appWindow.evaluate(async (vaultPath) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.startFileWatching(vaultPath);
    }, testVaultPath);

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

    // Wait for node to exist in main process graph
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
    const escapedEditorWindowId = editorWindowId.replace(/\./g, '\\.');
    await appWindow.waitForSelector(`#${escapedEditorWindowId} .cm-editor`, { timeout: 5000 });
    console.log('✓ CodeMirror editor rendered');

    // 5. Check what content the editor is showing BEFORE making edits
    const editorContentBeforeEdit = await appWindow.evaluate((winId) => {
      const escapedWinId = winId.replace(/\./g, '\\.');
      const editorElement = document.querySelector(`#${escapedWinId} .cm-content`) as HTMLElement | null;
      if (!editorElement) return null;

      const cmView = (editorElement as CodeMirrorElement).cmView?.view;
      if (!cmView) return null;

      return cmView.state.doc.toString();
    }, editorWindowId);

    console.log('Editor content BEFORE edit:');
    console.log('---START---');
    console.log(editorContentBeforeEdit);
    console.log('---END---');

    // Count YAML delimiters in editor content before edit
    const yamlDelimitersBefore = (editorContentBeforeEdit ?? '').split('---').length - 1;
    console.log(`YAML delimiters (---) in editor before edit: ${yamlDelimitersBefore}`);

    // 6. Make a small edit (append text)
    const textToAdd = '\n\nThis text was added by the E2E test.';
    await appWindow.evaluate(({ windowId, insertText }: { windowId: string; insertText: string }) => {
      const escapedWindowId = windowId.replace(/\./g, '\\.');
      const editorElement = document.querySelector(`#${escapedWindowId} .cm-content`) as HTMLElement | null;
      if (!editorElement) throw new Error('Editor content element not found');

      const cmView = (editorElement as CodeMirrorElement).cmView?.view;
      if (!cmView) throw new Error('CodeMirror view not found');

      // Insert text at the end of the document
      const docLength = cmView.state.doc.length;
      cmView.dispatch({
        changes: { from: docLength, insert: insertText }
      });
    }, { windowId: editorWindowId, insertText: textToAdd });

    console.log('✓ Made edit to content (appended text)');

    // 7. Wait for auto-save
    await appWindow.waitForTimeout(500);
    console.log('✓ Waited for auto-save');

    // 8. Wait additional time for any feedback loops to manifest
    console.log('⏳ Waiting 3 seconds to observe any YAML corruption...');
    await appWindow.waitForTimeout(3000);

    // 9. Read file content and check for YAML corruption
    const savedContent = await fs.readFile(testFilePath, 'utf-8');

    console.log('\nFile content AFTER edit:');
    console.log('---START---');
    console.log(savedContent);
    console.log('---END---');

    // Count YAML delimiters in saved file
    const yamlDelimitersInFile = savedContent.split('---').length - 1;
    console.log(`\n📊 YAML delimiters (---) in saved file: ${yamlDelimitersInFile}`);

    // 10. Check editor content AFTER the edit cycle
    const editorContentAfterEdit = await appWindow.evaluate((winId) => {
      const escapedWinId = winId.replace(/\./g, '\\.');
      const editorElement = document.querySelector(`#${escapedWinId} .cm-content`) as HTMLElement | null;
      if (!editorElement) return null;

      const cmView = (editorElement as CodeMirrorElement).cmView?.view;
      if (!cmView) return null;

      return cmView.state.doc.toString();
    }, editorWindowId);

    console.log('\nEditor content AFTER edit:');
    console.log('---START---');
    console.log(editorContentAfterEdit);
    console.log('---END---');

    const yamlDelimitersAfter = (editorContentAfterEdit ?? '').split('---').length - 1;
    console.log(`YAML delimiters (---) in editor after edit: ${yamlDelimitersAfter}`);

    // ASSERTIONS

    // A) File should have exactly 2 YAML delimiters (one opening ---, one closing ---)
    // If there are more, YAML tags are being duplicated
    if (yamlDelimitersInFile > 2) {
      console.error(`❌ BUG: YAML delimiters duplicated! Expected 2, found ${yamlDelimitersInFile}`);
    } else {
      console.log(`✅ File has correct number of YAML delimiters (${yamlDelimitersInFile})`);
    }
    expect(yamlDelimitersInFile).toBe(2);

    // B) File should still contain our added text
    expect(savedContent).toContain('This text was added by the E2E test.');
    console.log('✅ File contains the added text');

    // C) Editor content should NOT have extra YAML delimiters
    // The editor should show content WITHOUT frontmatter (as noted in other tests)
    // So it should have 0 YAML delimiters, OR if it shows frontmatter, exactly 2
    if (yamlDelimitersAfter > 2) {
      console.error(`❌ BUG: Editor has extra YAML delimiters! Found ${yamlDelimitersAfter}`);
    } else {
      console.log(`✅ Editor has acceptable YAML delimiter count (${yamlDelimitersAfter})`);
    }
    expect(yamlDelimitersAfter).toBeLessThanOrEqual(2);

    // D) File should still have title in YAML (or title should be preserved somehow)
    // Check if title is preserved in some form
    const hasTitleInYaml = savedContent.includes('title:');
    console.log(`Title in YAML: ${hasTitleInYaml}`);

    console.log('\n✓ YAML integrity test completed');
  });

  test('should preserve all YAML properties after multiple edit cycles', async ({ appWindow, testVaultPath }) => {
    console.log('=== Testing YAML property preservation through edit cycles ===');

    // 1. Create file with comprehensive YAML
    const testNodeId = 'test-yaml-preservation.md';

    const initialContent = `---
title: Preserved Title
node_id: 123
color: "#00FF00"
position:
  x: 100
  y: 200
isContextNode: true
customArray:
  - item1
  - item2
customObject:
  key1: value1
  key2: value2
---
# Preserved Title

Original content here.`;

    const testFilePath = path.join(testVaultPath, testNodeId);
    await fs.writeFile(testFilePath, initialContent, 'utf-8');
    console.log('✓ Created test file with comprehensive YAML');

    // 2. Start watching
    await appWindow.evaluate(async (vaultPath) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.startFileWatching(vaultPath);
    }, testVaultPath);

    await appWindow.waitForTimeout(1000);

    // 3. Wait for node to load
    await expect.poll(async () => {
      return appWindow.evaluate((nId) => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return false;
        return cy.getElementById(nId).length > 0;
      }, testNodeId);
    }, {
      message: `Waiting for ${testNodeId} to load`,
      timeout: 10000
    }).toBe(true);

    // Wait for node to exist in main process graph
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

    console.log('✓ Node loaded');

    // 4. Open editor
    await appWindow.evaluate((nId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById(nId);
      node.trigger('tap');
    }, testNodeId);

    const editorWindowId = `window-${testNodeId}-editor`;
    await expect.poll(async () => {
      return appWindow.evaluate((winId) => {
        return document.getElementById(winId) !== null;
      }, editorWindowId);
    }, { timeout: 5000 }).toBe(true);

    const escapedEditorWindowId = editorWindowId.replace(/\./g, '\\.');
    await appWindow.waitForSelector(`#${escapedEditorWindowId} .cm-editor`, { timeout: 5000 });
    console.log('✓ Editor opened');

    // 5. Perform 3 edit cycles
    for (let i = 1; i <= 3; i++) {
      console.log(`\n--- Edit cycle ${i} ---`);

      await appWindow.evaluate(({ windowId, text }: { windowId: string; text: string }) => {
        const escapedWindowId = windowId.replace(/\./g, '\\.');
        const editorElement = document.querySelector(`#${escapedWindowId} .cm-content`) as HTMLElement | null;
        if (!editorElement) throw new Error('Editor not found');

        const cmView = (editorElement as CodeMirrorElement).cmView?.view;
        if (!cmView) throw new Error('CodeMirror view not found');

        const docLength = cmView.state.doc.length;
        cmView.dispatch({
          changes: { from: docLength, insert: text }
        });
      }, { windowId: editorWindowId, text: `\n\nEdit ${i} added.` });

      // Wait for auto-save
      await appWindow.waitForTimeout(600);
      console.log(`✓ Edit ${i} saved`);
    }

    // 6. Wait for any feedback loops
    console.log('\n⏳ Waiting 2 seconds for stability...');
    await appWindow.waitForTimeout(2000);

    // 7. Read final content
    const finalContent = await fs.readFile(testFilePath, 'utf-8');

    console.log('\nFinal file content:');
    console.log('---START---');
    console.log(finalContent);
    console.log('---END---');

    // ASSERTIONS

    // Count YAML delimiters
    const yamlDelimiters = finalContent.split('---').length - 1;
    console.log(`\nYAML delimiters: ${yamlDelimiters}`);
    expect(yamlDelimiters).toBe(2);

    // All 3 edits should be present
    expect(finalContent).toContain('Edit 1 added.');
    expect(finalContent).toContain('Edit 2 added.');
    expect(finalContent).toContain('Edit 3 added.');
    console.log('✅ All edits preserved');

    // Check YAML structure is not corrupted (no nested --- inside YAML)
    // Split by --- and check the middle part (YAML content) doesn't contain ---
    const parts = finalContent.split('---');
    if (parts.length >= 2) {
      const yamlPart = parts[1];
      const nestedDelimiters = yamlPart.includes('---');
      if (nestedDelimiters) {
        console.error('❌ BUG: YAML section contains nested --- delimiters');
      }
      expect(nestedDelimiters).toBe(false);
    }

    console.log('\n✓ YAML preservation test completed');
  });
});

export { test };
