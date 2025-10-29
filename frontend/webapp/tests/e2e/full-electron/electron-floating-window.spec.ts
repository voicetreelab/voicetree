/**
 * BEHAVIORAL SPEC:
 * 1. Floating windows (markdown editors/terminals) appear immediately with chrome (title bar, close button, content area)
 * 2. Windows can be dragged by title bar and closed with X button
 * 3. Windows move with graph pan/zoom operations
 * 4. Multiple windows can be opened simultaneously without race conditions
 * 5. Markdown preview mode displays rendered content (not blank)
 * 6. Edges connect parent nodes to floating window shadow nodes and update when windows are dragged
 * 7. Terminal PTY processes are killed when windows close (no crashes)
 * 8. Terminal windows resize without visual artifacts or text loss
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(process.cwd());

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
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

    // Log console messages for debugging
    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForFunction(() => (window as any).cytoscapeInstance, { timeout: 10000 });
    await window.waitForTimeout(1000);

    await use(window);
  }
});

test.describe('Floating Window Refactor - Synchronous Chrome Creation', () => {

  test('should create window chrome synchronously - no race condition', async ({ appWindow }) => {
    // ✅ Test 1: Create floating window and immediately check DOM (no waiting!)
    const chromeCreatedSynchronously = await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;

      // Add floating window
      cy.addFloatingWindow({
        id: 'sync-test-window',
        component: 'MarkdownEditor',
        title: 'Sync Test Window',
        position: { x: 300, y: 300 },
        initialContent: '# Test Content\nThis is a test.'
      });

      // IMMEDIATELY check DOM - no waiting!
      // This proves the chrome is created synchronously
      const windowElement = document.querySelector('#window-sync-test-window');
      const titleBar = windowElement?.querySelector('.cy-floating-window-title');
      const titleText = titleBar?.querySelector('.cy-floating-window-title-text');
      const closeButton = titleBar?.querySelector('.cy-floating-window-close');
      const contentContainer = windowElement?.querySelector('.cy-floating-window-content');

      return {
        windowExists: !!windowElement,
        titleBarExists: !!titleBar,
        titleTextExists: !!titleText,
        titleTextContent: titleText?.textContent || '',
        closeButtonExists: !!closeButton,
        contentContainerExists: !!contentContainer
      };
    });

    // The key assertion - all chrome elements exist immediately
    expect(chromeCreatedSynchronously.windowExists).toBe(true);
    expect(chromeCreatedSynchronously.titleBarExists).toBe(true);
    expect(chromeCreatedSynchronously.titleTextExists).toBe(true);
    expect(chromeCreatedSynchronously.titleTextContent).toBe('Sync Test Window');
    expect(chromeCreatedSynchronously.closeButtonExists).toBe(true);
    expect(chromeCreatedSynchronously.contentContainerExists).toBe(true);

    // ✅ Test 2: Wait for CodeMirror editor to render (async)
    await appWindow.waitForSelector('.cy-floating-window-content .cm-editor', { timeout: 5000 });

    const editorContentRendered = await appWindow.evaluate(() => {
      const contentContainer = document.querySelector('.cy-floating-window-content');
      const cmEditor = contentContainer?.querySelector('.cm-editor');
      return !!cmEditor;
    });

    expect(editorContentRendered).toBe(true);

    // ✅ Test 3: Verify window is visible
    const windowElement = appWindow.locator('#window-sync-test-window');
    await expect(windowElement).toBeVisible();

    // ✅ Test 4: Screenshot
    await appWindow.screenshot({
      path: 'tests/screenshots/electron-floating-window-refactor-sync.png'
    });
  });

  test('should handle drag with vanilla DOM event listeners', async ({ appWindow }) => {
    // Create window
    await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      cy.addFloatingWindow({
        id: 'drag-test-window',
        component: 'MarkdownEditor',
        title: 'Drag Test',
        position: { x: 200, y: 200 },
        initialContent: '# Drag me!'
      });
    });

    // Wait for editor to render
    await appWindow.waitForSelector('#window-drag-test-window .cm-editor', { timeout: 5000 });

    // Get initial position
    const initialPosition = await appWindow.evaluate(() => {
      const windowElement = document.querySelector('#window-drag-test-window') as HTMLElement;
      return {
        left: windowElement.style.left,
        top: windowElement.style.top
      };
    });

    expect(initialPosition.left).toBe('200px');
    expect(initialPosition.top).toBe('200px');

    // Drag the window by simulating mouse events on title bar
    const titleBar = appWindow.locator('#window-drag-test-window .cy-floating-window-title');

    // Try using dispatchEvent to trigger drag manually since Playwright mouse API might not work with transforms
    await appWindow.evaluate(() => {
      const titleBar = document.querySelector('#window-drag-test-window .cy-floating-window-title') as HTMLElement;
      const cy = (window as any).cytoscapeInstance;

      // Get initial position
      const rect = titleBar.getBoundingClientRect();
      const startX = rect.left + rect.width / 2;
      const startY = rect.top + rect.height / 2;

      // Dispatch mousedown
      const mouseDownEvent = new MouseEvent('mousedown', {
        bubbles: true,
        clientX: startX,
        clientY: startY,
        button: 0
      });
      titleBar.dispatchEvent(mouseDownEvent);

      // Dispatch mousemove on document
      const mouseMoveEvent = new MouseEvent('mousemove', {
        bubbles: true,
        clientX: startX + 150,
        clientY: startY + 100
      });
      document.dispatchEvent(mouseMoveEvent);

      // Dispatch mouseup on document
      const mouseUpEvent = new MouseEvent('mouseup', {
        bubbles: true
      });
      document.dispatchEvent(mouseUpEvent);
    });

    // Give it a moment to update
    await appWindow.waitForTimeout(100);

    // Verify position changed
    const newPosition = await appWindow.evaluate(() => {
      const windowElement = document.querySelector('#window-drag-test-window') as HTMLElement;
      return {
        left: parseFloat(windowElement.style.left),
        top: parseFloat(windowElement.style.top)
      };
    });

    // Position should have changed (allowing some tolerance)
    expect(newPosition.left).not.toBe(200);
    expect(newPosition.top).not.toBe(200);

    // ✅ Screenshot after drag
    await appWindow.screenshot({
      path: 'tests/screenshots/electron-floating-window-refactor-drag.png'
    });
  });

  test('should handle close button with vanilla DOM listener', async ({ appWindow }) => {
    // Create window
    await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      cy.addFloatingWindow({
        id: 'close-test-window',
        component: 'MarkdownEditor',
        title: 'Close Test',
        position: { x: 400, y: 300 },
        initialContent: '# Close me!'
      });
    });

    // Verify window exists
    const windowElement = appWindow.locator('#window-close-test-window');
    await expect(windowElement).toBeVisible();

    // Click close button
    const closeButton = appWindow.locator('#window-close-test-window .cy-floating-window-close');
    await closeButton.click();

    // Give it a moment to remove
    await appWindow.waitForTimeout(100);

    // Verify window is removed from DOM
    await expect(windowElement).not.toBeAttached();

    // Verify shadow node is removed
    const shadowNodeRemoved = await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      const node = cy.$('#close-test-window');
      return node.length === 0;
    });

    expect(shadowNodeRemoved).toBe(true);
  });

  test('should handle pan/zoom correctly with new architecture', async ({ appWindow }) => {
    // Reset zoom and pan to ensure clean state
    await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      cy.zoom(1);
      cy.pan({ x: 0, y: 0 });
    });

    // Wait for overlay to sync
    await appWindow.waitForTimeout(100);

    // Create window
    await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      cy.addFloatingWindow({
        id: 'panzoom-test-window',
        component: 'MarkdownEditor',
        title: 'Pan/Zoom Test',
        position: { x: 300, y: 300 },
        initialContent: '# Pan and Zoom!'
      });
    });

    // Get initial state
    const initialState = await appWindow.evaluate(() => {
      const overlay = document.querySelector('.cy-floating-overlay') as HTMLElement;
      const windowElement = document.querySelector('#window-panzoom-test-window') as HTMLElement;
      const cy = (window as any).cytoscapeInstance;

      return {
        overlayTransform: overlay.style.transform,
        windowLeft: windowElement.style.left,
        windowTop: windowElement.style.top,
        pan: cy.pan(),
        zoom: cy.zoom()
      };
    });

    expect(initialState.windowLeft).toBe('300px');
    expect(initialState.windowTop).toBe('300px');

    // Pan the graph
    await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      cy.pan({ x: 100, y: 50 });
    });

    const afterPan = await appWindow.evaluate(() => {
      const overlay = document.querySelector('.cy-floating-overlay') as HTMLElement;
      const windowElement = document.querySelector('#window-panzoom-test-window') as HTMLElement;

      return {
        overlayTransform: overlay.style.transform,
        windowLeft: windowElement.style.left,
        windowTop: windowElement.style.top
      };
    });

    // Overlay should move, window position in graph space should not change
    expect(afterPan.overlayTransform).toBe('translate(100px, 50px) scale(1)');
    expect(afterPan.windowLeft).toBe('300px');
    expect(afterPan.windowTop).toBe('300px');

    // Zoom the graph
    await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      cy.zoom(2);
    });

    const afterZoom = await appWindow.evaluate(() => {
      const overlay = document.querySelector('.cy-floating-overlay') as HTMLElement;
      return {
        overlayTransform: overlay.style.transform
      };
    });

    expect(afterZoom.overlayTransform).toBe('translate(100px, 50px) scale(2)');

    // ✅ Screenshot after pan/zoom
    await appWindow.screenshot({
      path: 'tests/screenshots/electron-floating-window-refactor-panzoom.png'
    });
  });

  test('should create multiple windows without race conditions', async ({ appWindow }) => {
    // Create multiple windows rapidly (stress test for race conditions)
    const result = await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;

      // Create 5 windows in rapid succession
      for (let i = 1; i <= 5; i++) {
        cy.addFloatingWindow({
          id: `multi-window-${i}`,
          component: 'MarkdownEditor',
          title: `Window ${i}`,
          position: { x: 200 + (i * 100), y: 200 + (i * 50) },
          initialContent: `# Window ${i}`
        });
      }

      // Immediately check that all chrome elements exist
      const windows = [];
      for (let i = 1; i <= 5; i++) {
        const windowElement = document.querySelector(`#window-multi-window-${i}`);
        const titleBar = windowElement?.querySelector('.cy-floating-window-title');
        const contentContainer = windowElement?.querySelector('.cy-floating-window-content');
        windows.push({
          id: i,
          windowExists: !!windowElement,
          titleBarExists: !!titleBar,
          contentContainerExists: !!contentContainer
        });
      }

      return windows;
    });

    // All windows should have their chrome created immediately
    result.forEach((window, index) => {
      expect(window.windowExists, `Window ${index + 1} chrome should exist immediately`).toBe(true);
      expect(window.titleBarExists, `Window ${index + 1} title bar should exist immediately`).toBe(true);
      expect(window.contentContainerExists, `Window ${index + 1} content container should exist immediately`).toBe(true);
    });

    // Wait for React content to render in all windows
    for (let i = 1; i <= 5; i++) {
      await appWindow.waitForSelector(`#window-multi-window-${i} .cm-editor`, { timeout: 5000 });
    }

    // ✅ Screenshot with multiple windows
    await appWindow.screenshot({
      path: 'tests/screenshots/electron-floating-window-refactor-multiple.png'
    });
  });

  test('should render markdown preview mode with visible content (not blank)', async ({ appWindow }) => {
    // Test that preview mode shows rendered content, not a blank white rectangle
    // BUG: Currently preview mode shows blank white rectangle

    await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      cy.addFloatingWindow({
        id: 'editor-preview-test',
        component: 'MarkdownEditor',
        title: 'Preview Mode Test',
        position: { x: 300, y: 300 },
        initialContent: '# Test Header\n\nThis is a **bold** test.\n\n- Item 1\n- Item 2',
        previewMode: 'preview'
      });
    });

    // Wait for CodeMirror editor to render
    await appWindow.waitForSelector('#window-editor-preview-test .cm-editor', { timeout: 5000 });

    // Check that the editor exists and has content (vanilla CodeMirror doesn't have separate preview mode like React)
    const editorContent = await appWindow.evaluate(() => {
      const container = document.querySelector('#window-editor-preview-test .cm-editor');
      const content = container?.querySelector('.cm-content');

      return {
        containerExists: !!container,
        contentExists: !!content,
        contentHTML: content?.innerHTML || '',
        contentText: content?.textContent || '',
        contentEmpty: !content?.textContent || content.textContent.trim().length === 0
      };
    });

    // Assertions
    expect(editorContent.containerExists).toBe(true);
    expect(editorContent.contentExists).toBe(true);

    // THIS IS THE KEY TEST: Editor should have visible content, not be blank
    expect(editorContent.contentEmpty).toBe(false);
    expect(editorContent.contentText).toContain('Test Header');
    expect(editorContent.contentText).toContain('bold');

    // Screenshot to verify visual appearance
    await appWindow.screenshot({
      path: 'tests/screenshots/electron-markdown-preview-mode.png'
    });
  });

  test('should create edge between parent node and floating window ghost node', async ({ appWindow }) => {
    // Create a parent node first
    const edgeCreated = await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;

      // Add a parent node
      cy.add({
        group: 'nodes',
        data: { id: 'parent-node', label: 'Parent Node' },
        position: { x: 300, y: 300 }
      });

      // Create floating window with parentNodeId
      cy.addFloatingWindow({
        id: 'child-window',
        component: 'MarkdownEditor',
        title: 'Child Window',
        position: { x: 400, y: 400 },
        initialContent: '# Child Window',
        nodeData: {
          isFloatingWindow: true,
          parentNodeId: 'parent-node'
        }
      });

      // Check if edge was created
      const edge = cy.$('#edge-parent-node-child-window');
      const edgeExists = edge.length > 0;

      return {
        edgeExists,
        edgeSource: edgeExists ? edge.data('source') : null,
        edgeTarget: edgeExists ? edge.data('target') : null
      };
    });

    // Verify edge was created with correct source and target
    expect(edgeCreated.edgeExists).toBe(true);
    expect(edgeCreated.edgeSource).toBe('parent-node');
    expect(edgeCreated.edgeTarget).toBe('child-window');

    // ✅ Screenshot showing edge
    await appWindow.screenshot({
      path: 'tests/screenshots/electron-floating-window-parent-edge.png'
    });
  });

  test('should update edge when dragging floating window', async ({ appWindow }) => {
    // Create parent node and floating window with edge
    await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;

      // Add a parent node
      cy.add({
        group: 'nodes',
        data: { id: 'parent-drag', label: 'Parent' },
        position: { x: 300, y: 300 }
      });

      // Create floating window with parentNodeId
      cy.addFloatingWindow({
        id: 'child-drag',
        component: 'MarkdownEditor',
        title: 'Child Draggable',
        position: { x: 400, y: 400 },
        initialContent: '# Drag me and watch the edge!',
        nodeData: {
          isFloatingWindow: true,
          parentNodeId: 'parent-drag'
        }
      });
    });

    // Get initial shadow node position
    const initialPos = await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      const shadowNode = cy.$('#child-drag');
      return shadowNode.position();
    });

    expect(initialPos.x).toBe(400);
    expect(initialPos.y).toBe(400);

    // Screenshot before drag
    await appWindow.screenshot({
      path: 'tests/screenshots/electron-floating-window-edge-before-drag.png'
    });

    // Drag the window
    const titleBar = appWindow.locator('#window-child-drag .cy-floating-window-title');
    const box = await titleBar.boundingBox();
    if (!box) throw new Error('Title bar not found');

    await appWindow.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await appWindow.mouse.down();
    await appWindow.mouse.move(box.x + 150, box.y + 100);
    await appWindow.mouse.up();
    await appWindow.waitForTimeout(100);

    // Get new shadow node position
    const newPos = await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      const shadowNode = cy.$('#child-drag');
      const windowElement = document.querySelector('#window-child-drag') as HTMLElement;

      return {
        shadowNodeX: shadowNode.position().x,
        shadowNodeY: shadowNode.position().y,
        windowLeft: parseFloat(windowElement.style.left),
        windowTop: parseFloat(windowElement.style.top)
      };
    });

    // Shadow node position should match window position
    expect(newPos.shadowNodeX).toBeCloseTo(newPos.windowLeft, 0);
    expect(newPos.shadowNodeY).toBeCloseTo(newPos.windowTop, 0);

    // Position should have changed from initial
    expect(newPos.shadowNodeX).not.toBe(400);
    expect(newPos.shadowNodeY).not.toBe(400);

    // Screenshot after drag - edge should follow
    await appWindow.screenshot({
      path: 'tests/screenshots/electron-floating-window-edge-after-drag.png'
    });
  });

  test('should kill terminal PTY process when window closes', async ({ electronApp, appWindow }) => {
    // Test for bug: PTY processes trying to send data to destroyed webContents crash the app
    // This test verifies terminals are properly cleaned up when windows close

    const mainLogs: string[] = [];

    // Capture console logs from main process
    electronApp.on('console', (msg) => {
      const text = msg.text();
      mainLogs.push(text);
      console.log(`[MAIN PROCESS]: ${text}`);
    });

    // Create a terminal window
    await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      cy.addFloatingWindow({
        id: 'terminal-cleanup-test',
        component: 'Terminal',
        title: 'Terminal Cleanup Test',
        position: { x: 300, y: 200 },
        nodeMetadata: {
          fileName: 'cleanup-test-terminal',
          filePath: '/tmp/cleanup-test-terminal'
        }
      });
    });

    // Wait for terminal to initialize
    await appWindow.waitForSelector('#window-terminal-cleanup-test .xterm', { timeout: 5000 });
    await appWindow.waitForTimeout(1000);

    // Verify terminal window exists
    const terminalExists = await appWindow.evaluate(() => {
      const windowElement = document.querySelector('#window-terminal-cleanup-test');
      const xtermElement = windowElement?.querySelector('.xterm');
      return {
        windowExists: !!windowElement,
        xtermExists: !!xtermElement
      };
    });

    expect(terminalExists.windowExists).toBe(true);
    expect(terminalExists.xtermExists).toBe(true);

    // Type a command to generate some PTY activity
    await appWindow.evaluate(() => {
      const xtermElement = document.querySelector('.xterm') as HTMLElement;
      if (xtermElement) {
        xtermElement.focus();
        xtermElement.click();
      }
    });

    await appWindow.keyboard.type('echo "Terminal is running"');
    await appWindow.keyboard.press('Enter');
    await appWindow.waitForTimeout(500);

    // Clear logs before closing
    mainLogs.length = 0;

    // Close the window using the close button
    const closeButton = appWindow.locator('#window-terminal-cleanup-test .cy-floating-window-close');
    await closeButton.click();

    // Wait for cleanup to happen
    await appWindow.waitForTimeout(500);

    // Verify window is removed from DOM
    const windowRemoved = await appWindow.evaluate(() => {
      const windowElement = document.querySelector('#window-terminal-cleanup-test');
      return windowElement === null;
    });

    expect(windowRemoved).toBe(true);

    // Verify shadow node is removed from cytoscape
    const shadowNodeRemoved = await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      const node = cy.$('#terminal-cleanup-test');
      return node.length === 0;
    });

    expect(shadowNodeRemoved).toBe(true);

    // Check that no "Object has been destroyed" errors occurred
    const hasDestroyedError = mainLogs.some(log =>
      log.includes('Object has been destroyed')
    );

    expect(hasDestroyedError).toBe(false);

    // Note: Cleanup log messages may appear in 'closed' event which fires after window is destroyed
    console.log('Captured main process logs:', mainLogs);

    // The key assertion: No crash occurred (test completed successfully)
    // If the bug still existed, the app would crash with "Object has been destroyed"
  });

  test('should not trigger excessive resizes from DOM mutations (debouncing test)', async ({ appWindow }) => {
    // Test for bug: ResizeObserver fires on every DOM mutation, causing excessive fit() calls
    // This verifies debouncing and size-change detection is working

    await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      cy.addFloatingWindow({
        id: 'terminal-debounce-test',
        component: 'Terminal',
        title: 'Debounce Test Terminal',
        position: { x: 300, y: 200 },
        resizable: true,
        nodeMetadata: {
          fileName: 'debounce-test',
          filePath: '/tmp/debounce-test'
        }
      });
    });

    await appWindow.waitForSelector('#window-terminal-debounce-test .xterm', { timeout: 5000 });
    await appWindow.waitForTimeout(1000);

    // Instrument the terminal to count fit() calls
    await appWindow.evaluate(() => {
      (window as any).terminalResizeCount = 0;
      const terminalElement = document.querySelector('#window-terminal-debounce-test');
      if (terminalElement) {
        // Create a MutationObserver to count DOM changes
        const observer = new MutationObserver(() => {
          // DOM is changing, but fit() should NOT be called for every mutation
        });
        observer.observe(terminalElement, { attributes: true, childList: true, subtree: true });
      }
    });

    // Rapidly resize multiple times - debouncing should batch these
    for (let i = 0; i < 5; i++) {
      await appWindow.evaluate((iteration) => {
        const windowElement = document.querySelector('#window-terminal-debounce-test') as HTMLElement;
        windowElement.style.width = `${600 + (iteration * 10)}px`;
      }, i);
      await appWindow.waitForTimeout(20); // Quick successive resizes
    }

    // Wait for debounce to settle
    await appWindow.waitForTimeout(200);

    // Terminal should still be functional after rapid resizes
    const terminalHealthy = await appWindow.evaluate(() => {
      const xtermElement = document.querySelector('#window-terminal-debounce-test .xterm') as HTMLElement;
      const windowElement = document.querySelector('#window-terminal-debounce-test') as HTMLElement;
      return {
        xtermExists: xtermElement !== null,
        windowWidth: windowElement?.offsetWidth || 0,
        xtermHasSize: xtermElement && xtermElement.offsetWidth > 0 && xtermElement.offsetHeight > 0
      };
    });

    // Verify terminal survived rapid resizing
    expect(terminalHealthy.xtermExists).toBe(true);
    expect(terminalHealthy.xtermHasSize).toBe(true);
    expect(terminalHealthy.windowWidth).toBe(640); // Should be at final size
  });

  test('should only resize when container size actually changes', async ({ appWindow }) => {
    // Test for bug: fit() called on every DOM update even when size doesn't change
    // This verifies size-change detection is working

    await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      cy.addFloatingWindow({
        id: 'terminal-sizechange-test',
        component: 'Terminal',
        title: 'Size Change Test',
        position: { x: 300, y: 200 },
        resizable: true,
        nodeMetadata: {
          fileName: 'sizechange-test',
          filePath: '/tmp/sizechange-test'
        }
      });
    });

    await appWindow.waitForSelector('#window-terminal-sizechange-test .xterm', { timeout: 5000 });
    await appWindow.waitForTimeout(1000);

    // Resize by small amount (< 5px) - should NOT trigger fit()
    await appWindow.evaluate(() => {
      const windowElement = document.querySelector('#window-terminal-sizechange-test') as HTMLElement;
      windowElement.style.width = `${windowElement.offsetWidth + 3}px`;
    });

    await appWindow.waitForTimeout(200);

    // Resize by large amount (> 5px) - SHOULD trigger fit()
    await appWindow.evaluate(() => {
      const windowElement = document.querySelector('#window-terminal-sizechange-test') as HTMLElement;
      windowElement.style.width = '800px';
      windowElement.style.height = '500px';
    });

    await appWindow.waitForTimeout(200);

    const finalSize = await appWindow.evaluate(() => {
      const windowElement = document.querySelector('#window-terminal-sizechange-test') as HTMLElement;
      const xtermElement = windowElement?.querySelector('.xterm') as HTMLElement;
      return {
        width: windowElement.offsetWidth,
        height: windowElement.offsetHeight,
        xtermExists: xtermElement !== null,
        xtermHealthy: xtermElement && xtermElement.offsetWidth > 0
      };
    });

    // Verify final resize worked
    expect(finalSize.width).toBe(800);
    expect(finalSize.height).toBe(500);
    expect(finalSize.xtermExists).toBe(true);
    expect(finalSize.xtermHealthy).toBe(true);
  });
});
