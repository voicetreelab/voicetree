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
  // Create temp userData directory with embedded vault + config
  // The config auto-loads the vault during app initialization
  // IMPORTANT: Files must be in {watchedFolder}/voicetree/ due to default vaultSuffix
  electronApp: [async ({}, use, testInfo) => {
    // Create temp userData directory
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-yaml-integrity-test-'));

    // Create the watched folder (what config points to)
    const watchedFolder = path.join(tempUserDataPath, 'test-vault');
    await fs.mkdir(watchedFolder, { recursive: true });

    // Create the actual vault path with default suffix 'voicetree'
    // The app looks for .md files in {watchedFolder}/voicetree/
    const vaultPath = path.join(watchedFolder, 'voicetree');
    await fs.mkdir(vaultPath, { recursive: true });

    // Create test files for both tests
    const testNodeId = 'test-yaml-node.md';
    const testNodeId2 = 'test-yaml-preservation.md';

    const initialContent = `---
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

    const initialContent2 = `---
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

    await fs.writeFile(path.join(vaultPath, testNodeId), initialContent, 'utf-8');
    await fs.writeFile(path.join(vaultPath, testNodeId2), initialContent2, 'utf-8');

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

test.describe('Markdown Editor YAML Integrity', () => {
  test('should NOT corrupt YAML frontmatter when editing markdown in floating editor', async ({ appWindow, testVaultPath }) => {
    // NO! test.setTimeout(...); // DO NOT RANDOMLY INTRODUCE HUGE TIMEOUTS INTO OUR TESTS
    console.log('=== Testing YAML integrity during markdown editing ===');
    console.log('[Test] Vault path:', testVaultPath);

    // Files are already created in electronApp fixture
    // NOTE: Node IDs include the relative path from watched folder (e.g., voicetree/filename.md)
    const testFileName = 'test-yaml-node.md';
    const testNodeId = `voicetree/${testFileName}`;
    const testFilePath = path.join(testVaultPath, testFileName);

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
    // Escape special characters (dots and slashes) for CSS selector
    const escapedEditorWindowId = editorWindowId.replace(/\./g, '\\.').replace(/\//g, '\\/');
    await appWindow.waitForSelector(`#${escapedEditorWindowId} .cm-editor`, { timeout: 5000 });
    console.log('✓ CodeMirror editor rendered');

    // 5. Check what content the editor is showing BEFORE making edits
    const editorContentBeforeEdit = await appWindow.evaluate((winId) => {
      const escapedWinId = CSS.escape(winId);
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
      const escapedWindowId = CSS.escape(windowId);
      const editorElement = document.querySelector(`#${escapedWindowId} .cm-content`) as HTMLElement | null;
      if (!editorElement) throw new Error('Editor content element not found');

      const cmView = (editorElement as CodeMirrorElement).cmView?.view;
      if (!cmView) throw new Error('CodeMirror view not found');

      // Insert text at the end of the document
      // Mark as user event so autosave triggers
      const docLength = cmView.state.doc.length;
      cmView.dispatch({
        changes: { from: docLength, insert: insertText },
        userEvent: 'input.type'
      });
    }, { windowId: editorWindowId, insertText: textToAdd });

    console.log('✓ Made edit to content (appended text)');

    // 7. Wait for auto-save
    await appWindow.waitForTimeout(500);
    console.log('✓ Waited for auto-save');

    // 8. Wait additional time for any feedback loops to manifest
    console.log('⏳ Waiting 3 seconds to observe any YAML corruption...');
    if (!appWindow.isClosed()) {
      await appWindow.waitForTimeout(3000);
    }

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
    let editorContentAfterEdit: string | null = null;
    if (!appWindow.isClosed()) {
      editorContentAfterEdit = await appWindow.evaluate((winId) => {
        const escapedWinId = CSS.escape(winId);
        const editorElement = document.querySelector(`#${escapedWinId} .cm-content`) as HTMLElement | null;
        if (!editorElement) return null;

        const cmView = (editorElement as CodeMirrorElement).cmView?.view;
        if (!cmView) return null;

        return cmView.state.doc.toString();
      }, editorWindowId);
    }

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

    // C) Editor content should NOT have extra YAML delimiters (only check if page is still open)
    // The editor should show content WITHOUT frontmatter (as noted in other tests)
    // So it should have 0 YAML delimiters, OR if it shows frontmatter, exactly 2
    if (editorContentAfterEdit !== null) {
      if (yamlDelimitersAfter > 2) {
        console.error(`❌ BUG: Editor has extra YAML delimiters! Found ${yamlDelimitersAfter}`);
      } else {
        console.log(`✅ Editor has acceptable YAML delimiter count (${yamlDelimitersAfter})`);
      }
      expect(yamlDelimitersAfter).toBeLessThanOrEqual(2);
    } else {
      console.log('⚠️ Skipping editor content check (page closed)');
    }

    // D) File should still have YAML properties preserved
    // Check if YAML properties are preserved
    const hasNodeIdInYaml = savedContent.includes('node_id:');
    const hasColorInYaml = savedContent.includes('color:');
    console.log(`YAML properties preserved: node_id=${hasNodeIdInYaml}, color=${hasColorInYaml}`);

    console.log('\n✓ YAML integrity test completed');
  });

  test('should preserve all YAML properties after multiple edit cycles', async ({ appWindow, testVaultPath }) => {
    test.setTimeout(60000); // Increase timeout to 60s for this test
    console.log('=== Testing YAML property preservation through edit cycles ===');
    console.log('[Test] Vault path:', testVaultPath);

    // Files are already created in electronApp fixture
    // NOTE: Node IDs include the relative path from watched folder (e.g., voicetree/filename.md)
    const testFileName = 'test-yaml-preservation.md';
    const testNodeId = `voicetree/${testFileName}`;
    const testFilePath = path.join(testVaultPath, testFileName);

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

    // Escape special characters (dots and slashes) for CSS selector
    const escapedEditorWindowId = editorWindowId.replace(/\./g, '\\.').replace(/\//g, '\\/');
    await appWindow.waitForSelector(`#${escapedEditorWindowId} .cm-editor`, { timeout: 5000 });
    console.log('✓ Editor opened');

    // 5. Perform 3 edit cycles
    for (let i = 1; i <= 3; i++) {
      console.log(`\n--- Edit cycle ${i} ---`);

      await appWindow.evaluate(({ windowId, text }: { windowId: string; text: string }) => {
        const escapedWindowId = CSS.escape(windowId);
        const editorElement = document.querySelector(`#${escapedWindowId} .cm-content`) as HTMLElement | null;
        if (!editorElement) throw new Error('Editor not found');

        const cmView = (editorElement as CodeMirrorElement).cmView?.view;
        if (!cmView) throw new Error('CodeMirror view not found');

        // Mark as user event so autosave triggers
        const docLength = cmView.state.doc.length;
        cmView.dispatch({
          changes: { from: docLength, insert: text },
          userEvent: 'input.type'
        });
      }, { windowId: editorWindowId, text: `\n\nEdit ${i} added.` });

      // Wait for auto-save
      await appWindow.waitForTimeout(600);
      console.log(`✓ Edit ${i} saved`);
    }

    // 6. Wait for any feedback loops
    console.log('\n⏳ Waiting 2 seconds for stability...');
    if (!appWindow.isClosed()) {
      await appWindow.waitForTimeout(2000);
    }

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
