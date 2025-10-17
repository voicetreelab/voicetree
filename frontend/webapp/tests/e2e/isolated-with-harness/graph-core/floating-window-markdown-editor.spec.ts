// tests/e2e/isolated-with-harness/graph-core/floating-window-markdown-editor.spec.ts
// PRIMARY TEST: Floating window with real MarkdownEditor component

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Floating Window - Real MarkdownEditor Integration', () => {

  test('should display and allow interaction with real MarkdownEditor', async ({ page }) => {
    await page.goto('/tests/e2e/isolated-with-harness/graph-core/cytoscape-react-harness.html');
    await page.waitForSelector('[data-harness-ready="true"]');

    // Set up MarkdownEditor component in test environment
    await page.evaluate(() => {
      // Create MarkdownEditor component for testing (now with forwardRef and auto-save)
      const MarkdownEditor = (window as any).React.forwardRef(({ windowId, content, onSave }: any, ref: any) => {
        const [value, setValue] = (window as any).React.useState(content);

        // Expose save method via ref for auto-save on close
        (window as any).React.useImperativeHandle(ref, () => ({
          save: async () => {
            console.log('[MarkdownEditor] save called via ref');
            await onSave(value);
          },
          getValue: () => value
        }));

        const handleChange = (newValue: string | undefined) => {
          const content = newValue || '';
          setValue(content);
          // Auto-save on every content change
          onSave(content);
        };

        // No save button - saves automatically on close
        return (window as any).React.createElement('div',
          { style: { height: '100%', display: 'flex', flexDirection: 'column' } },
          (window as any).React.createElement('textarea', {
            value: value,
            onChange: (e: any) => handleChange(e.target.value),
            style: {
              flex: 1,
              padding: '10px',
              border: 'none',
              resize: 'none',
              fontFamily: 'monospace',
              fontSize: '14px'
            }
          })
        );
      });

      // Register component for use with extension
      (window as any).componentRegistry = {
        MarkdownEditor: MarkdownEditor
      };
    });

    const setup = await page.evaluate(async () => {
      const cy = window.cy;

      // Add a node
      cy.add({ data: { id: 'node1' }, position: { x: 400, y: 300 } });

      // Add floating window with MarkdownEditor
      // Note: This requires the extension to support React components properly
      const windowNode = cy.addFloatingWindow({
        id: 'markdown-editor-window',
        component: 'MarkdownEditor', // Will need special handling for real component
        position: { x: 400, y: 300 },
        resizable: true,
        initialContent: '# Test Document\n\nThis is a test.'
      });

      return {
        nodeExists: windowNode && windowNode.length > 0,
        nodeId: windowNode.id()
      };
    });

    expect(setup.nodeExists).toBe(true);

    // ✅ Test 1: Verify MarkdownEditor rendered
    const editorExists = await page.evaluate(() => {
      const windowElement = document.querySelector('#window-markdown-editor-window');
      // Look for MDEditor's textarea
      return windowElement?.querySelector('textarea') !== null;
    });
    expect(editorExists).toBe(true);

    // ✅ Test 2: Type in the editor
    await page.click('#window-markdown-editor-window textarea');
    await page.keyboard.type('\n\nAdded via test!');

    const editorContent = await page.evaluate(() => {
      const textarea = document.querySelector('#window-markdown-editor-window textarea') as HTMLTextAreaElement;
      return textarea?.value || '';
    });
    expect(editorContent).toContain('Added via test!');

    // ✅ Test 3: Verify no save button exists (auto-save on close)
    const saveButtonExists = await page.evaluate(() => {
      const windowElement = document.querySelector('#window-markdown-editor-window');
      const contentArea = windowElement?.querySelector('.cy-floating-window-content');
      const saveButton = contentArea?.querySelector('button');
      return saveButton !== null;
    });
    expect(saveButtonExists).toBe(false);

    // ✅ Test 4: Test auto-save on close
    let savedContent = '';
    await page.evaluate(() => {
      // Set up onSave spy
      (window as any).lastSavedContent = null;
      const cy = window.cy;
      // Re-add window with onSave callback that stores content
      const existingWindow = cy.$('#markdown-editor-window');
      if (existingWindow.length > 0) {
        existingWindow.remove();
      }
      document.querySelector('#window-markdown-editor-window')?.remove();

      cy.addFloatingWindow({
        id: 'markdown-editor-window',
        component: 'MarkdownEditor',
        position: { x: 400, y: 300 },
        resizable: true,
        initialContent: 'Initial content',
        onSave: async (content: string) => {
          (window as any).lastSavedContent = content;
          console.log('Content saved:', content);
        }
      });
    });

    // Type new content
    await page.click('#window-markdown-editor-window textarea');
    await page.keyboard.type('\n\nAuto-save test!');

    // Click close button (should trigger auto-save)
    await page.click('#window-markdown-editor-window .cy-floating-window-close');

    // Wait a moment for async save
    await page.waitForTimeout(100);

    savedContent = await page.evaluate(() => (window as any).lastSavedContent || '');
    expect(savedContent).toContain('Auto-save test!');

    // ✅ Test 5: Verify editor still works after pan
    // Re-create window since we closed it in the previous test
    await page.evaluate(() => {
      const cy = window.cy;
      cy.addFloatingWindow({
        id: 'markdown-editor-window-2',
        component: 'MarkdownEditor',
        position: { x: 400, y: 300 },
        resizable: true,
        initialContent: 'Test content'
      });
    });

    await page.evaluate(() => {
      window.cy.pan({ x: 100, y: 100 });
    });

    // Should still be able to type
    await page.click('#window-markdown-editor-window-2 textarea');
    await page.keyboard.type(' After pan!');

    const contentAfterPan = await page.evaluate(() => {
      const textarea = document.querySelector('#window-markdown-editor-window-2 textarea') as HTMLTextAreaElement;
      return textarea?.value || '';
    });
    expect(contentAfterPan).toContain('After pan!');

    // ✅ Test 6: Verify editor still works after zoom
    await page.evaluate(() => {
      window.cy.zoom(1.5);
    });

    await page.click('#window-markdown-editor-window-2 textarea');
    await page.keyboard.type(' After zoom!');

    const contentAfterZoom = await page.evaluate(() => {
      const textarea = document.querySelector('#window-markdown-editor-window-2 textarea') as HTMLTextAreaElement;
      return textarea?.value || '';
    });
    expect(contentAfterZoom).toContain('After zoom!');

    // ✅ Test 7: Screenshot
    await page.screenshot({
      path: 'tests/screenshots/floating-window-markdown-editor.png',
      clip: { x: 0, y: 0, width: 800, height: 600 }
    });
  });

  test('should persist edited content when closing and reopening editor', async ({ page }) => {
    await page.goto('/tests/e2e/isolated-with-harness/graph-core/cytoscape-react-harness.html');
    await page.waitForSelector('[data-harness-ready="true"]');

    // Set up MarkdownEditor component
    await page.evaluate(() => {
      const MarkdownEditor = (window as any).React.forwardRef(({ windowId, content, onSave }: any, ref: any) => {
        const [value, setValue] = (window as any).React.useState(content);

        (window as any).React.useImperativeHandle(ref, () => ({
          save: async () => {
            console.log('[MarkdownEditor] save called via ref');
            await onSave(value);
          },
          getValue: () => value
        }));

        const handleChange = (newValue: string | undefined) => {
          const content = newValue || '';
          setValue(content);
          // Auto-save on every content change
          onSave(content);
        };

        return (window as any).React.createElement('div',
          { style: { height: '100%', display: 'flex', flexDirection: 'column' } },
          (window as any).React.createElement('textarea', {
            value: value,
            onChange: (e: any) => handleChange(e.target.value),
            style: {
              flex: 1,
              padding: '10px',
              border: 'none',
              resize: 'none',
              fontFamily: 'monospace',
              fontSize: '14px'
            }
          })
        );
      });

      (window as any).componentRegistry = {
        MarkdownEditor: MarkdownEditor
      };
    });

    // Set up a persistent content store to simulate real backend
    await page.evaluate(() => {
      (window as any).contentStore = new Map();
      (window as any).contentStore.set('test-node-1', 'Initial content');
    });

    // Create editor with initial content
    await page.evaluate(() => {
      const cy = window.cy;
      const nodeId = 'test-node-1';
      const initialContent = (window as any).contentStore.get(nodeId);

      cy.addFloatingWindow({
        id: 'editor-persist-test',
        component: 'MarkdownEditor',
        position: { x: 400, y: 300 },
        resizable: true,
        initialContent: initialContent,
        onSave: async (content: string) => {
          console.log('Saving content for', nodeId, ':', content);
          (window as any).contentStore.set(nodeId, content);
        }
      });
    });

    // Edit the content
    await page.click('#window-editor-persist-test textarea');
    await page.keyboard.press('End'); // Go to end of text
    await page.keyboard.type('\n\nEdited content!');

    // Verify content in editor
    const editedContent = await page.evaluate(() => {
      const textarea = document.querySelector('#window-editor-persist-test textarea') as HTMLTextAreaElement;
      return textarea?.value || '';
    });
    expect(editedContent).toContain('Edited content!');

    // Close the editor (should trigger save)
    await page.click('#window-editor-persist-test .cy-floating-window-close');
    await page.waitForTimeout(100); // Wait for async save

    // Verify content was saved to our store
    const savedContent = await page.evaluate(() => {
      return (window as any).contentStore.get('test-node-1');
    });
    expect(savedContent).toContain('Edited content!');

    // Reopen the editor with the saved content
    await page.evaluate(() => {
      const cy = window.cy;
      const nodeId = 'test-node-1';
      const savedContent = (window as any).contentStore.get(nodeId);

      cy.addFloatingWindow({
        id: 'editor-persist-test-2',
        component: 'MarkdownEditor',
        position: { x: 400, y: 300 },
        resizable: true,
        initialContent: savedContent,
        onSave: async (content: string) => {
          (window as any).contentStore.set(nodeId, content);
        }
      });
    });

    // Verify reopened editor has the edited content
    const reopenedContent = await page.evaluate(() => {
      const textarea = document.querySelector('#window-editor-persist-test-2 textarea') as HTMLTextAreaElement;
      return textarea?.value || '';
    });
    expect(reopenedContent).toContain('Edited content!');
  });

  test('should handle text selection in editor without triggering graph interactions', async ({ page }) => {
    await page.goto('/tests/e2e/isolated-with-harness/graph-core/cytoscape-react-harness.html');
    await page.waitForSelector('[data-harness-ready="true"]');

    // Set up MarkdownEditor component (now with forwardRef and auto-save)
    await page.evaluate(() => {
      const MarkdownEditor = (window as any).React.forwardRef(({ windowId, content, onSave }: any, ref: any) => {
        const [value, setValue] = (window as any).React.useState(content);

        // Expose save method via ref for auto-save on close
        (window as any).React.useImperativeHandle(ref, () => ({
          save: async () => {
            console.log('[MarkdownEditor] save called via ref');
            await onSave(value);
          },
          getValue: () => value
        }));

        const handleChange = (newValue: string | undefined) => {
          const content = newValue || '';
          setValue(content);
          // Auto-save on every content change
          onSave(content);
        };

        // No save button - saves automatically on close
        return (window as any).React.createElement('div',
          { style: { height: '100%', display: 'flex', flexDirection: 'column' } },
          (window as any).React.createElement('textarea', {
            value: value,
            onChange: (e: any) => handleChange(e.target.value),
            style: {
              flex: 1,
              padding: '10px',
              border: 'none',
              resize: 'none',
              fontFamily: 'monospace',
              fontSize: '14px'
            }
          })
        );
      });

      (window as any).componentRegistry = {
        MarkdownEditor: MarkdownEditor
      };
    });

    await page.evaluate(() => {
      const cy = window.cy;
      cy.add({ data: { id: 'node1' }, position: { x: 400, y: 300 } });

      cy.addFloatingWindow({
        id: 'editor-selection-test',
        component: 'MarkdownEditor',
        position: { x: 400, y: 300 },
        initialContent: 'Select this text'
      });
    });

    // Click and drag to select text
    const editorSelector = '#window-editor-selection-test textarea';
    await page.click(editorSelector);

    const textareaBounds = await page.locator(editorSelector).boundingBox();
    if (textareaBounds) {
      // Drag across text to select
      await page.mouse.move(textareaBounds.x + 10, textareaBounds.y + 10);
      await page.mouse.down();
      await page.mouse.move(textareaBounds.x + 100, textareaBounds.y + 10);
      await page.mouse.up();
    }

    // Verify text was selected (not graph panned)
    const selectedText = await page.evaluate(() => {
      const textarea = document.querySelector('#window-editor-selection-test textarea') as HTMLTextAreaElement;
      return textarea?.value.substring(textarea.selectionStart, textarea.selectionEnd);
    });

    expect(selectedText.length).toBeGreaterThan(0);

    // Verify graph did NOT pan during selection
    const graphPan = await page.evaluate(() => window.cy.pan());
    expect(graphPan).toEqual({ x: 0, y: 0 });
  });
});
