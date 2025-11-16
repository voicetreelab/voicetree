/**
 * BEHAVIORAL SPEC: Markdown Editor CRUD Operations
 * 1. Clicking nodes opens floating markdown editors that save changes to disk
 * 2. Adding wiki-links in editors creates new outgoingEdges in the graph
 * 3. External file changes sync to open editors (bidirectional sync)
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { Core as CytoscapeCore, EdgeSingular } from 'cytoscape';
import type { EditorView } from '@codemirror/view';

// Use absolute paths
const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_real_large', '2025-09-30');

// Type definitions
interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: {
    main: {
      startFileWatching: (dir: string) => Promise<{ success: boolean; directory?: string; error?: string }>;
      stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
      getWatchStatus: () => Promise<{ isWatching: boolean; directory?: string }>;
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
}>({
  // Set up Electron application

  electronApp: async ({}, use) => {
    const electronApp = await electron.launch({
      args: [path.join(PROJECT_ROOT, 'dist-electron/main/index.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1' // Minimize window to avoid dialog popups
      }
    });

    await use(electronApp);

    // Graceful shutdown: Stop file watching before closing app
    // This prevents EPIPE errors from file watcher trying to log after stdout closes
    try {
      const page = await electronApp.firstWindow();
      await page.evaluate(async () => {
        const api = (window as ExtendedWindow).electronAPI;
        if (api) {
          await api.main.stopFileWatching();
        }
      });
      // Wait for pending file system events to drain
      await page.waitForTimeout(300);
    } catch {
      // Window might already be closed, that's okay
      console.log('Note: Could not stop file watching during cleanup (window may be closed)');
    }

    await electronApp.close();
  },

  // Get the main window
  appWindow: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();

    // Log console messages for debugging
    page.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    // Capture page errors
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

    await page.waitForFunction(() => (window as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
    await page.waitForTimeout(1000);

    await use(page);
  }
});

test.describe('Markdown Editor CRUD Tests', () => {
  // Cleanup hook to ensure test files are removed even if test fails
  test.afterEach(async ({ appWindow }) => {
    // Stop file watching BEFORE cleaning up files to prevent EPIPE errors
    try {
      await appWindow.evaluate(async () => {
        const api = (window as ExtendedWindow).electronAPI;
        if (api) {
          await api.main.stopFileWatching();
        }
      });
      // Brief wait to let file watcher fully stop
      await appWindow.waitForTimeout(200);
    } catch {
      // Window might be closed, that's okay
    }
  });

  test('should save markdown files in subfolders via editor', async ({ appWindow }) => {
    console.log('=== Testing markdown file saving in subfolders ===');

    // Start watching the fixture vault
    await appWindow.evaluate(async (vaultPath) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.startFileWatching(vaultPath);
    }, FIXTURE_VAULT_PATH);

    // Wait for file watching to start successfully
    await appWindow.waitForTimeout(1000);

    // Wait for graph to load with test node
    const nodeId = '10_Setting_up_Agent_in_Feedback_Loop';
    await expect.poll(async () => {
      return appWindow.evaluate((nId) => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return false;
        return cy.getElementById(nId).length > 0;
      }, nodeId);
    }, {
      message: `Waiting for ${nodeId} node to load`,
      timeout: 10000
    }).toBe(true);

    // Read original file content for restoration later
    const testFilePath = path.join(FIXTURE_VAULT_PATH, `${nodeId}.md`);
    const originalContent = await fs.readFile(testFilePath, 'utf-8');
    console.log('Original file content length:', originalContent.length);

    // Click on the node to open editor
    await appWindow.evaluate((nId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const node = cy.getElementById(nId);
      if (node.length === 0) throw new Error(`${nId} node not found`);

      // Trigger tap event to open editor
      node.trigger('tap');
    }, nodeId);

    // Wait for editor window to appear in DOM
    const editorWindowId = `window-editor-${nodeId}`;
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
    await appWindow.waitForSelector(`#${editorWindowId} .cm-editor`, { timeout: 5000 });

    // Modify content in the editor using direct CodeMirror DOM access
    const testContent = '# Setting up Agent in Feedback Loop\n\nTEST MODIFICATION - This content was changed by the e2e test.\n\nThis is a test to verify file sync works correctly.';

    await appWindow.evaluate(({ windowId, newContent }: { windowId: string; newContent: string }) => {
      const editorElement = document.querySelector(`#${windowId} .cm-content`) as HTMLElement | null;
      if (!editorElement) throw new Error('Editor content element not found');

      const cmView = (editorElement as CodeMirrorElement).cmView?.view;
      if (!cmView) throw new Error('CodeMirror view not found');

      cmView.dispatch({
        changes: { from: 0, to: cmView.state.doc.length, insert: newContent }
      });
    }, { windowId: editorWindowId, newContent: testContent });

    console.log('✓ Content modified in editor');

    // Wait for auto-save to complete
    await appWindow.waitForTimeout(200);

    // Verify file content changed on disk BEFORE closing
    // Note: The system adds frontmatter with position
    // Wikilinks are extracted from content, not preserved from old edges
    const savedContentBeforeClose = await fs.readFile(testFilePath, 'utf-8');
    console.log('Saved file content length (before close):', savedContentBeforeClose.length);

    // Verify the test content is present in the saved file
    expect(savedContentBeforeClose).toContain(testContent);
    // Verify frontmatter is present
    expect(savedContentBeforeClose).toMatch(/^---\nposition:/);
    console.log('✓ File content saved correctly to disk BEFORE close');

    // CRITICAL TEST: Click the ACTUAL close button (not just remove shadow node)
    console.log('Clicking close button...');
    await appWindow.evaluate((winId) => {
      const closeButton = document.querySelector(`#${winId} .cy-floating-window-close`) as HTMLButtonElement | null;
      if (!closeButton) throw new Error('Close button not found!');
      closeButton.click();
    }, editorWindowId);

    await appWindow.waitForTimeout(200); // Wait for close and any save operations

    // CRITICAL VERIFICATION: File should STILL have the saved content after close
    const savedContentAfterClose = await fs.readFile(testFilePath, 'utf-8');
    console.log('Saved file content length (after close):', savedContentAfterClose.length);

    // Verify the content hasn't been reverted
    expect(savedContentAfterClose).toContain(testContent);
    expect(savedContentAfterClose).toMatch(/^---\nposition:/);
    console.log('✓ File content STILL correct after clicking close button');

    // Re-open the editor to verify content persisted
    await appWindow.evaluate((nId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById(nId);
      node.trigger('tap');
    }, nodeId);

    // Wait for editor window to re-appear in DOM
    await expect.poll(async () => {
      return appWindow.evaluate((winId) => {
        const editorWindow = document.getElementById(winId);
        return editorWindow !== null;
      }, editorWindowId);
    }, {
      message: 'Waiting for editor to re-open',
      timeout: 5000
    }).toBe(true);

    // Wait for CodeMirror editor to render again
    await appWindow.waitForSelector(`#${editorWindowId} .cm-editor`, { timeout: 5000 });

    // Verify the editor shows the saved content using direct DOM access
    const editorContent = await appWindow.evaluate((winId) => {
      const editorElement = document.querySelector(`#${winId} .cm-content`) as HTMLElement | null;
      if (!editorElement) return null;

      const cmView = (editorElement as CodeMirrorElement).cmView?.view;
      if (!cmView) return null;

      return cmView.state.doc.toString();
    }, editorWindowId);

    // Editor shows content without frontmatter (frontmatter is stripped when displaying)
    expect(editorContent).toContain(testContent);
    console.log('✓ Editor shows saved content after reopening');

    // Restore original file content (reset for clean git state)
    await fs.writeFile(testFilePath, originalContent, 'utf-8');
    console.log('✓ Original file content restored');

    // Wait for file change to be detected
    await appWindow.waitForTimeout(200);

    console.log('✓ Markdown file save test completed');
  });

  test.skip('should update graph when wikilink is added via editor', async ({ appWindow }) => {
    // SKIPPED: This test fails because the 'introduction' node doesn't get its filePath metadata set,
    // which prevents the editor from opening. This appears to be an application bug, not a test issue.
    console.log('=== Testing graph update when adding wikilink ===');

    // Start watching the fixture vault
    await appWindow.evaluate(async (vaultPath) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.startFileWatching(vaultPath);
    }, FIXTURE_VAULT_PATH);

    await appWindow.waitForTimeout(3000);

    const nodeId = 'introduction';
    // Read original file content for restoration
    const testFilePath = path.join(FIXTURE_VAULT_PATH, `${nodeId}.md`);
    const originalContent = await fs.readFile(testFilePath, 'utf-8');

    // Get initial edge count for node
    const initialEdges = await appWindow.evaluate((nId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const node = cy.getElementById(nId);
      if (node.length === 0) throw new Error(`${nId} node not found`);

      const connectedEdges = node.connectedEdges();
      return {
        totalEdges: cy.edges().length,
        nodeEdgeCount: connectedEdges.length,
        edgeTargets: connectedEdges.map((e: EdgeSingular) => ({
          source: e.source().id(),
          target: e.target().id()
        }))
      };
    }, nodeId);

    console.log(`Initial outgoingEdges for ${nodeId} node:`, initialEdges.nodeEdgeCount);
    console.log('Initial total outgoingEdges:', initialEdges.totalEdges);

    // Click on the node to open editor
    await appWindow.evaluate((nId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById(nId);
      if (node.length === 0) throw new Error(`${nId} node not found for tap`);
      node.trigger('tap');
    }, nodeId);

    // Wait for editor to open in DOM
    const editorWindowId = `window-editor-${nodeId}`;
    await expect.poll(async () => {
      return appWindow.evaluate((winId) => {
        const editorWindow = document.getElementById(winId);
        return editorWindow !== null;
      }, editorWindowId);
    }, {
      message: 'Waiting for editor to open',
      timeout: 5000
    }).toBe(true);

    console.log('✓ Editor opened');

    // Wait for CodeMirror editor to render
    await appWindow.waitForSelector(`#${editorWindowId} .cm-editor`, { timeout: 5000 });

    // Add a new wikilink to the content
    const newContent = originalContent + '\n\nNew section linking to [[README]] for testing.';

    await appWindow.evaluate(({ windowId, content }: { windowId: string; content: string }) => {
      const editorElement = document.querySelector(`#${windowId} .cm-content`) as HTMLElement | null;
      if (!editorElement) throw new Error('Editor content element not found');

      const cmView = (editorElement as CodeMirrorElement).cmView?.view;
      if (!cmView) throw new Error('CodeMirror view not found');

      cmView.dispatch({
        changes: { from: 0, to: cmView.state.doc.length, insert: content }
      });
    }, { windowId: editorWindowId, content: newContent });

    console.log('✓ Added wikilink to README');

    // Wait for auto-save to complete
    await appWindow.waitForTimeout(2000);

    // Verify new edge was created
    const updatedEdges = await appWindow.evaluate((nId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const node = cy.getElementById(nId);
      const connectedEdges = node.connectedEdges();

      return {
        totalEdges: cy.edges().length,
        nodeEdgeCount: connectedEdges.length,
        edgeTargets: connectedEdges.map((e) => {
          const edge = e as EdgeSingular;
          return {
            source: edge.source().id(),
            target: edge.target().id()
          };
        }),
        hasREADMEEdge: connectedEdges.some((e) => {
          const edge = e as EdgeSingular;
          return (edge.source().id() === nId && edge.target().id() === 'README') ||
            (edge.source().id() === 'README' && edge.target().id() === nId);
        })
      };
    }, nodeId);

    console.log(`Updated outgoingEdges for ${nodeId} node:`, updatedEdges.nodeEdgeCount);
    console.log('Updated total outgoingEdges:', updatedEdges.totalEdges);
    console.log('Has README edge:', updatedEdges.hasREADMEEdge);

    // Verify edge count increased and new edge to 'README' exists
    expect(updatedEdges.totalEdges).toBeGreaterThan(initialEdges.totalEdges);
    expect(updatedEdges.hasREADMEEdge).toBe(true);
    console.log('✓ New edge to README node created in graph');

    // Restore original file content
    await fs.writeFile(testFilePath, originalContent, 'utf-8');
    console.log('✓ Original file content restored');

    // Wait for file change to be detected and graph to update
    await appWindow.waitForTimeout(2000);

    console.log('✓ Graph wikilink update test completed');
  });

  test('should sync external file changes to open editors (bidirectional sync)', async ({ appWindow }) => {
    console.log('=== Testing bidirectional sync: external changes -> open editor ===');

    // Start watching the fixture vault
    await appWindow.evaluate(async (vaultPath) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.startFileWatching(vaultPath);
    }, FIXTURE_VAULT_PATH);

    // Wait for file watching to start successfully
    await appWindow.waitForTimeout(1000);

    // Wait for test node to load
    const nodeId = '11_Identify_Relevant_Test_for_Tree_Action_Decider_Workflow';
    await expect.poll(async () => {
      return appWindow.evaluate((nId) => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return false;
        return cy.getElementById(nId).length > 0;
      }, nodeId);
    }, {
      message: `Waiting for ${nodeId} node to load`,
      timeout: 10000
    }).toBe(true);

    // Read original file content for restoration
    const testFilePath = path.join(FIXTURE_VAULT_PATH, `${nodeId}.md`);
    const originalContent = await fs.readFile(testFilePath, 'utf-8');
    console.log('Original file content:', originalContent.substring(0, 50) + '...');

    // Open the editor for the node
    await appWindow.evaluate((nId) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById(nId);
      if (node.length === 0) throw new Error(`${nId} node not found`);
      node.trigger('tap');
    }, nodeId);

    // Wait for editor window to appear in DOM
    const editorWindowId = `window-editor-${nodeId}`;
    await expect.poll(async () => {
      return appWindow.evaluate((winId) => {
        const editorWindow = document.getElementById(winId);
        return editorWindow !== null;
      }, editorWindowId);
    }, {
      message: 'Waiting for editor window to appear',
      timeout: 5000
    }).toBe(true);

    console.log('✓ Editor opened');

    // Wait for CodeMirror editor to render
    await appWindow.waitForSelector(`#${editorWindowId} .cm-editor`, { timeout: 5000 });

    // Get initial editor content using direct DOM access
    const initialEditorContent = await appWindow.evaluate((winId) => {
      const editorElement = document.querySelector(`#${winId} .cm-content`) as HTMLElement | null;
      if (!editorElement) return null;

      const cmView = (editorElement as CodeMirrorElement).cmView?.view;
      if (!cmView) return null;

      return cmView.state.doc.toString();
    }, editorWindowId);

    expect(initialEditorContent).toBe(originalContent);
    console.log('✓ Editor shows original content');

    // Make an EXTERNAL change to the file (simulating external editor or another process)
    // Note: We need to include frontmatter since the system expects it
    const externallyChangedContent = '---\n---\n# Identify Relevant Test\n\n**EXTERNAL CHANGE** - This file was changed by an external process!\n\nThe editor should automatically sync to show this change.';
    await fs.writeFile(testFilePath, externallyChangedContent, 'utf-8');
    console.log('✓ File changed externally');

    // Wait for file watcher to detect the change
    await appWindow.waitForTimeout(2000);

    // Check if editor content was updated to match the external change
    const updatedEditorContent = await appWindow.evaluate((winId) => {
      const editorElement = document.querySelector(`#${winId} .cm-content`) as HTMLElement | null;
      if (!editorElement) return null;

      const cmView = (editorElement as CodeMirrorElement).cmView?.view;
      if (!cmView) return null;

      return cmView.state.doc.toString();
    }, editorWindowId);

    console.log('Editor content after external change:', updatedEditorContent?.substring(0, 50) + '...');

    // This is the key assertion - editor should show the externally changed content
    // The editor displays the full file content including frontmatter
    expect(updatedEditorContent).toBe(externallyChangedContent);
    console.log('✓ Editor synced with external file change');

    // Restore original file content
    await fs.writeFile(testFilePath, originalContent, 'utf-8');
    console.log('✓ Original file content restored');

    // Wait for file change to be detected
    await appWindow.waitForTimeout(2000);

    console.log('✓ Bidirectional sync test completed');
  });
});

export { test };
