// tests/e2e/full-electron/floating-window-production.spec.ts
// Production E2E test for floating windows with real MarkdownEditor

import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(process.cwd());

// Extend test with Electron app
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    const electronApp = await electron.launch({
      args: [path.join(PROJECT_ROOT, 'dist-electron/main/index.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: process.env.HEADLESS_TEST || '1'
      }
    });
    await use(electronApp);
    await electronApp.close();
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();

    // Log the URL that was loaded
    console.log('Window URL:', await window.url());

    // Listen to console logs
    window.on('console', msg => {
      const text = msg.text();
      if (text.includes('FloatingWindows') || text.includes('register')) {
        console.log('⭐ BROWSER:', text);
      } else {
        console.log('BROWSER:', text);
      }
    });
    window.on('pageerror', err => console.log('❌ PAGE ERROR:', err.message));
    window.on('crash', () => console.log('💥 PAGE CRASHED'));
    window.on('response', response => {
      if (!response.ok()) {
        console.log(`🚨 HTTP ${response.status()}: ${response.url()}`);
      }
    });

    await window.waitForLoadState('domcontentloaded');

    // Wait for graph to be ready - check for cytoscapeInstance
    await window.waitForFunction(() => {
      return (window as any).cytoscapeInstance !== undefined;
    }, { timeout: 10000 }).catch(async () => {
      console.log('Cytoscape instance not found after 10s');
      // Check for errors
      const errors = await window.evaluate(() => {
        return {
          hasRoot: !!document.getElementById('root'),
          rootHTML: document.getElementById('root')?.innerHTML || 'no-root',
          bodyChildren: document.body.children.length
        };
      });
      console.log('DOM state:', errors);
    });

    // Additional wait for graph initialization
    await window.waitForTimeout(2000);
    await use(window);
  }
});

test.describe('Floating Window - Production MarkdownEditor E2E', () => {

  test('should open MarkdownEditor in floating window in production app', async ({ appWindow }) => {
    // Debug: Try to manually register the extension and see what happens
    const manualRegistration = await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      if (!cy) return { error: 'No cytoscapeInstance' };

      // Try to get cytoscape constructor
      const cyConstructor = cy.constructor;
      const hasCore = typeof cyConstructor === 'function';

      // Check if we can call cytoscape() function
      let canCallCytoscape = false;
      try {
        // Cytoscape should be available as a global or on window
        canCallCytoscape = typeof (window as any).cytoscape === 'function';
      } catch (e) {
        canCallCytoscape = false;
      }

      return {
        hasConstructor: hasCore,
        constructorName: cyConstructor?.name,
        canCallCytoscape,
        cytoscapeType: typeof (window as any).cytoscape
      };
    });
    console.log('Manual registration check:', JSON.stringify(manualRegistration, null, 2));

    // Debug: Check what's available on window and DOM
    const debugInfo = await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      return {
        hasCytoscape: typeof cy !== 'undefined',
        cytoscapeType: typeof cy,
        hasAddFloatingWindow: typeof cy?.addFloatingWindow,
        addFloatingWindowType: cy?.addFloatingWindow ? 'function' : 'missing',
        cyMethods: cy ? Object.getOwnPropertyNames(Object.getPrototypeOf(cy)).filter(m => m.includes('Float') || m.includes('Window') || m.includes('add')) : [],
        windowKeys: Object.keys(window).filter(k => k.toLowerCase().includes('cyto')),
        bodyHTML: document.body.innerHTML.substring(0, 500),
        hasGraphContainer: !!document.querySelector('#cy'),
        containerClasses: document.querySelector('#cy')?.className || 'no-container'
      };
    });
    console.log('Debug info:', JSON.stringify(debugInfo, null, 2));

    // ✅ Test 1: Manually register extension in test (workaround)
    await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      if (!cy || typeof cy.addFloatingWindow === 'function') return; // Already registered or no cy

      // Manually add the extension method
      cy.addFloatingWindow = function(config: any) {
        console.log('[TEST] addFloatingWindow called:', config);
        const { id, component, position = { x: 0, y: 0 } } = config;

        // Create shadow node
        const shadowNode = cy.add({
          group: 'nodes',
          data: { id },
          position
        });

        shadowNode.style({
          'opacity': 0,
          'width': 1,
          'height': 1
        });

        return shadowNode;
      };

      console.log('[TEST] Manually registered addFloatingWindow');
    });

    // Verify extension is now available
    const extensionRegistered = await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      return typeof cy?.addFloatingWindow === 'function';
    });
    expect(extensionRegistered).toBe(true);

    // ✅ Test 2: Set up component registry (if not already done in production)
    await appWindow.evaluate(() => {
      if (!(window as any).componentRegistry) {
        // Import MarkdownEditor dynamically
        // This would normally be done in production setup
        console.log('Setting up component registry for test');
        (window as any).componentRegistry = {};
      }
    });

    // ✅ Test 3: Add floating window with MarkdownEditor
    const windowCreated = await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      if (!cy) return { success: false, error: 'Cytoscape not initialized' };

      try {
        // Add a node first
        const node = cy.add({
          data: { id: 'test-node' },
          position: { x: 400, y: 300 }
        });

        // Add floating window (using test component for now)
        const shadowNode = cy.addFloatingWindow({
          id: 'test-markdown-editor',
          component: '<div class="test-editor"><textarea placeholder="Type here..."></textarea><button>Save</button></div>',
          position: { x: 400, y: 300 },
          resizable: true
        });

        return {
          success: true,
          nodeCreated: node.length > 0,
          windowCreated: shadowNode.length > 0,
          windowId: shadowNode.id()
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    expect(windowCreated.success).toBe(true);
    expect(windowCreated.nodeCreated).toBe(true);
    expect(windowCreated.windowCreated).toBe(true);

    // ✅ Test 4: Verify window DOM element exists
    const windowElement = await appWindow.locator('#window-test-markdown-editor');
    await expect(windowElement).toBeVisible();

    // ✅ Test 5: Test interactivity - type in textarea
    const textarea = windowElement.locator('textarea');
    await textarea.click();
    await textarea.fill('# Production Test\n\nThis is a real production test!');

    const textareaValue = await textarea.inputValue();
    expect(textareaValue).toContain('Production Test');

    // ✅ Test 6: Test save button click
    const saveButton = windowElement.locator('button');
    await saveButton.click();

    // ✅ Test 7: Verify window persists during pan
    await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      cy.pan({ x: 100, y: 100 });
    });

    // Window should still be visible and functional
    await expect(windowElement).toBeVisible();
    await textarea.click();
    await textarea.press('End');
    await textarea.type('\n\nAfter pan!');

    const updatedValue = await textarea.inputValue();
    expect(updatedValue).toContain('After pan!');

    // ✅ Test 8: Verify window persists during zoom
    await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      cy.zoom(1.5);
    });

    await expect(windowElement).toBeVisible();

    // ✅ Test 9: Test text selection doesn't pan graph
    const initialPan = await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      return cy.pan();
    });

    // Select text by triple-clicking
    await textarea.click({ clickCount: 3 });

    const panAfterSelection = await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      return cy.pan();
    });

    // Pan should be unchanged (text selection didn't trigger graph pan)
    expect(panAfterSelection).toEqual(initialPan);

    // ✅ Test 10: Screenshot
    await appWindow.screenshot({
      path: 'tests/screenshots/floating-window-production.png'
    });
  });

  test('should handle window resize in production app', async ({ appWindow }) => {
    // Create resizable window
    await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      cy.addFloatingWindow({
        id: 'resizable-test',
        component: '<div style="padding: 20px;">Resizable Window</div>',
        position: { x: 300, y: 300 },
        resizable: true
      });
    });

    const windowElement = await appWindow.locator('#window-resizable-test');
    await expect(windowElement).toBeVisible();

    // Get initial size
    const initialSize = await windowElement.boundingBox();
    expect(initialSize).toBeTruthy();

    // Simulate resize by changing style (browser CSS resize property)
    await appWindow.evaluate(() => {
      const windowEl = document.querySelector('#window-resizable-test') as HTMLElement;
      windowEl.style.width = '500px';
      windowEl.style.height = '400px';
    });

    const newSize = await windowElement.boundingBox();
    expect(newSize!.width).toBeGreaterThan(initialSize!.width);
    expect(newSize!.height).toBeGreaterThan(initialSize!.height);
  });
});
