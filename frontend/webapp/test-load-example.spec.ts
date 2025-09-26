import { test, expect } from '@playwright/test';
import path from 'path';

test('Load example data and interact with graph', async ({ page }) => {
  // Navigate to the app
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  console.log('=== Step 1: Initial UI loaded ===');

  // With showBoth=true, we should see the File Watching Panel
  const fileWatchingPanel = page.locator('text=Live File Watching');
  await expect(fileWatchingPanel).toBeVisible();
  console.log('✓ File Watching Panel is visible');

  // Click Open Folder button
  const openFolderBtn = page.locator('button:has-text("Open Folder")');
  if (await openFolderBtn.isVisible()) {
    console.log('=== Step 2: Open Folder button found ===');

    // Set up file chooser before clicking
    const fileChooserPromise = page.waitForEvent('filechooser');
    await openFolderBtn.click();

    const fileChooser = await fileChooserPromise;
    const examplePath = path.join(process.cwd(), 'tests/example_small');
    await fileChooser.setFiles([examplePath]);

    console.log('✓ Selected example_small directory');
  } else {
    console.log('Open Folder button not visible - simulating file load');

    // Alternative: Programmatically trigger file loading
    await page.evaluate(async () => {
      // Import and load example data
      const { ExampleLoader } = await import('/src/graph-core/data/load_markdown/ExampleLoader.ts');
      const graphData = await ExampleLoader.loadExampleSmall();

      // Update the app state with the loaded data
      // This simulates what would happen when files are loaded
      console.log(`Loaded ${graphData.nodes.length} nodes and ${graphData.edges.length} edges`);

      // Trigger a custom event that the app can listen to
      window.dispatchEvent(new CustomEvent('exampleDataLoaded', { detail: graphData }));

      return graphData;
    });
  }

  // Wait for graph to appear
  await page.waitForTimeout(2000);

  // Check if Cytoscape instance exists and has nodes
  const graphInfo = await page.evaluate(() => {
    const cy = (window as typeof window & { cytoscapeInstance?: unknown }).cytoscapeInstance;
    if (cy) {
      return {
        exists: true,
        nodeCount: cy.nodes().length,
        edgeCount: cy.edges().length
      };
    }
    return { exists: false, nodeCount: 0, edgeCount: 0 };
  });

  console.log('=== Step 3: Graph State ===');
  console.log(`Cytoscape exists: ${graphInfo.exists}`);
  console.log(`Nodes: ${graphInfo.nodeCount}`);
  console.log(`Edges: ${graphInfo.edgeCount}`);

  if (graphInfo.nodeCount > 0) {
    console.log('✓ Graph successfully loaded with example data!');

    // Try clicking on a node to open floating editor
    const firstNodeId = await page.evaluate(() => {
      const cy = (window as typeof window & { cytoscapeInstance?: unknown }).cytoscapeInstance;
      if (cy && cy.nodes().length > 0) {
        const firstNode = cy.nodes()[0];
        // Simulate click on the node
        firstNode.trigger('tap');
        return firstNode.id();
      }
      return null;
    });

    if (firstNodeId) {
      console.log(`=== Step 4: Clicked on node "${firstNodeId}" ===`);

      // Check if floating window opened
      await page.waitForTimeout(1000);
      const floatingWindow = page.locator('.floating-window');
      if (await floatingWindow.isVisible()) {
        console.log('✓ Floating markdown editor opened!');
      }
    }
  }

  // Take a screenshot of the final state
  await page.screenshot({ path: 'example-data-loaded.png', fullPage: true });
  console.log('✓ Screenshot saved as example-data-loaded.png');
});