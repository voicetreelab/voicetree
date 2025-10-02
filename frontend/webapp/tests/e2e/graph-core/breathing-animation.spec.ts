import { test, expect } from '@playwright/test';

test.describe('Breathing Animation for New and Updated Nodes', () => {
  test('should animate new nodes with green breathing effect', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForSelector('.__________cytoscape_container', { state: 'visible' });
    await page.waitForTimeout(1000);

    // Get initial node count
    const initialNodeCount = await page.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      return cy ? cy.nodes().length : 0;
    });

    // Create a new markdown file by simulating file observer event
    const newFilePath = 'test-new-node.md';
    const newFileContent = '# Test New Node\n\nThis is a new test node.';

    await page.evaluate(({ path, content }) => {
      // Call the exposed test handler directly
      (window as any).testHandlers.handleFileAdded({ path, content });
    }, { path: newFilePath, content: newFileContent });

    // Wait a moment for the animation to start
    await page.waitForTimeout(500);

    // Check that a new node was added
    const newNodeCount = await page.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      return cy ? cy.nodes().length : 0;
    });

    expect(newNodeCount).toBeGreaterThan(initialNodeCount);

    // Check for green breathing animation (NEW_NODE type)
    const nodeStyle = await page.evaluate((filePath) => {
      const cy = (window as any).cytoscapeInstance;
      if (!cy) return null;

      // Normalize the file path to match how the app does it
      const nodeId = filePath.replace(/\.md$/, '').replace(/\//g, '_');
      const node = cy.getElementById(nodeId);

      if (!node || node.length === 0) return null;

      return {
        exists: true,
        borderWidth: node.style('border-width'),
        borderColor: node.style('border-color'),
        borderOpacity: node.style('border-opacity'),
        breathingActive: node.data('breathingActive'),
        animationType: node.data('animationType')
      };
    }, newFilePath);

    console.log('New node style:', nodeStyle);

    // Verify animation is active
    expect(nodeStyle).not.toBeNull();
    expect(nodeStyle?.exists).toBe(true);
    expect(nodeStyle?.breathingActive).toBe(true);
    expect(nodeStyle?.animationType).toBe('new_node');

    // Check for visible border (breathing effect should have started)
    expect(nodeStyle?.borderWidth).not.toBe('0');
    expect(nodeStyle?.borderWidth).not.toBe('0px');

    // Take screenshot during animation
    await page.screenshot({
      path: 'tests/e2e/screenshots/new-node-breathing-animation.png',
      fullPage: false
    });

    // Wait and verify the breathing continues
    await page.waitForTimeout(1500);

    const stillBreathing = await page.evaluate((filePath) => {
      const cy = (window as any).cytoscapeInstance;
      const nodeId = filePath.replace(/\.md$/, '').replace(/\//g, '_');
      const node = cy.getElementById(nodeId);
      return {
        breathingActive: node.data('breathingActive'),
        borderWidth: node.style('border-width')
      };
    }, newFilePath);

    expect(stillBreathing.breathingActive).toBe(true);

    console.log('✓ New node breathing animation test completed');
  });

  test('should animate updated nodes with cyan breathing effect', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForSelector('.__________cytoscape_container', { state: 'visible' });
    await page.waitForTimeout(1000);

    // First, create a node
    const filePath = 'test-update-node.md';
    const initialContent = '# Test Update Node\n\nInitial content.';

    await page.evaluate(({ path, content }) => {
      (window as any).testHandlers.handleFileAdded({ path, content });
    }, { path: filePath, content: initialContent });

    await page.waitForTimeout(1000);

    // Clear any existing animations
    await page.evaluate((fp) => {
      const cy = (window as any).cytoscapeInstance;
      const nodeId = fp.replace(/\.md$/, '').replace(/\//g, '_');
      const node = cy.getElementById(nodeId);
      if (node && node.length > 0) {
        node.data('breathingActive', false);
        node.stop(true);
        node.style({
          'border-width': '0',
          'border-color': 'rgba(0, 0, 0, 0)',
          'border-opacity': 1
        });
      }
    }, filePath);

    await page.waitForTimeout(500);

    // Now update the file content
    const updatedContent = '# Test Update Node\n\nInitial content.\n\n## Appended Content\n\nThis is new content.';

    await page.evaluate(({ path, content }) => {
      (window as any).testHandlers.handleFileChanged({ path, content });
    }, { path: filePath, content: updatedContent });

    await page.waitForTimeout(500);

    // Check for cyan breathing animation (APPENDED_CONTENT type)
    const updatedNodeStyle = await page.evaluate((fp) => {
      const cy = (window as any).cytoscapeInstance;
      const nodeId = fp.replace(/\.md$/, '').replace(/\//g, '_');
      const node = cy.getElementById(nodeId);

      return {
        exists: node && node.length > 0,
        borderWidth: node.style('border-width'),
        borderColor: node.style('border-color'),
        breathingActive: node.data('breathingActive'),
        animationType: node.data('animationType')
      };
    }, filePath);

    console.log('Updated node style:', updatedNodeStyle);

    // Verify appended content animation
    expect(updatedNodeStyle.exists).toBe(true);
    expect(updatedNodeStyle.breathingActive).toBe(true);
    expect(updatedNodeStyle.animationType).toBe('appended_content');
    expect(updatedNodeStyle.borderWidth).not.toBe('0');
    expect(updatedNodeStyle.borderWidth).not.toBe('0px');

    // Take screenshot
    await page.screenshot({
      path: 'tests/e2e/screenshots/updated-node-breathing-animation.png',
      fullPage: false
    });

    console.log('✓ Updated node breathing animation test completed');
  });

  test('should stop new node animation after 5 second timeout', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForSelector('.__________cytoscape_container', { state: 'visible' });
    await page.waitForTimeout(1000);

    // Create a new node
    const filePath = 'test-timeout-node.md';
    const content = '# Timeout Test\n\nThis should stop animating after 5 seconds.';

    await page.evaluate(({ path, content }) => {
      (window as any).testHandlers.handleFileAdded({ path, content });
    }, { path: filePath, content });

    await page.waitForTimeout(500);

    // Verify animation started
    const animationStarted = await page.evaluate((fp) => {
      const cy = (window as any).cytoscapeInstance;
      const nodeId = fp.replace(/\.md$/, '').replace(/\//g, '_');
      const node = cy.getElementById(nodeId);
      return node.data('breathingActive') === true;
    }, filePath);

    expect(animationStarted).toBe(true);

    // Wait for timeout (NEW_NODE has 5 second timeout)
    console.log('Waiting 5.5 seconds for animation timeout...');
    await page.waitForTimeout(5500);

    // Verify animation stopped
    const animationStopped = await page.evaluate((fp) => {
      const cy = (window as any).cytoscapeInstance;
      const nodeId = fp.replace(/\.md$/, '').replace(/\//g, '_');
      const node = cy.getElementById(nodeId);
      return {
        breathingActive: node.data('breathingActive'),
        borderWidth: node.style('border-width')
      };
    }, filePath);

    console.log('After timeout:', animationStopped);

    expect(animationStopped.breathingActive).toBeFalsy();
    expect(animationStopped.borderWidth).toMatch(/^(0px?|0)$/);

    console.log('✓ Animation timeout test completed');
  });

  test('should maintain pinned node animation indefinitely', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForSelector('.__________cytoscape_container', { state: 'visible' });
    await page.waitForTimeout(1000);

    // Create a node
    const filePath = 'test-pinned-node.md';
    const content = '# Pinned Node Test\n\nThis will be pinned.';

    await page.evaluate(({ path, content }) => {
      (window as any).testHandlers.handleFileAdded({ path, content });
    }, { path: filePath, content });

    await page.waitForTimeout(500);

    // Pin the node (this should trigger PINNED animation)
    await page.evaluate((fp) => {
      const cy = (window as any).cytoscapeInstance;
      const nodeId = fp.replace(/\.md$/, '').replace(/\//g, '_');
      const node = cy.getElementById(nodeId);

      // Simulate pin action - would normally come from context menu
      if ((window as any).cytoscapeCore) {
        (window as any).cytoscapeCore.pinNode(node);
      }
    }, filePath);

    await page.waitForTimeout(500);

    // Check for orange breathing animation (PINNED type)
    const pinnedStyle = await page.evaluate((fp) => {
      const cy = (window as any).cytoscapeInstance;
      const nodeId = fp.replace(/\.md$/, '').replace(/\//g, '_');
      const node = cy.getElementById(nodeId);

      return {
        breathingActive: node.data('breathingActive'),
        animationType: node.data('animationType'),
        isPinned: node.hasClass('pinned'),
        borderWidth: node.style('border-width')
      };
    }, filePath);

    console.log('Pinned node style:', pinnedStyle);

    expect(pinnedStyle.breathingActive).toBe(true);
    expect(pinnedStyle.animationType).toBe('pinned');
    expect(pinnedStyle.isPinned).toBe(true);
    expect(pinnedStyle.borderWidth).not.toBe('0');

    // Wait longer than NEW_NODE timeout (10 seconds)
    console.log('Waiting 10 seconds to verify pinned animation persists...');
    await page.waitForTimeout(10000);

    // Verify animation is still active
    const stillPinned = await page.evaluate((fp) => {
      const cy = (window as any).cytoscapeInstance;
      const nodeId = fp.replace(/\.md$/, '').replace(/\//g, '_');
      const node = cy.getElementById(nodeId);

      return {
        breathingActive: node.data('breathingActive'),
        animationType: node.data('animationType')
      };
    }, filePath);

    console.log('After 10 seconds, pinned node:', stillPinned);

    // Should still be animating (PINNED has no timeout)
    expect(stillPinned.breathingActive).toBe(true);
    expect(stillPinned.animationType).toBe('pinned');

    console.log('✓ Pinned node animation persistence test completed');
  });
});
