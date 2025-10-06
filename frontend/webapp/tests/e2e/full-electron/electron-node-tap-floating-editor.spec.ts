// tests/e2e/full-electron/electron-node-tap-floating-editor.spec.ts
// E2E test for the PRIMARY REQUIREMENT: Node tap opens MarkdownEditor as floating window

import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

const PROJECT_ROOT = path.resolve(process.cwd());

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  tempDir: string;
}>({
  electronApp: async ({}, use) => {
    const electronApp = await electron.launch({
      args: [path.join(PROJECT_ROOT, 'dist-electron/main/index.js')],
      env: { ...process.env, NODE_ENV: 'test', HEADLESS_TEST: '1' }
    });
    await use(electronApp);
    await electronApp.close();
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();

    // Log console for debugging
    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    await window.waitForLoadState('domcontentloaded');

    // Wait for Cytoscape and graph to initialize
    await window.waitForFunction(() => (window as any).cytoscapeInstance, { timeout: 10000 });
    await window.waitForTimeout(1000);

    await use(window);
  },

  // Create temporary directory for test markdown files
  tempDir: async ({}, use) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'floating-window-test-'));
    console.log(`Created temp directory: ${dir}`);

    // Create test markdown files
    await fs.writeFile(
      path.join(dir, 'test-file-1.md'),
      '# Test File 1\n\nThis is the first test file for floating window tests.'
    );
    await fs.writeFile(
      path.join(dir, 'test-file-2.md'),
      '# Test File 2\n\nThis is the second test file.\n\n[[test-file-1]]'
    );
    await fs.writeFile(
      path.join(dir, 'test-file-3.md'),
      '# Test File 3\n\nThis is the third test file.\n\n[[test-file-1]]\n[[test-file-2]]'
    );

    await use(dir);

    // Clean up after test
    try {
      await fs.rm(dir, { recursive: true, force: true });
      console.log(`Cleaned up temp directory: ${dir}`);
    } catch (error) {
      console.error(`Failed to clean up temp directory: ${error}`);
    }
  }
});

test.describe('Node Tap -> Floating MarkdownEditor Integration', () => {

  test('should open MarkdownEditor floating window when tapping on a node', async ({ appWindow, tempDir }) => {
    // Start watching the temp directory with markdown files
    console.log('=== Starting file watching on temp directory ===');

    const watchResult = await appWindow.evaluate(async (dir) => {
      const api = (window as any).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.startFileWatching(dir);
    }, tempDir);

    expect(watchResult.success).toBe(true);
    console.log('File watching started:', watchResult);

    // Wait for files to be loaded and nodes to appear
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as any).cytoscapeInstance;
        return cy ? cy.nodes().length : 0;
      });
    }, {
      message: 'Waiting for markdown files to be loaded as nodes',
      intervals: [500, 1000, 2000],
      timeout: 10000
    }).toBeGreaterThan(0);

    // ✅ Test 1: Verify graph has nodes
    const nodeInfo = await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      const nodes = cy.nodes();
      return {
        nodeCount: nodes.length,
        firstNodeId: nodes.length > 0 ? nodes[0].id() : null,
        nodeIds: nodes.map((n: any) => n.id())
      };
    });

    console.log('Graph loaded with nodes:', nodeInfo);
    expect(nodeInfo.nodeCount).toBeGreaterThanOrEqual(3); // We created 3 files

    // ✅ Test 2: Tap/click on a node
    const tapResult = await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      const firstNode = cy.nodes().first();

      if (firstNode && firstNode.length > 0) {
        // Trigger tap event programmatically
        firstNode.trigger('tap');

        return {
          success: true,
          nodeId: firstNode.id(),
          position: firstNode.position()
        };
      }

      return { success: false, error: 'No node found to tap' };
    });

    expect(tapResult.success).toBe(true);
    console.log('Tapped node:', tapResult.nodeId);

    // ✅ Test 3: Verify floating window opens (behavior test)
    // The window should have an ID based on the node ID
    await appWindow.waitForTimeout(500); // Allow time for window to open

    const editorWindowExists = await appWindow.evaluate((nodeId) => {
      // Check for the new extension's floating window
      const expectedWindowId = `window-editor-${nodeId}`;
      const floatingWindow = document.getElementById(expectedWindowId);

      // Also check for shadow node in Cytoscape
      const cy = (window as any).cytoscapeInstance;
      const shadowNodeId = `editor-${nodeId}`;
      const shadowNode = cy ? cy.getElementById(shadowNodeId) : null;

      return {
        windowExists: !!floatingWindow,
        windowId: floatingWindow?.id,
        windowClass: floatingWindow?.className,
        shadowNodeExists: shadowNode && shadowNode.length > 0,
        shadowNodeId: shadowNode?.id()
      };
    }, tapResult.nodeId);

    console.log('Editor window state:', editorWindowExists);
    expect(editorWindowExists.windowExists).toBe(true);
    expect(editorWindowExists.windowClass).toContain('cy-floating-window');
    expect(editorWindowExists.shadowNodeExists).toBe(true);

    // ✅ Test 4: Verify window moves with graph pan (KEY BEHAVIOR TEST)
    const initialPosition = await appWindow.evaluate(() => {
      const floatingWindow = document.querySelector('.cy-floating-window') as HTMLElement;
      if (floatingWindow) {
        const rect = floatingWindow.getBoundingClientRect();
        return { x: rect.left, y: rect.top };
      }
      return null;
    });

    // Pan the graph
    await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      cy.pan({ x: 100, y: 100 });
    });

    await appWindow.waitForTimeout(200);

    const positionAfterPan = await appWindow.evaluate(() => {
      const floatingWindow = document.querySelector('.cy-floating-window') as HTMLElement;
      if (floatingWindow) {
        const rect = floatingWindow.getBoundingClientRect();
        return { x: rect.left, y: rect.top };
      }
      return null;
    });

    // Window should have moved with the pan
    expect(positionAfterPan).not.toBeNull();
    if (initialPosition && positionAfterPan) {
      expect(Math.abs(positionAfterPan.x - initialPosition.x)).toBeGreaterThan(50);
    }

    // ✅ Test 7: Verify window scales with graph zoom
    const sizeBeforeZoom = await appWindow.evaluate(() => {
      const floatingWindow = document.querySelector('[class*="floating-window"], [id*="window-"], .cy-floating-window') as HTMLElement;
      if (floatingWindow) {
        const rect = floatingWindow.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }
      return null;
    });

    // Zoom the graph
    await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      cy.zoom(1.5);
    });

    await appWindow.waitForTimeout(200);

    const sizeAfterZoom = await appWindow.evaluate(() => {
      const floatingWindow = document.querySelector('[class*="floating-window"], [id*="window-"], .cy-floating-window') as HTMLElement;
      if (floatingWindow) {
        const rect = floatingWindow.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }
      return null;
    });

    // Window should have scaled with zoom
    if (sizeBeforeZoom && sizeAfterZoom) {
      expect(sizeAfterZoom.width).toBeGreaterThan(sizeBeforeZoom.width);
    }

    // ✅ Test 8: Verify typing still works after graph interactions
    await textarea.click();
    await textarea.press('End'); // Go to end of text
    await textarea.type('\n\nAdded after zoom and pan!');

    const finalContent = await textarea.inputValue();
    expect(finalContent).toContain('Added after zoom and pan!');

    // ✅ Test 9: Screenshot for visual verification
    await appWindow.screenshot({
      path: 'tests/screenshots/electron-node-tap-floating-editor.png'
    });
  });

  test('should not interfere with graph interactions when interacting with editor', async ({ appWindow, tempDir }) => {
    // Start watching the temp directory
    const watchResult = await appWindow.evaluate(async (dir) => {
      const api = (window as any).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.startFileWatching(dir);
    }, tempDir);

    expect(watchResult.success).toBe(true);

    // Wait for nodes to appear
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as any).cytoscapeInstance;
        return cy ? cy.nodes().length : 0;
      });
    }, { timeout: 10000 }).toBeGreaterThan(0);

    // Open an editor window first
    const tapResult = await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      const firstNode = cy.nodes().first();

      if (firstNode && firstNode.length > 0) {
        firstNode.trigger('tap');
        return { success: true, nodeId: firstNode.id() };
      }

      return { success: false };
    });

    expect(tapResult.success).toBe(true);
    await appWindow.waitForTimeout(500);

    // Get initial graph pan position
    const initialPan = await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      return cy.pan();
    });

    // Select text in the editor (drag across text)
    const textareaSelector = '[class*="floating-window"] textarea, [id*="window-"] textarea, .cy-floating-window textarea';
    const textarea = await appWindow.locator(textareaSelector).first();

    // Type some text first
    await textarea.fill('Select this text without panning the graph');

    // Simulate text selection by dragging
    const box = await textarea.boundingBox();
    if (box) {
      await appWindow.mouse.move(box.x + 10, box.y + box.height / 2);
      await appWindow.mouse.down();
      await appWindow.mouse.move(box.x + 200, box.y + box.height / 2);
      await appWindow.mouse.up();
    }

    // Verify graph did NOT pan during text selection
    const panAfterSelection = await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      return cy.pan();
    });

    expect(panAfterSelection).toEqual(initialPan);

    // Verify text was actually selected
    const selectedText = await appWindow.evaluate(() => {
      const textarea = document.querySelector('[class*="floating-window"] textarea, [id*="window-"] textarea, .cy-floating-window textarea') as HTMLTextAreaElement;
      if (textarea) {
        return window.getSelection()?.toString() || textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
      }
      return '';
    });

    expect(selectedText.length).toBeGreaterThan(0);
  });

  test('should handle multiple floating windows from different nodes', async ({ appWindow, tempDir }) => {
    // Start watching the temp directory
    const watchResult = await appWindow.evaluate(async (dir) => {
      const api = (window as any).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.startFileWatching(dir);
    }, tempDir);

    expect(watchResult.success).toBe(true);

    // Wait for nodes to appear
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as any).cytoscapeInstance;
        return cy ? cy.nodes().length : 0;
      });
    }, { timeout: 10000 }).toBeGreaterThanOrEqual(2);

    // Get multiple nodes
    const nodesInfo = await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      const nodes = cy.nodes();
      return {
        count: nodes.length,
        nodeIds: nodes.slice(0, 3).map((n: any) => n.id()) // Get up to 3 node IDs
      };
    });

    expect(nodesInfo.count).toBeGreaterThanOrEqual(2);

    // Tap on first node
    await appWindow.evaluate((nodeId) => {
      const cy = (window as any).cytoscapeInstance;
      const node = cy.getElementById(nodeId);
      node.trigger('tap');
    }, nodesInfo.nodeIds[0]);

    await appWindow.waitForTimeout(500);

    // Tap on second node
    await appWindow.evaluate((nodeId) => {
      const cy = (window as any).cytoscapeInstance;
      const node = cy.getElementById(nodeId);
      node.trigger('tap');
    }, nodesInfo.nodeIds[1]);

    await appWindow.waitForTimeout(500);

    // Verify multiple windows are open
    const windowsInfo = await appWindow.evaluate(() => {
      const windows = document.querySelectorAll('[class*="floating-window"], [id*="window-"], .cy-floating-window');
      return {
        count: windows.length,
        hasMultipleEditors: Array.from(windows).filter(w =>
          w.querySelector('textarea') || w.querySelector('[class*="markdown"]')
        ).length
      };
    });

    expect(windowsInfo.count).toBeGreaterThanOrEqual(2);
    expect(windowsInfo.hasMultipleEditors).toBeGreaterThanOrEqual(2);
  });
});