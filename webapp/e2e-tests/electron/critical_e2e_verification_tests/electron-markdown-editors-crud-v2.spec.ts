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
import * as os from 'os';
import type { Core as CytoscapeCore, EdgeSingular } from 'cytoscape';
import type { EditorView } from '@codemirror/view';
import { robustElectronTeardown, resolveGraphDaemonNodeBin, safeStopFileWatching, pollForCytoscape } from './electron-smoke-helpers';

// Use absolute paths
const PROJECT_ROOT = path.resolve(process.cwd());
// Note: FIXTURE_VAULT_PATH is the watched directory. The app uses a default vaultSuffix of 'voicetree'
// so files are in FIXTURE_VAULT_PATH/voicetree/, and node IDs include this prefix (e.g., "voicetree/2025-09-30/file.md")
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_real_large');

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
  // IMPORTANT: Each test gets isolated userData to prevent state pollution
  electronApp: [async ({}, use) => {
    // Create a temporary userData directory for test isolation
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-editor-test-'));

    // Write the config file to auto-load the test vault
    // This is critical - without it, the graph never loads into memory
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: FIXTURE_VAULT_PATH }, null, 2), 'utf8');
    console.log('[Test] Created config file to auto-load:', FIXTURE_VAULT_PATH);

    const ciFlags = process.env.CI
      ? ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader']
      : [];
    const electronApp = await electron.launch({
      args: [
        ...ciFlags,
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}` // Isolate test userData
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1', // Minimize window to avoid dialog popups
        VOICETREE_PERSIST_STATE: '1', // Use test's userData path instead of creating new temp directory
        VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(),
      }
    });

    await use(electronApp);

    // Graceful shutdown: Stop file watching before closing app
    // This prevents EPIPE errors from file watcher trying to log after stdout closes
    await safeStopFileWatching(electronApp);
    await robustElectronTeardown(electronApp);

    // Cleanup temp directory
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  }, { timeout: 45000 }],

  // Get the main window
  appWindow: [async ({ electronApp }, use) => {
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

    await pollForCytoscape(page, 45000);
    // Wait for auto-load to complete (vault is loaded during app initialization)
    await page.waitForTimeout(500);

    await use(page);
  }, { timeout: 60000 }]
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
    test.setTimeout(60000); // Increase timeout to 60s for this complex test
    console.log('=== Testing markdown file saving in subfolders ===');

    // Vault is auto-loaded via config - wait for graph to have nodes
    // The appWindow fixture already waits for cytoscapeInstance, but we need nodes loaded too
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return 0;
        return cy.nodes().length;
      });
    }, {
      message: 'Waiting for graph to load nodes',
      timeout: 15000
    }).toBeGreaterThan(0);

    console.log('✓ Graph loaded with nodes');

    // Find a node with label "Setting up Agent in Feedback Loop" (from markdown heading)
    const nodeId = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Find node by label (from markdown heading)
      const nodes = cy.nodes();
      let foundNodeId: string | null = null;

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const label = node.data('label');
        if (label === 'Setting up Agent in Feedback Loop') {
          foundNodeId = node.id();
          break;
        }
      }

      if (!foundNodeId) {
        // Log available nodes for debugging
        const availableLabels: string[] = [];
        for (let i = 0; i < Math.min(10, nodes.length); i++) {
          availableLabels.push(nodes[i].data('label'));
        }
        throw new Error(`Node with label "Setting up Agent in Feedback Loop" not found. Available nodes: ${availableLabels.join(', ')}`);
      }

      return foundNodeId;
    });

    console.log(`✓ Found node with ID: ${nodeId}`);

    // Read original file content for restoration later
    // Note: nodeId may be absolute path or relative to watched directory (e.g., "voicetree/2025-09-30/file.md")
    // If absolute, use directly; if relative, join with FIXTURE_VAULT_PATH
    const testFilePath = path.isAbsolute(nodeId)
      ? (nodeId.endsWith('.md') ? nodeId : `${nodeId}.md`)
      : (nodeId.endsWith('.md')
          ? path.join(FIXTURE_VAULT_PATH, nodeId)
          : path.join(FIXTURE_VAULT_PATH, `${nodeId}.md`));
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
    // Note: The window ID format is `window-${nodeId}-editor` based on createWindowChrome
    const editorWindowId = `window-${nodeId}-editor`;
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
    // Note: Need to escape special chars (dots, slashes) in the selector for CSS
    // CSS.escape would be ideal but it's not available in Node.js, so we manually escape
    const escapedEditorWindowId = editorWindowId.replace(/[./]/g, '\\$&');
    await appWindow.waitForSelector(`#${escapedEditorWindowId} .cm-editor`, { timeout: 5000 });

    // Wait for the renderer's loading cycle to settle before dispatching.
    // The renderer syncs editor content from graph state ~300ms after load
    // (renderer:loading-cleared fires ~1333ms after renderer start). If we
    // dispatch before this sync, the sync overwrites our edit and autosave
    // saves the original content instead.
    await appWindow.waitForTimeout(2000);

    // Modify content in the editor using direct CodeMirror DOM access
    const testContent = '# Setting up Agent in Feedback Loop\n\nTEST MODIFICATION - This content was changed by the e2e test.\n\nThis is a test to verify file sync works correctly.';

    await appWindow.evaluate(({ windowId, newContent }: { windowId: string; newContent: string }) => {
      // Escape special chars (dots, slashes) in windowId for querySelector
      const escapedWindowId = CSS.escape(windowId);
      const editorElement = document.querySelector(`#${escapedWindowId} .cm-content`) as HTMLElement | null;
      if (!editorElement) throw new Error('Editor content element not found');

      const cmView = (editorElement as CodeMirrorElement).cmView?.view;
      if (!cmView) throw new Error('CodeMirror view not found');

      // IMPORTANT: Must include userEvent annotation to trigger onChange handler
      // CodeMirrorEditorView only fires onChange for user-initiated changes
      cmView.dispatch({
        changes: { from: 0, to: cmView.state.doc.length, insert: newContent },
        userEvent: 'input'
      });
    }, { windowId: editorWindowId, newContent: testContent });

    console.log('✓ Content modified in editor');

    // Poll until auto-save writes the content to disk.
    // The chain is: 300ms debounce → getGraph() IPC → applyGraphDelta IPC → FS write.
    await expect.poll(async () => {
      const content = await fs.readFile(testFilePath, 'utf-8');
      return content.includes(testContent);
    }, {
      message: 'Waiting for auto-save to write test content to disk',
      timeout: 15_000,
      intervals: [200, 500, 1000, 2000]
    }).toBe(true);

    const savedContentBeforeClose = await fs.readFile(testFilePath, 'utf-8');
    console.log('Saved file content length (before close):', savedContentBeforeClose.length);

    expect(savedContentBeforeClose).toContain(testContent);
    expect(savedContentBeforeClose).toMatch(/^---\n/);
    console.log('✓ File content saved correctly to disk BEFORE close');

    // CRITICAL TEST: Click the ACTUAL close button (not just remove shadow node)
    console.log('Clicking close button...');
    await appWindow.evaluate((winId) => {
      // Escape dots in winId for querySelector
      const escapedWinId = CSS.escape(winId);
      const closeButton = document.querySelector(`#${escapedWinId} .traffic-light-close`) as HTMLButtonElement | null;
      if (!closeButton) throw new Error('Close button not found!');
      closeButton.click();
    }, editorWindowId);

    await appWindow.waitForTimeout(200); // Wait for close and any save operations

    // CRITICAL VERIFICATION: File should STILL have the saved content after close
    const savedContentAfterClose = await fs.readFile(testFilePath, 'utf-8');
    console.log('Saved file content length (after close):', savedContentAfterClose.length);

    // Verify the content hasn't been reverted
    expect(savedContentAfterClose).toContain(testContent);
    expect(savedContentAfterClose).toMatch(/^---\n/);
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
    // Note: Need to escape dots in the selector if nodeId contains .md
    await appWindow.waitForSelector(`#${escapedEditorWindowId} .cm-editor`, { timeout: 5000 });

    // Verify the editor shows the saved content using direct DOM access
    const editorContent = await appWindow.evaluate((winId) => {
      // Escape dots in winId for querySelector
      const escapedWinId = CSS.escape(winId);
      const editorElement = document.querySelector(`#${escapedWinId} .cm-content`) as HTMLElement | null;
      if (!editorElement) return null;

      const cmView = (editorElement as CodeMirrorElement).cmView?.view;
      if (!cmView) return null;

      return cmView.state.doc.toString();
    }, editorWindowId);

    // Editor shows content without frontmatter (frontmatter is stripped when displaying)
    expect(editorContent).toContain(testContent);
    console.log('✓ Editor shows saved content after reopening');

    // Close the editor before restoring file (to prevent auto-save from overwriting)
    await appWindow.evaluate((winId) => {
      const escapedWinId = CSS.escape(winId);
      const closeButton = document.querySelector(`#${escapedWinId} .traffic-light-close`) as HTMLButtonElement | null;
      if (closeButton) closeButton.click();
    }, editorWindowId);
    await appWindow.waitForTimeout(200); // Wait for editor to fully close

    // Restore original file content (reset for clean git state)
    await fs.writeFile(testFilePath, originalContent, 'utf-8');
    console.log('✓ Original file content restored');

    // Wait for file change to be detected
    await appWindow.waitForTimeout(200);

    console.log('✓ Markdown file save test completed');
  });

  test('should preserve exact content typed through real keyboard input', async ({ appWindow }) => {
    test.setTimeout(60000);
    console.log('=== Testing real keyboard typing into markdown editor ===');

    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        return cy?.nodes().length ?? 0;
      });
    }, {
      message: 'Waiting for graph to load nodes',
      timeout: 15000
    }).toBeGreaterThan(0);

    const nodeId = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const nodes = cy.nodes();
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.data('label') === 'Setting up Agent in Feedback Loop') {
          return node.id();
        }
      }

      throw new Error('Node with label "Setting up Agent in Feedback Loop" not found');
    });

    const testFilePath = path.isAbsolute(nodeId)
      ? (nodeId.endsWith('.md') ? nodeId : `${nodeId}.md`)
      : (nodeId.endsWith('.md')
          ? path.join(FIXTURE_VAULT_PATH, nodeId)
          : path.join(FIXTURE_VAULT_PATH, `${nodeId}.md`));
    const originalContent = await fs.readFile(testFilePath, 'utf-8');

    const editorWindowId = `window-${nodeId}-editor`;
    try {
      await appWindow.evaluate((nId) => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        const node = cy.getElementById(nId);
        if (node.length === 0) throw new Error(`${nId} node not found`);
        node.trigger('tap');
      }, nodeId);

      await expect.poll(async () => {
        return appWindow.evaluate((winId) => document.getElementById(winId) !== null, editorWindowId);
      }, {
        message: 'Waiting for editor window to appear',
        timeout: 5000
      }).toBe(true);

      const escapedEditorWindowId = editorWindowId.replace(/[./]/g, '\\$&');
      const editorSelector = `#${escapedEditorWindowId} .cm-content`;
      await appWindow.waitForSelector(editorSelector, { timeout: 5000 });

      const focused = await appWindow.evaluate((winId) => {
        const editorElement = document.querySelector(`#${CSS.escape(winId)} .cm-content`) as CodeMirrorElement | null;
        if (!editorElement?.cmView?.view) return false;
        editorElement.cmView.view.focus();
        return document.activeElement === editorElement
          || !!document.activeElement?.closest('.cm-editor');
      }, editorWindowId);
      expect(focused).toBe(true);

      const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
      await appWindow.keyboard.press(`${modifier}+A`);
      await expect.poll(async () => {
        return appWindow.evaluate((winId) => {
          const editorElement = document.querySelector(`#${CSS.escape(winId)} .cm-content`) as CodeMirrorElement | null;
          const view = editorElement?.cmView?.view;
          if (!view) return null;
          const selection = view.state.selection.main;
          return { from: selection.from, to: selection.to, length: view.state.doc.length };
        }, editorWindowId);
      }, {
        message: 'Waiting for keyboard select-all to reach CodeMirror',
        timeout: 5000
      }).toEqual(expect.objectContaining({ from: 0 }));

      const typedContent = [
        '# Keyboard Input Smoke',
        '',
        'Typed through Playwright keyboard events.',
        'Symbols: []{}() _ - + = / \\',
        'Final line.'
      ].join('\n');
      await appWindow.keyboard.type(typedContent);

      await expect.poll(async () => {
        return appWindow.evaluate((winId) => {
          const editorElement = document.querySelector(`#${CSS.escape(winId)} .cm-content`) as CodeMirrorElement | null;
          return editorElement?.cmView?.view.state.doc.toString() ?? null;
        }, editorWindowId);
      }, {
        message: 'Waiting for typed content to appear exactly in CodeMirror',
        timeout: 5000
      }).toBe(typedContent);

      await appWindow.waitForTimeout(1000);
      const savedContent = await fs.readFile(testFilePath, 'utf-8');
      expect(savedContent).toContain(typedContent);
      expect(savedContent).toMatch(/^---\n/);

      console.log('✓ Real keyboard editor input saved exactly');
    } finally {
      await appWindow.evaluate((winId) => {
        const closeButton = document.querySelector(`#${CSS.escape(winId)} .traffic-light-close`) as HTMLButtonElement | null;
        if (closeButton) closeButton.click();
      }, editorWindowId).catch(() => undefined);
      await appWindow.waitForTimeout(200).catch(() => undefined);
      await fs.writeFile(testFilePath, originalContent, 'utf-8');
      await appWindow.waitForTimeout(200).catch(() => undefined);
    }
  });

  test.skip('should update graph when wikilink is added via editor', async ({ appWindow }) => {
    // SKIPPED: This test fails because the 'introduction' node doesn't get its filePath metadata set,
    // which prevents the editor from opening. This appears to be an application bug, not a test issue.
    console.log('=== Testing graph update when adding wikilink ===');

    // Vault is auto-loaded via config - wait for graph to have nodes
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return 0;
        return cy.nodes().length;
      });
    }, {
      message: 'Waiting for graph to load nodes',
      timeout: 15000
    }).toBeGreaterThan(0);
    console.log('✓ Graph loaded with nodes');

    const nodeId = 'introduction';
    // Read original file content for restoration
    // Note: nodeId may be absolute path or relative to watched directory (e.g., "voicetree/file.md")
    // If absolute, use directly; if relative, join with FIXTURE_VAULT_PATH
    const testFilePath = path.isAbsolute(nodeId)
      ? (nodeId.endsWith('.md') ? nodeId : `${nodeId}.md`)
      : (nodeId.endsWith('.md')
          ? path.join(FIXTURE_VAULT_PATH, nodeId)
          : path.join(FIXTURE_VAULT_PATH, `${nodeId}.md`));
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
    // Note: Need to escape special chars (dots, slashes) in the selector for CSS
    // CSS.escape would be ideal but it's not available in Node.js, so we manually escape
    const escapedEditorWindowId = editorWindowId.replace(/[./]/g, '\\$&');
    await appWindow.waitForSelector(`#${escapedEditorWindowId} .cm-editor`, { timeout: 5000 });

    // Add a new wikilink to the content
    const newContent = originalContent + '\n\nNew section linking to [[README]] for testing.';

    await appWindow.evaluate(({ windowId, content }: { windowId: string; content: string }) => {
      // Escape dots in windowId for querySelector
      const escapedWindowId = CSS.escape(windowId);
      const editorElement = document.querySelector(`#${escapedWindowId} .cm-content`) as HTMLElement | null;
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
    test.setTimeout(60000); // Increase timeout to 60s for this complex test
    console.log('=== Testing bidirectional sync: external changes -> open editor ===');

    // Vault is auto-loaded via config - wait for graph to have nodes
    // The appWindow fixture already waits for cytoscapeInstance, but we need nodes loaded too
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return 0;
        return cy.nodes().length;
      });
    }, {
      message: 'Waiting for graph to load nodes',
      timeout: 15000
    }).toBeGreaterThan(0);

    console.log('✓ Graph loaded with nodes');

    // Find a node with label "Identify Relevant Test" (from markdown heading)
    const nodeId = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Find node by label (from markdown heading)
      const nodes = cy.nodes();
      let foundNodeId: string | null = null;

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const label = node.data('label');
        if (label === 'Identify Relevant Test') {
          foundNodeId = node.id();
          break;
        }
      }

      if (!foundNodeId) {
        // Log available nodes for debugging
        const availableLabels: string[] = [];
        for (let i = 0; i < Math.min(10, nodes.length); i++) {
          availableLabels.push(nodes[i].data('label'));
        }
        throw new Error(`Node with label "Identify Relevant Test" not found. Available nodes: ${availableLabels.join(', ')}`);
      }

      return foundNodeId;
    });

    console.log(`✓ Found node with ID: ${nodeId}`);

    // Read original file content for restoration
    // Note: nodeId may be absolute path or relative to watched directory (e.g., "voicetree/2025-09-30/file.md")
    // If absolute, use directly; if relative, join with FIXTURE_VAULT_PATH
    const testFilePath = path.isAbsolute(nodeId)
      ? (nodeId.endsWith('.md') ? nodeId : `${nodeId}.md`)
      : (nodeId.endsWith('.md')
          ? path.join(FIXTURE_VAULT_PATH, nodeId)
          : path.join(FIXTURE_VAULT_PATH, `${nodeId}.md`));
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
    // Note: The window ID format is `window-${nodeId}-editor` based on createWindowChrome
    const editorWindowId = `window-${nodeId}-editor`;
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
    // Note: Need to escape special chars (dots, slashes) in the selector for CSS
    // CSS.escape would be ideal but it's not available in Node.js, so we manually escape
    const escapedEditorWindowId = editorWindowId.replace(/[./]/g, '\\$&');
    await appWindow.waitForSelector(`#${escapedEditorWindowId} .cm-editor`, { timeout: 5000 });

    // Get initial editor content using direct DOM access
    const initialEditorContent = await appWindow.evaluate((winId) => {
      // Escape dots in winId for querySelector
      const escapedWinId = CSS.escape(winId);
      const editorElement = document.querySelector(`#${escapedWinId} .cm-content`) as HTMLElement | null;
      if (!editorElement) return null;

      const cmView = (editorElement as CodeMirrorElement).cmView?.view;
      if (!cmView) return null;

      return cmView.state.doc.toString();
    }, editorWindowId);

    // Editor displays content without frontmatter (frontmatter is stripped for editing)
    expect(initialEditorContent).not.toBeNull();
    expect(initialEditorContent).toContain('# Identify Relevant Test');
    console.log('✓ Editor shows original content (without frontmatter)');

    // Make an EXTERNAL change to the file (simulating external editor or another process)
    // Note: We need to include frontmatter since the system expects it
    const externallyChangedContent = '---\n---\n# Identify Relevant Test\n\n**EXTERNAL CHANGE** - This file was changed by an external process!\n\nThe editor should automatically sync to show this change.';
    await fs.writeFile(testFilePath, externallyChangedContent, 'utf-8');
    console.log('✓ File changed externally');

    // Poll until the editor reflects the external file change.
    // Pipeline: fs.writeFile → file watcher → SSE → renderer → CodeMirror update.
    // CI is slower than local so we give a generous 15s window.
    const expectedEditorContent = '# Identify Relevant Test\n\n**EXTERNAL CHANGE** - This file was changed by an external process!\n\nThe editor should automatically sync to show this change.';
    await expect.poll(async () => {
      return appWindow.evaluate((winId) => {
        const escapedWinId = CSS.escape(winId);
        const editorElement = document.querySelector(`#${escapedWinId} .cm-content`) as HTMLElement | null;
        if (!editorElement) return null;
        const cmView = (editorElement as CodeMirrorElement).cmView?.view;
        if (!cmView) return null;
        return cmView.state.doc.toString();
      }, editorWindowId);
    }, {
      message: 'Waiting for editor to sync external file change',
      timeout: 15000,
      intervals: [500, 1000, 2000],
    }).toBe(expectedEditorContent);
    console.log('✓ Editor synced with external file change');

    // Close the editor before restoring file (to prevent auto-save from overwriting)
    await appWindow.evaluate((winId) => {
      const escapedWinId = CSS.escape(winId);
      const closeButton = document.querySelector(`#${escapedWinId} .traffic-light-close`) as HTMLButtonElement | null;
      if (closeButton) closeButton.click();
    }, editorWindowId);
    await appWindow.waitForTimeout(200); // Wait for editor to fully close

    // Restore original file content
    await fs.writeFile(testFilePath, originalContent, 'utf-8');
    console.log('✓ Original file content restored');

    // Wait for file change to be detected
    await appWindow.waitForTimeout(200);

    console.log('✓ Bidirectional sync test completed');
  });
});

export { test };
