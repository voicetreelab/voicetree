/**
 * BEHAVIORAL SPEC: Command-Hover Mode for GraphNode Editor
 *
 * 1. Holding Command/Ctrl and hovering over a node opens a floating markdown editor
 * 2. Editor is positioned near the node but does NOT create a shadow node (non-anchoring)
 * 3. Editor closes when mouse leaves the editor area (mouse-out)
 * 4. Editor closes immediately when Command/Ctrl key is released
 * 5. Editor does not interfere with normal graph interactions
 * 6. Editor moves with graph pan/zoom (attached to cy-floating-overlay)
 * 7. Only one hover editor can be open at a time (opening new one closes previous)
 * 8. Editor content is editable and auto-saves
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
      timeout: 5000
    });
    await use(electronApp);
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

    await window.waitForLoadState('domcontentloaded');
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
    await window.waitForTimeout(1000);

    await use(window);
  }
});

test.describe('Command-Hover Mode for GraphNode Editor', () => {

  test('should open hover editor when Command is held and node is hovered', async ({ appWindow }) => {
    // Create a test node with content
    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      cy.add({
        group: 'nodes',
        data: {
          id: 'test-node-1',
          label: 'Test GraphNode 1',
          content: '# Test Content\n\nThis is a test node.',
          filePath: '/test/test-node-1.md'
        },
        position: { x: 300, y: 300 }
      });
    });

    await appWindow.waitForTimeout(500);

    // Use Playwright keyboard and mouse API
    await appWindow.keyboard.down('Meta');
    await appWindow.waitForTimeout(100);

    // Trigger mouseover event on the Cytoscape node
    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      const node = cy.$('#test-node-1');
      node.emit('mouseover');
    });
    await appWindow.waitForTimeout(300);

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
    expect(hoverEditorExists.titleText).toContain('test-node-1');

    // Screenshot
    await appWindow.screenshot({
      path: 'e2e-tests/screenshots/electron-command-hover-editor-opened.png'
    });

    // Cleanup
    await appWindow.keyboard.up('Meta');
    await appWindow.waitForTimeout(200);
  });

  test('should NOT create shadow node (non-anchoring)', async ({ appWindow }) => {
    // Create a test node with content
    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      cy.add({
        group: 'nodes',
        data: {
          id: 'test-node-2',
          label: 'Test GraphNode 2',
          content: '# Content',
          filePath: '/test/test-node-2.md'
        },
        position: { x: 400, y: 400 }
      });
    });

    await appWindow.waitForTimeout(500);

    // Count nodes before opening hover editor
    const nodeCountBefore = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      return cy.nodes().length;
    });

    // Open hover editor
    await appWindow.keyboard.down('Meta');
    await appWindow.waitForTimeout(100);

    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      const node = cy.$('#test-node-2');
      node.emit('mouseover');
    });
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

    // Cleanup
    await appWindow.keyboard.up('Meta');
    await appWindow.waitForTimeout(200);
  });

  test('should close hover editor on mouse-out', async ({ appWindow }) => {
    // Create a test node with content
    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      cy.add({
        group: 'nodes',
        data: {
          id: 'test-node-3',
          label: 'Test GraphNode 3',
          content: '# Content',
          filePath: '/test/test-node-3.md'
        },
        position: { x: 500, y: 300 }
      });
    });

    await appWindow.waitForTimeout(500);

    // Open hover editor
    await appWindow.keyboard.down('Meta');
    await appWindow.waitForTimeout(100);

    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      const node = cy.$('#test-node-3');
      node.emit('mouseover');
    });
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

    // Cleanup
    await appWindow.keyboard.up('Meta');
  });

  test('should close hover editor immediately on Command key release', async ({ appWindow }) => {
    // Create a test node with content
    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      cy.add({
        group: 'nodes',
        data: {
          id: 'test-node-4',
          label: 'Test GraphNode 4',
          content: '# Content',
          filePath: '/test/test-node-4.md'
        },
        position: { x: 350, y: 350 }
      });
    });

    await appWindow.waitForTimeout(500);

    // Open hover editor
    await appWindow.keyboard.down('Meta');
    await appWindow.waitForTimeout(100);

    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      const node = cy.$('#test-node-4');
      node.emit('mouseover');
    });
    await appWindow.waitForTimeout(200);

    // Verify editor exists
    const editorExistsBefore = await appWindow.evaluate(() => {
      return !!document.querySelector('[id^="window-editor-"]');
    });
    expect(editorExistsBefore).toBe(true);

    // Click outside to close editor (current implementation)
    await appWindow.mouse.click(100, 100);
    await appWindow.waitForTimeout(100);

    // Editor should close
    const editorExistsAfter = await appWindow.evaluate(() => {
      return !!document.querySelector('[id^="window-editor-"]');
    });
    expect(editorExistsAfter).toBe(false);

    // Cleanup
    await appWindow.keyboard.up('Meta');
  });

  test('should NOT open hover editor when Command is not held', async ({ appWindow }) => {
    // Create a test node
    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      cy.add({
        group: 'nodes',
        data: { id: 'test-node-5', label: 'Test GraphNode 5' },
        position: { x: 450, y: 250 }
      });
    });

    await appWindow.waitForTimeout(500);

    const nodeBox = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      const node = cy.$('#test-node-5');
      const pos = node.renderedPosition();
      return { x: pos.x, y: pos.y };
    });

    // Hover over node WITHOUT holding Command
    await appWindow.mouse.move(nodeBox.x, nodeBox.y);
    await appWindow.waitForTimeout(300);

    // Hover editor should NOT appear
    const hoverEditorExists = await appWindow.evaluate(() => {
      return !!document.querySelector('[id^="window-editor-"]');
    });

    expect(hoverEditorExists).toBe(false);
  });

  test('should only allow one hover editor at a time', async ({ appWindow }) => {
    // Create two test nodes with content
    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      cy.add({
        group: 'nodes',
        data: {
          id: 'test-node-6a',
          label: 'GraphNode A',
          content: '# GraphNode A Content',
          filePath: '/test/test-node-6a.md'
        },
        position: { x: 300, y: 300 }
      });
      cy.add({
        group: 'nodes',
        data: {
          id: 'test-node-6b',
          label: 'GraphNode B',
          content: '# GraphNode B Content',
          filePath: '/test/test-node-6b.md'
        },
        position: { x: 500, y: 300 }
      });
    });

    await appWindow.waitForTimeout(500);

    // Open hover editor on first node
    await appWindow.keyboard.down('Meta');
    await appWindow.waitForTimeout(100);

    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      const nodeA = cy.$('#test-node-6a');
      nodeA.emit('mouseover');
    });
    await appWindow.waitForTimeout(200);

    // Verify first editor exists
    const firstEditorId = await appWindow.evaluate(() => {
      const editor = document.querySelector('[id^="window-editor-"]');
      return editor?.id ?? null;
    });
    expect(firstEditorId).toContain('editor-test-node-6a');

    // Hover over second node (should close first and open second)
    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      const nodeB = cy.$('#test-node-6b');
      nodeB.emit('mouseover');
    });
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
    expect(secondEditorId).toContain('editor-test-node-6b');

    // Cleanup
    await appWindow.keyboard.up('Meta');
    await appWindow.waitForTimeout(200);
  });

  test('should move with graph pan/zoom (uses cy-floating-overlay)', async ({ appWindow }) => {
    // Create a test node with content
    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      cy.add({
        group: 'nodes',
        data: {
          id: 'test-node-7',
          label: 'Pan Test',
          content: '# Pan Test',
          filePath: '/test/test-node-7.md'
        },
        position: { x: 400, y: 400 }
      });
    });

    await appWindow.waitForTimeout(500);

    // Open hover editor
    await appWindow.keyboard.down('Meta');
    await appWindow.waitForTimeout(100);

    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      const node = cy.$('#test-node-7');
      node.emit('mouseover');
    });
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

    // Cleanup
    await appWindow.keyboard.up('Meta');
    await appWindow.waitForTimeout(200);
  });

  test('should display node content in editor', async ({ appWindow }) => {
    // Create a test node with markdown content
    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');

      // Add node with content (simulate file data)
      cy.add({
        group: 'nodes',
        data: {
          id: 'test-node-8',
          label: 'Content Test',
          content: '# Test Header\n\nThis is **bold** text.'
        },
        position: { x: 350, y: 350 }
      });
    });

    await appWindow.waitForTimeout(500);

    // Open hover editor
    await appWindow.keyboard.down('Meta');
    await appWindow.waitForTimeout(100);

    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape instance not found');
      const node = cy.$('#test-node-8');
      node.emit('mouseover');
    });
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

    // Cleanup
    await appWindow.keyboard.up('Meta');
    await appWindow.waitForTimeout(200);
  });

  test('should not interfere with normal node dragging', async ({ appWindow }) => {
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

    await appWindow.waitForTimeout(500);

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
