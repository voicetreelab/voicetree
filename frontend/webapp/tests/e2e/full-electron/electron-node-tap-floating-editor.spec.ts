// tests/e2e/full-electron/electron-node-tap-floating-editor.spec.ts
// E2E test for the PRIMARY REQUIREMENT: Node tap opens MarkdownEditor as floating window

import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

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

    // Log console for debugging
    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    await window.waitForLoadState('domcontentloaded');

    // Wait for Cytoscape and graph to initialize
    await window.waitForFunction(() => (window as any).cytoscapeInstance, { timeout: 10000 });
    await window.waitForTimeout(1000);

    await use(window);
  }
});

test.describe('Node Tap -> Floating MarkdownEditor Integration', () => {

  test('should open MarkdownEditor floating window when tapping on a node', async ({ appWindow }) => {
    // ✅ Test 1: Verify graph has nodes (the app should load with markdown files)
    const nodeInfo = await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      const nodes = cy.nodes();
      return {
        nodeCount: nodes.length,
        firstNodeId: nodes.length > 0 ? nodes[0].id() : null
      };
    });

    console.log('Initial graph state:', nodeInfo);

    // If no nodes exist, we need to ensure there's at least one markdown file
    if (nodeInfo.nodeCount === 0) {
      console.log('No nodes found, waiting for graph to load...');
      await appWindow.waitForTimeout(2000);

      // Re-check after wait
      const updatedNodeInfo = await appWindow.evaluate(() => {
        const cy = (window as any).cytoscapeInstance;
        const nodes = cy.nodes();
        return {
          nodeCount: nodes.length,
          firstNodeId: nodes.length > 0 ? nodes[0].id() : null
        };
      });

      expect(updatedNodeInfo.nodeCount).toBeGreaterThan(0);
    }

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

    // ✅ Test 3: Verify MarkdownEditor window opens
    // The window should have an ID based on the node ID or similar pattern
    await appWindow.waitForTimeout(500); // Allow time for window to open

    const editorWindowExists = await appWindow.evaluate(() => {
      // Check for floating window elements
      const floatingWindows = document.querySelectorAll('[class*="floating-window"], [id*="window-"], .cy-floating-window');

      // Check if any window contains markdown editor elements
      let hasEditor = false;
      floatingWindows.forEach(window => {
        // Look for editor-specific elements: textarea, MDEditor component, save button
        if (window.querySelector('textarea') ||
            window.querySelector('[class*="markdown"]') ||
            window.querySelector('[class*="MDEditor"]') ||
            window.querySelector('button')) {
          hasEditor = true;
        }
      });

      return {
        windowCount: floatingWindows.length,
        hasEditor: hasEditor,
        windowIds: Array.from(floatingWindows).map(w => w.id || w.className)
      };
    });

    console.log('Editor window state:', editorWindowExists);
    expect(editorWindowExists.windowCount).toBeGreaterThan(0);
    expect(editorWindowExists.hasEditor).toBe(true);

    // ✅ Test 4: Verify user can type in the editor
    const textareaSelector = '[class*="floating-window"] textarea, [id*="window-"] textarea, .cy-floating-window textarea';
    const textarea = await appWindow.locator(textareaSelector).first();

    // Type in the editor
    await textarea.click();
    await textarea.fill('# Testing Floating Window\n\nThis text was typed in the floating editor.');

    const editorContent = await textarea.inputValue();
    expect(editorContent).toContain('Testing Floating Window');

    // ✅ Test 5: Verify save button exists and is clickable
    const saveButtonSelector = '[class*="floating-window"] button, [id*="window-"] button, .cy-floating-window button';
    const saveButton = await appWindow.locator(saveButtonSelector).filter({ hasText: /Save/i }).first();

    const saveButtonVisible = await saveButton.isVisible().catch(() => false);
    expect(saveButtonVisible).toBe(true);

    // Click save button
    await saveButton.click();

    // After save, button text might change to "Saved!" or similar
    await appWindow.waitForTimeout(500);
    const buttonTextAfterSave = await saveButton.textContent();
    console.log('Save button text after click:', buttonTextAfterSave);

    // ✅ Test 6: Verify window moves with graph pan
    const initialPosition = await appWindow.evaluate(() => {
      const floatingWindow = document.querySelector('[class*="floating-window"], [id*="window-"], .cy-floating-window') as HTMLElement;
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
      const floatingWindow = document.querySelector('[class*="floating-window"], [id*="window-"], .cy-floating-window') as HTMLElement;
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

  test('should not interfere with graph interactions when interacting with editor', async ({ appWindow }) => {
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

  test('should handle multiple floating windows from different nodes', async ({ appWindow }) => {
    // Get multiple nodes
    const nodesInfo = await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      const nodes = cy.nodes();
      return {
        count: nodes.length,
        nodeIds: nodes.slice(0, 3).map((n: any) => n.id()) // Get up to 3 node IDs
      };
    });

    if (nodesInfo.count >= 2) {
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
    }
  });
});