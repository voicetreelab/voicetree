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
}

test.describe('Editor Save → Graph Update Integration', () => {

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
        return (window as Window & { _test_savedPayload?: { filePath: string; content: string } })._test_savedPayload;
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
    // This checks that the MarkdownParser extracted the title from frontmatter and updated the graph
    const graphNodeLabel = await page.evaluate(() => {
      // Access the graph data that would be updated by the useGraphManager hook
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
    // Navigate to the test page
    await page.goto('/tests/e2e/isolated-with-harness/harness.html?mode=file-watcher');

    // Wait for initialization
    await page.waitForTimeout(1000);

    // Open an editor for a node
    await page.locator('button:has-text("Open Editor for Test Node")').click();

    // Verify floating window appears
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

    // Wait for the graph update
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

    // Should fall back to filename without .md extension and with underscores replaced
    // Since we're using full file path as ID, label will be derived from full path
    expect(graphNodeLabel).toBe('test/test');
  });

  test('should update multiple graph nodes when files are saved separately', async ({ page }) => {
    // Navigate to the test page
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