// E2E test for floating window refactor - verifies synchronous chrome creation
// This test proves the race condition is fixed by checking DOM elements immediately

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

    // ✅ Test 2: Wait for React content to render (async)
    await appWindow.waitForSelector('.cy-floating-window-content .w-md-editor', { timeout: 5000 });

    const reactContentRendered = await appWindow.evaluate(() => {
      const contentContainer = document.querySelector('.cy-floating-window-content');
      const mdEditor = contentContainer?.querySelector('.w-md-editor');
      return !!mdEditor;
    });

    expect(reactContentRendered).toBe(true);

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

    // Get title bar bounding box
    const box = await titleBar.boundingBox();
    if (!box) throw new Error('Title bar not found');

    // Simulate drag: mousedown -> mousemove -> mouseup
    await appWindow.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await appWindow.mouse.down();
    await appWindow.mouse.move(box.x + 150, box.y + 100);
    await appWindow.mouse.up();

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
      await appWindow.waitForSelector(`#window-multi-window-${i} .w-md-editor`, { timeout: 5000 });
    }

    // ✅ Screenshot with multiple windows
    await appWindow.screenshot({
      path: 'tests/screenshots/electron-floating-window-refactor-multiple.png'
    });
  });
});
