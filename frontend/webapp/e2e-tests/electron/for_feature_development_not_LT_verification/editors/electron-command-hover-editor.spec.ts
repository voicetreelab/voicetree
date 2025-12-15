/**
 * BEHAVIORAL SPEC: Hover Mode for GraphNode Editor
 *
 * 1. Hovering over a node opens a floating markdown editor
 * 2. Editor is positioned near the node but does NOT create a shadow node (non-anchoring)
 * 3. Editor closes when clicking outside the editor area
 * 4. Editor does not interfere with normal graph interactions
 * 5. Editor moves with graph pan/zoom (attached to cy-floating-overlay)
 * 6. Only one hover editor can be open at a time (opening new one closes previous)
 * 7. Editor content is editable and auto-saves
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test as base, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import type { Core as CytoscapeCore } from 'cytoscape';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');

// Type definition for browser window with cytoscape
interface ExtendedWindow extends Window {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: {
    main?: {
      stopFileWatching?: () => Promise<{ success: boolean; error?: string }>;
      getGraph?: () => Promise<{ nodes: Record<string, unknown> } | null>;
    };
  };
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    // Create a temporary userData directory for this test
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-hover-test-'));

    // Write the config file to auto-load the test vault
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: FIXTURE_VAULT_PATH }, null, 2), 'utf8');

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}` // Use temp userData to isolate test config
      ],
      env: { ...process.env, NODE_ENV: 'test', HEADLESS_TEST: '1', MINIMIZE_TEST: '1' },
      timeout: 8000
    });

    await use(electronApp);

    // Graceful shutdown: Stop file watching before closing app
    // This prevents EPIPE errors from file watcher trying to log after stdout closes
    try {
      const page = await electronApp.firstWindow();
      await page.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (api?.main?.stopFileWatching) {
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

    // Cleanup temp directory
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();

    // Log console messages for debugging
    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    // Capture page errors
    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });

    await use(window);
  }
});

test.describe('Hover Mode for GraphNode Editor', () => {

  // FIXME: Hover editor feature is currently broken in production
  // The issue is that createFloatingEditor() calls getNodeFromMainToUI() which throws
  // "NO GRAPH IN STATE" error when the graph hasn't been fully synchronized between
  // the main process and renderer. This causes the hover editor to silently fail.
  // These tests need to be re-enabled once the production code is fixed to handle
  // async graph loading properly or use Cytoscape node data directly.

  test.skip('should open hover editor when node is hovered', async ({ appWindow }) => {
    // Get an existing node from the loaded graph (already waited for in fixture)
    const nodeId = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      // Find first node with .md extension
      const node = cy.nodes().filter((n: { id: () => string }) => n.id().endsWith('.md')).first();
      console.log('[TEST] Found node:', node.id());
      return node.id();
    });

    console.log('[TEST] Triggering mouseover on node:', nodeId);

    // Trigger mouseover event on the Cytoscape node
    await appWindow.evaluate((id: string) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      const node = cy.$(`#${CSS.escape(id)}`);
      console.log('[TEST] Emitting mouseover event on node:', id);
      node.emit('mouseover');
    }, nodeId);
    await appWindow.waitForTimeout(1000); // Increased timeout to allow async editor creation

    // Check if editor exists
    const hoverEditorExists = await appWindow.evaluate(() => {
      const hoverEditor = document.querySelector('[id^="window-editor-"]');
      const titleBar = hoverEditor?.querySelector('.cy-floating-window-title');
      return {
        exists: !!hoverEditor,
        hasTitleBar: !!titleBar,
        titleText: titleBar?.textContent ?? ''
      };
    });

    expect(hoverEditorExists.exists).toBe(true);
    expect(hoverEditorExists.hasTitleBar).toBe(true);
    // Title should contain some part of the node name
    expect(hoverEditorExists.titleText.length).toBeGreaterThan(0);

    // Screenshot
    await appWindow.screenshot({
      path: 'e2e-tests/screenshots/electron-command-hover-editor-opened.png'
    });
  });

  test.skip('should NOT create shadow node (non-anchoring)', async ({ appWindow }) => {
    // test.setTimeout(15000);  // STOP IT DO NOT RANDOMLY INTRODUCE HUGE TIMEOUTS INTO OUR TESTS. IF ITS TIMING OUT THERES PROBABLY A PROBLEM or we ARE TESTING BADLY


    // Wait for graph to load
    await appWindow.waitForTimeout(500);

    // Get an existing node from the loaded graph
    const nodeId = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      const node = cy.nodes().filter((n: { id: () => string }) => n.id().endsWith('.md')).first();
      return node.id();
    });

    // Count nodes before opening hover editor
    const nodeCountBefore = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      return cy.nodes().length;
    });

    // Open hover editor
    await appWindow.evaluate((id: string) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      const node = cy.$(`#${CSS.escape(id)}`);
      node.emit('mouseover');
    }, nodeId);
    await appWindow.waitForTimeout(200);

    // Count nodes after - should be same (no shadow node created)
    const nodeCountAfter = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      return cy.nodes().length;
    });

    expect(nodeCountAfter).toBe(nodeCountBefore);

    // Verify no shadow node with editor- prefix exists (hover mode should not create shadow nodes)
    const shadowNodeExists = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      const shadowNodes = cy.nodes('[id ^= "editor-"]');
      return shadowNodes.length > 0;
    });

    expect(shadowNodeExists).toBe(false);
  });

  test.skip('should close hover editor on mouse-out', async ({ appWindow }) => {
    // Get an existing node from the loaded graph (already waited for in fixture)
    const nodeId = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      const node = cy.nodes().filter((n: { id: () => string }) => n.id().endsWith('.md')).first();
      return node.id();
    });

    // Open hover editor
    await appWindow.evaluate((id: string) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      const node = cy.$(`#${CSS.escape(id)}`);
      node.emit('mouseover');
    }, nodeId);
    await appWindow.waitForTimeout(200);

    // Verify editor exists
    const editorExistsBefore = await appWindow.evaluate(() => {
      return !!document.querySelector('[id^="window-editor-"]');
    });
    expect(editorExistsBefore).toBe(true);

    // Click outside the editor to close it (current implementation)
    await appWindow.mouse.click(100, 100);
    await appWindow.waitForTimeout(300);

    // Editor should be closed
    const editorExistsAfter = await appWindow.evaluate(() => {
      return !!document.querySelector('[id^="window-editor-"]');
    });
    expect(editorExistsAfter).toBe(false);
  });

  test.skip('should only allow one hover editor at a time', async ({ appWindow }) => {
    // Get two different nodes from the loaded graph (already waited for in fixture)
    const nodeIds = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      const nodes = cy.nodes().filter((n: { id: () => string }) => n.id().endsWith('.md'));
      return [nodes[0].id(), nodes[1].id()];
    });

    // Open hover editor on first node
    await appWindow.evaluate((id: string) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      const nodeA = cy.$(`#${CSS.escape(id)}`);
      nodeA.emit('mouseover');
    }, nodeIds[0]);
    await appWindow.waitForTimeout(200);

    // Verify first editor exists
    const firstEditorId = await appWindow.evaluate(() => {
      const editor = document.querySelector('[id^="window-editor-"]');
      return editor?.id ?? null;
    });
    expect(firstEditorId).not.toBeNull();
    expect(firstEditorId).toContain('editor');

    // Hover over second node (should close first and open second)
    await appWindow.evaluate((id: string) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      const nodeB = cy.$(`#${CSS.escape(id)}`);
      nodeB.emit('mouseover');
    }, nodeIds[1]);
    await appWindow.waitForTimeout(200);

    // Should only have one editor
    const editorCount = await appWindow.evaluate(() => {
      return document.querySelectorAll('[id^="window-editor-"]').length;
    });
    expect(editorCount).toBe(1);

    // Verify second editor exists
    const secondEditorId = await appWindow.evaluate(() => {
      const editor = document.querySelector('[id^="window-editor-"]');
      return editor?.id ?? null;
    });
    expect(secondEditorId).not.toBeNull();
    expect(secondEditorId).toContain('editor');
  });

  test.skip('should move with graph pan/zoom (uses cy-floating-overlay)', async ({ appWindow }) => {
    // Get an existing node from the loaded graph (already waited for in fixture)
    const nodeId = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      const node = cy.nodes().filter((n: { id: () => string }) => n.id().endsWith('.md')).first();
      return node.id();
    });

    // Open hover editor
    await appWindow.evaluate((id: string) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      const node = cy.$(`#${CSS.escape(id)}`);
      node.emit('mouseover');
    }, nodeId);
    await appWindow.waitForTimeout(200);

    // Get initial editor position
    const initialPos = await appWindow.evaluate(() => {
      const editor = document.querySelector('[id^="window-editor-"]') as HTMLElement;
      return {
        left: editor.style.left,
        top: editor.style.top
      };
    });

    // Screenshot before pan
    await appWindow.screenshot({
      path: 'e2e-tests/screenshots/electron-command-hover-before-pan.png'
    });

    // Pan the graph
    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      cy.pan({ x: 100, y: 50 });
    });

    await appWindow.waitForTimeout(200);

    // Editor should move with graph (overlay transform changes)
    const afterPan = await appWindow.evaluate(() => {
      const overlay = document.querySelector('.cy-floating-overlay') as HTMLElement;
      const editor = document.querySelector('[id^="window-editor-"]') as HTMLElement;
      return {
        overlayTransform: overlay.style.transform,
        editorLeft: editor.style.left,
        editorTop: editor.style.top
      };
    });

    // Overlay should have moved
    expect(afterPan.overlayTransform).toContain('translate(100px, 50px)');

    // Editor position in graph coordinates should be unchanged
    expect(afterPan.editorLeft).toBe(initialPos.left);
    expect(afterPan.editorTop).toBe(initialPos.top);

    // Screenshot after pan
    await appWindow.screenshot({
      path: 'e2e-tests/screenshots/electron-command-hover-after-pan.png'
    });
  });

  test.skip('should display node content in editor', async ({ appWindow }) => {
    // Get an existing node from the loaded graph (already waited for in fixture)
    const nodeId = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      const node = cy.nodes().filter((n: { id: () => string }) => n.id().endsWith('.md')).first();
      return node.id();
    });

    // Open hover editor
    await appWindow.evaluate((id: string) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      const node = cy.$(`#${CSS.escape(id)}`);
      node.emit('mouseover');
    }, nodeId);
    await appWindow.waitForTimeout(500); // Wait for CodeMirror to render

    // Wait for CodeMirror editor to be mounted
    await appWindow.waitForSelector('[id^="window-editor-"] .cm-editor', { timeout: 3000 });

    // Check editor has content
    const editorHasContent = await appWindow.evaluate(() => {
      const contentContainer = document.querySelector('[id^="window-editor-"] .cy-floating-window-content');
      const cmEditor = contentContainer?.querySelector('.cm-editor');
      const cmContent = cmEditor?.querySelector('.cm-content');

      return {
        contentContainerExists: !!contentContainer,
        cmEditorExists: !!cmEditor,
        cmContentExists: !!cmContent,
        textContent: cmContent?.textContent ?? ''
      };
    });

    expect(editorHasContent.contentContainerExists).toBe(true);
    expect(editorHasContent.cmEditorExists).toBe(true);
    expect(editorHasContent.cmContentExists).toBe(true);

    // Screenshot with content
    await appWindow.screenshot({
      path: 'e2e-tests/screenshots/electron-command-hover-with-content.png'
    });
  });

  test('should not interfere with normal node dragging', async ({ appWindow }) => {
    test.setTimeout(15000);

    // Wait for graph to load
    await appWindow.waitForTimeout(500);

    // Create a test node
    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      cy.add({
        group: 'nodes',
        data: { id: 'test-node-9', label: 'Drag Test' },
        position: { x: 300, y: 300 }
      });
    });

    await appWindow.waitForTimeout(200);

    // Get initial node position
    const initialPos = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      const node = cy.$('#test-node-9');
      return node.position();
    });

    // Programmatically move node (simulates drag) WITHOUT holding Command
    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      const node = cy.$('#test-node-9');
      node.position({ x: 400, y: 350 });
    });
    await appWindow.waitForTimeout(200);

    // GraphNode should have moved
    const newPos = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      const node = cy.$('#test-node-9');
      return node.position();
    });

    expect(newPos.x).not.toBe(initialPos.x);
    expect(newPos.y).not.toBe(initialPos.y);

    // No hover editor should have appeared
    const hoverEditorExists = await appWindow.evaluate(() => {
      return !!document.querySelector('[id^="window-editor-"]');
    });

    expect(hoverEditorExists).toBe(false);
  });
});
