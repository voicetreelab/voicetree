import { test, expect } from '@playwright/test';

interface GraphNode {
  data: {
    id: string;
    label: string;
  };
}

interface GraphManager {
  graphData?: {
    nodes: GraphNode[];
  };
}

interface TestWindow extends Window {
  testGraphManager?: GraphManager;
  _test_logs?: string[];
  _test_savedPayload?: { filePath: string; content: string };
}

test.describe('Editor ↔ File ↔ Graph Integration', () => {

  test.describe('Editor Save → Graph Update', () => {
    test('should update graph node labels when editor saves content with new title', async ({ page }) => {
      // Navigate to the test page in file-watcher mode which includes graph functionality
      await page.goto('/tests/e2e/isolated-with-harness/harness.html?mode=file-watcher');

      // Wait for initialization
      await page.waitForTimeout(1000);

      // Verify page loaded
      await expect(page.locator('h1:has-text("File Watcher Editor Test")')).toBeVisible();

      // Open an editor for a node
      await page.locator('button:has-text("Open Editor for Test Node")').click();

      // Verify floating window appears with initial content
      const window = page.locator('.floating-window');
      await expect(window).toBeVisible();
      await expect(window.locator('.window-title-bar')).toContainText('test.md');
      await expect(window.locator('.w-md-editor-text-input')).toHaveValue('# Old Content');

      // Change the content to have a new title
      const editorInput = window.locator('.w-md-editor-text-input');
      await editorInput.fill('---\ntitle: New Title\n---\n\n# New Title\n\nThis is the updated content.');

      // Save the content
      const saveButton = window.locator('button:has-text("Save")');
      await saveButton.click();

      // Wait for the save to complete
      await expect(window.locator('button:has-text("Saved!")')).toBeVisible({ timeout: 3000 });

      // Verify that the mock save was called
      await expect.poll(async () => {
        return page.evaluate((): { filePath: string; content: string } | undefined => {
          return (window as TestWindow)._test_savedPayload;
        });
      }, { message: 'Waiting for save payload to be set on window' }).toMatchObject({
        filePath: 'test/test.md',
        content: '---\ntitle: New Title\n---\n\n# New Title\n\nThis is the updated content.'
      });

      // Simulate the file watcher detecting the change (this would normally happen automatically)
      await page.evaluate(() => {
        const event = new CustomEvent('simulateFileChange', {
          detail: {
            path: 'test/test.md',
            content: '---\ntitle: New Title\n---\n\n# New Title\n\nThis is the updated content.'
          }
        });
        window.dispatchEvent(event);
      });

      // Wait for the graph update to propagate
      await page.waitForTimeout(300);

      // Verify that the graph has been updated with the new node label
      const graphNodeLabel = await page.evaluate(() => {
        const graphManager = (window as TestWindow).testGraphManager;
        if (graphManager && graphManager.graphData && graphManager.graphData.nodes) {
          const testNode = graphManager.graphData.nodes.find((node) => node.data.id.includes('test'));
          return testNode ? testNode.data.label : null;
        }
        return null;
      });

      // The node label should now be "New Title" instead of the original filename
      expect(graphNodeLabel).toBe('New Title');

      // Verify the logs show the expected flow
      const logs = await page.evaluate(() => {
        return (window as TestWindow)._test_logs || [];
      });

      // Check that file parsing occurred
      expect(logs.some((log: string) =>
        log.includes('File changed:') && log.includes('test/test.md')
      )).toBe(true);

      // Check that graph transformation occurred
      expect(logs.some((log: string) =>
        log.includes('Transforming parsed nodes to graph data')
      )).toBe(true);
    });

    test('should handle saves without frontmatter titles correctly', async ({ page }) => {
      await page.goto('/tests/e2e/isolated-with-harness/harness.html?mode=file-watcher');
      await page.waitForTimeout(1000);

      // Open an editor for a node
      await page.locator('button:has-text("Open Editor for Test Node")').click();

      const window = page.locator('.floating-window');
      await expect(window).toBeVisible();

      // Change the content to markdown without frontmatter
      const editorInput = window.locator('.w-md-editor-text-input');
      await editorInput.fill('# Just a Markdown Title\n\nContent without frontmatter.');

      // Save the content
      const saveButton = window.locator('button:has-text("Save")');
      await saveButton.click();
      await expect(window.locator('button:has-text("Saved!")')).toBeVisible({ timeout: 3000 });

      // Simulate the file watcher detecting the change
      await page.evaluate(() => {
        const event = new CustomEvent('simulateFileChange', {
          detail: {
            path: 'test/test.md',
            content: '# Just a Markdown Title\n\nContent without frontmatter.'
          }
        });
        window.dispatchEvent(event);
      });

      await page.waitForTimeout(300);

      // Verify that the graph falls back to filename-based labeling
      const graphNodeLabel = await page.evaluate(() => {
        const graphManager = (window as TestWindow).testGraphManager;
        if (graphManager && graphManager.graphData && graphManager.graphData.nodes) {
          const testNode = graphManager.graphData.nodes.find((node) => node.data.id.includes('test'));
          return testNode ? testNode.data.label : null;
        }
        return null;
      });

      // Should fall back to filename without .md extension
      expect(graphNodeLabel).toBe('test/test');
    });
  });

  test.describe('File Change → Editor Update', () => {
    test('should update editor content when external file changes', async ({ page }) => {
      await page.goto('/tests/e2e/isolated-with-harness/harness.html?mode=file-watcher');
      await page.waitForTimeout(1000);

      // Verify page loaded
      await expect(page.locator('h1:has-text("File Watcher Editor Test")')).toBeVisible();

      // Open an editor for a node
      await page.locator('button:has-text("Open Editor for Test Node")').click();

      // Verify floating window appears with initial content
      const window = page.locator('.floating-window');
      await expect(window).toBeVisible();
      await expect(window.locator('.window-title-bar')).toContainText('test.md');
      await expect(window.locator('.w-md-editor-text-input')).toHaveValue('# Old Content');

      // Simulate external file change
      await page.evaluate(() => {
        const event = new CustomEvent('simulateFileChange', {
          detail: {
            path: 'test/test.md',
            content: '# New Content from External Change'
          }
        });
        window.dispatchEvent(event);
      });

      // Wait for the update to propagate
      await page.waitForTimeout(100);

      // Verify the editor content has been updated
      await expect(window.locator('.w-md-editor-text-input')).toHaveValue('# New Content from External Change');

      // Verify the update was logged
      const logs = await page.evaluate(() => {
        return (window as TestWindow)._test_logs || [];
      });

      expect(logs.some((log: string) =>
        log.includes('Updating editor content for node') &&
        log.includes('due to external file change')
      )).toBe(true);
    });

    test('should not update editor if no editor is open for changed file', async ({ page }) => {
      await page.goto('/tests/e2e/isolated-with-harness/harness.html?mode=file-watcher');
      await page.waitForTimeout(1000);

      // Simulate external file change without any editor open
      await page.evaluate(() => {
        const event = new CustomEvent('simulateFileChange', {
          detail: {
            path: 'test/other.md',
            content: '# Some new content'
          }
        });
        window.dispatchEvent(event);
      });

      await page.waitForTimeout(100);

      // Verify no editor window appeared
      const window = page.locator('.floating-window');
      await expect(window).not.toBeVisible();

      // Verify the logs show no editor update attempt
      const logs = await page.evaluate(() => {
        return (window as TestWindow)._test_logs || [];
      });

      expect(logs.some((log: string) =>
        log.includes('Updating editor content')
      )).toBe(false);
    });

    test('should handle multiple open editors independently', async ({ page }) => {
      await page.goto('/tests/e2e/isolated-with-harness/harness.html?mode=file-watcher');
      await page.waitForTimeout(1000);

      // Open first editor
      await page.locator('button:has-text("Open Editor for Test Node")').click();

      // Open second editor
      await page.locator('button:has-text("Open Editor for Other Node")').click();

      // Verify both windows are visible
      const windows = page.locator('.floating-window');
      await expect(windows).toHaveCount(2);

      // Simulate file change for first file only
      await page.evaluate(() => {
        const event = new CustomEvent('simulateFileChange', {
          detail: {
            path: 'test/test.md',
            content: '# Updated First File'
          }
        });
        window.dispatchEvent(event);
      });

      await page.waitForTimeout(100);

      // Verify only the first editor was updated
      const firstEditor = windows.nth(0);
      const secondEditor = windows.nth(1);

      await expect(firstEditor.locator('.w-md-editor-text-input')).toHaveValue('# Updated First File');
      await expect(secondEditor.locator('.w-md-editor-text-input')).toHaveValue('# Other Content'); // unchanged
    });
  });

  test.describe('Bidirectional Flow', () => {
    test('should handle round-trip: save → file → graph → editor updates', async ({ page }) => {
      await page.goto('/tests/e2e/isolated-with-harness/harness.html?mode=file-watcher');
      await page.waitForTimeout(1000);

      // Open an editor
      await page.locator('button:has-text("Open Editor for Test Node")').click();

      const window = page.locator('.floating-window');
      await expect(window).toBeVisible();

      // Step 1: Save new content with title
      const editorInput = window.locator('.w-md-editor-text-input');
      await editorInput.fill('---\ntitle: Round Trip Title\n---\n\n# Round Trip Title\n\nTesting bidirectional flow.');

      await window.locator('button:has-text("Save")').click();
      await expect(window.locator('button:has-text("Saved!")')).toBeVisible({ timeout: 3000 });

      // Step 2: Simulate file watcher detection
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('simulateFileChange', {
          detail: {
            path: 'test/test.md',
            content: '---\ntitle: Round Trip Title\n---\n\n# Round Trip Title\n\nTesting bidirectional flow.'
          }
        }));
      });

      await page.waitForTimeout(300);

      // Step 3: Verify graph updated
      const graphNodeLabel = await page.evaluate(() => {
        const graphManager = (window as TestWindow).testGraphManager;
        if (graphManager && graphManager.graphData && graphManager.graphData.nodes) {
          const testNode = graphManager.graphData.nodes.find((node) => node.data.id.includes('test'));
          return testNode ? testNode.data.label : null;
        }
        return null;
      });

      expect(graphNodeLabel).toBe('Round Trip Title');

      // Step 4: Simulate external change to same file
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('simulateFileChange', {
          detail: {
            path: 'test/test.md',
            content: '---\ntitle: External Update\n---\n\n# External Update\n\nChanged from outside.'
          }
        }));
      });

      await page.waitForTimeout(300);

      // Step 5: Verify editor updated
      await expect(window.locator('.w-md-editor-text-input')).toHaveValue(
        '---\ntitle: External Update\n---\n\n# External Update\n\nChanged from outside.'
      );

      // Step 6: Verify graph also updated
      const updatedGraphNodeLabel = await page.evaluate(() => {
        const graphManager = (window as TestWindow).testGraphManager;
        if (graphManager && graphManager.graphData && graphManager.graphData.nodes) {
          const testNode = graphManager.graphData.nodes.find((node) => node.data.id.includes('test'));
          return testNode ? testNode.data.label : null;
        }
        return null;
      });

      expect(updatedGraphNodeLabel).toBe('External Update');
    });

    test('should update multiple graph nodes when files are saved separately', async ({ page }) => {
      await page.goto('/tests/e2e/isolated-with-harness/harness.html?mode=file-watcher');
      await page.waitForTimeout(1000);

      // First, simulate saving the first file
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('simulateFileChange', {
          detail: { path: 'test/test.md', content: '---\ntitle: Updated First Title\n---\n\n# Updated First Title' }
        }));
      });

      await page.waitForTimeout(300);

      // Then simulate saving the second file
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('simulateFileChange', {
          detail: { path: 'test/other.md', content: '---\ntitle: Updated Second Title\n---\n\n# Updated Second Title' }
        }));
      });

      await page.waitForTimeout(300);

      // Verify that both nodes in the graph have been updated
      const graphNodeLabels = await page.evaluate(() => {
        const graphManager = (window as TestWindow).testGraphManager;
        if (graphManager && graphManager.graphData && graphManager.graphData.nodes) {
          return graphManager.graphData.nodes.map((node) => ({
            id: node.data.id,
            label: node.data.label
          }));
        }
        return [];
      });

      // Find the specific nodes we updated
      const testNode = graphNodeLabels.find((node) => node.id.includes('test'));
      const otherNode = graphNodeLabels.find((node) => node.id.includes('other'));

      expect(testNode?.label).toBe('Updated First Title');
      expect(otherNode?.label).toBe('Updated Second Title');
    });
  });
});