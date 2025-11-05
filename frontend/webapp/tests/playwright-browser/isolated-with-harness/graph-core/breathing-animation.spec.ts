/**
 * Tests breathing animation feature for graph nodes:
 * - New nodes: green breathing until hover (stops immediately on hover)
 * - Updated nodes: cyan breathing with 10s timeout
 * - Multiple new nodes: latest animates indefinitely, previous get 10s timeout
 * - Pinned nodes: orange breathing indefinitely (no timeout)
 */
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
    // Sample border width multiple times to verify it's actually animating (breathing)
    const breathingCheck = await page.evaluate(async (filePath) => {
      const cy = (window as any).cytoscapeInstance;
      if (!cy) return null;

      // Normalize the file path to match how the app does it
      const nodeId = filePath.replace(/\.md$/, '').replace(/\//g, '_');
      const node = cy.getElementById(nodeId);

      if (!node || node.length === 0) return null;

      // Sample border width at 3 different points in time
      const samples: number[] = [];
      for (let i = 0; i < 3; i++) {
        const borderWidth = parseFloat(node.style('border-width'));
        samples.push(borderWidth);
        await new Promise(resolve => setTimeout(resolve, 400)); // Wait 400ms between samples
      }

      // Check if values are different (breathing = animating)
      const isAnimating = samples[0] !== samples[1] || samples[1] !== samples[2];

      return {
        exists: true,
        borderWidthSamples: samples,
        isAnimating,
        borderColor: node.style('border-color'),
        borderOpacity: node.style('border-opacity'),
        breathingActive: node.data('breathingActive'),
        animationType: node.data('animationType')
      };
    }, newFilePath);

    console.log('New node breathing check:', breathingCheck);

    // Verify animation is active
    expect(breathingCheck).not.toBeNull();
    expect(breathingCheck?.exists).toBe(true);
    expect(breathingCheck?.breathingActive).toBe(true);
    expect(breathingCheck?.animationType).toBe('new_node');

    // Check that animation is actually breathing (border width changes over time)
    expect(breathingCheck?.isAnimating).toBe(true);

    // Check for visible border
    for (const sample of breathingCheck?.borderWidthSamples || []) {
      expect(sample).toBeGreaterThan(0);
    }

    // Take screenshot during animation
    await page.screenshot({
      path: 'tests/e2e/screenshots/new-node-breathing-animation.png',
      fullPage: false
    });

    // Hover over the node - should stop animation immediately
    await page.evaluate((filePath) => {
      const cy = (window as any).cytoscapeInstance;
      const nodeId = filePath.replace(/\.md$/, '').replace(/\//g, '_');
      const node = cy.getElementById(nodeId);

      // Trigger mouseover event
      node.emit('mouseover');
    }, newFilePath);

    // Wait briefly for any event handlers to process
    await page.waitForTimeout(100);

    // Verify animation stopped after hover - check multiple times to ensure it stays stopped
    const afterHoverChecks = await page.evaluate(async (filePath) => {
      const cy = (window as any).cytoscapeInstance;
      const nodeId = filePath.replace(/\.md$/, '').replace(/\//g, '_');
      const node = cy.getElementById(nodeId);

      const checks = [];
      for (let i = 0; i < 3; i++) {
        checks.push({
          breathingActive: node.data('breathingActive'),
          borderWidth: node.style('border-width')
        });
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      return checks;
    }, newFilePath);

    console.log('After hover checks:', afterHoverChecks);

    // All checks should show animation is stopped
    for (const check of afterHoverChecks) {
      expect(check.breathingActive).toBeFalsy();
      expect(check.borderWidth).toMatch(/^(0px?|0)$/);
    }

    // Also verify border width is not changing (animation really stopped)
    const borderWidths = afterHoverChecks.map(c => c.borderWidth);
    const allSame = borderWidths.every(w => w === borderWidths[0]);
    expect(allSame).toBe(true);

    console.log('✓ New node breathing animation test completed (stops on hover)');
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
    // Sample multiple times to verify it's actually animating
    const updatedNodeBreathing = await page.evaluate(async (fp) => {
      const cy = (window as any).cytoscapeInstance;
      const nodeId = fp.replace(/\.md$/, '').replace(/\//g, '_');
      const node = cy.getElementById(nodeId);

      // Sample border width at 3 different points in time
      const samples: number[] = [];
      for (let i = 0; i < 3; i++) {
        const borderWidth = parseFloat(node.style('border-width'));
        samples.push(borderWidth);
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms between samples
      }

      // Check if values are different (breathing = animating)
      const isAnimating = samples[0] !== samples[1] || samples[1] !== samples[2];

      return {
        exists: node && node.length > 0,
        borderWidthSamples: samples,
        isAnimating,
        borderColor: node.style('border-color'),
        breathingActive: node.data('breathingActive'),
        animationType: node.data('animationType')
      };
    }, filePath);

    console.log('Updated node breathing check:', updatedNodeBreathing);

    // Verify appended content animation
    expect(updatedNodeBreathing.exists).toBe(true);
    expect(updatedNodeBreathing.breathingActive).toBe(true);
    expect(updatedNodeBreathing.animationType).toBe('appended_content');

    // Check that animation is actually breathing (border width changes over time)
    expect(updatedNodeBreathing.isAnimating).toBe(true);

    // All samples should be non-zero
    for (const sample of updatedNodeBreathing.borderWidthSamples) {
      expect(sample).toBeGreaterThan(0);
    }

    // Take screenshot
    await page.screenshot({
      path: 'tests/e2e/screenshots/updated-node-breathing-animation.png',
      fullPage: false
    });

    // Wait for 10s timeout for appended content
    console.log('Waiting 10.5s for appended content animation timeout...');
    await page.waitForTimeout(10500);

    // Verify animation stopped after timeout
    const afterTimeout = await page.evaluate((fp) => {
      const cy = (window as any).cytoscapeInstance;
      const nodeId = fp.replace(/\.md$/, '').replace(/\//g, '_');
      const node = cy.getElementById(nodeId);
      return {
        breathingActive: node.data('breathingActive'),
        borderWidth: node.style('border-width')
      };
    }, filePath);

    console.log('After timeout:', afterTimeout);

    expect(afterTimeout.breathingActive).toBeFalsy();
    expect(afterTimeout.borderWidth).toMatch(/^(0px?|0)$/);

    console.log('✓ Updated node breathing animation test completed (with 10s timeout)');
  });

  test('should keep last new node animating, add timeout to previous nodes', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForSelector('.__________cytoscape_container', { state: 'visible' });
    await page.waitForTimeout(1000);

    // Create first new node
    const firstPath = 'test-first-node.md';
    const firstContent = '# First Node\n\nThis is the first node.';

    await page.evaluate(({ path, content }) => {
      (window as any).testHandlers.handleFileAdded({ path, content });
    }, { path: firstPath, content: firstContent });

    await page.waitForTimeout(500);

    // Verify first node is animating
    const firstAnimating = await page.evaluate((fp) => {
      const cy = (window as any).cytoscapeInstance;
      const nodeId = fp.replace(/\.md$/, '').replace(/\//g, '_');
      const node = cy.getElementById(nodeId);
      return node.data('breathingActive') === true;
    }, firstPath);

    expect(firstAnimating).toBe(true);
    console.log('✓ First node is animating');

    // Wait 3 seconds - first node should still be animating (no timeout)
    await page.waitForTimeout(3000);

    const firstStillAnimating = await page.evaluate((fp) => {
      const cy = (window as any).cytoscapeInstance;
      const nodeId = fp.replace(/\.md$/, '').replace(/\//g, '_');
      const node = cy.getElementById(nodeId);
      return node.data('breathingActive') === true;
    }, firstPath);

    expect(firstStillAnimating).toBe(true);
    console.log('✓ First node still animating after 3s (no timeout)');

    // Create second new node - this should add 10s timeout to first node
    const secondPath = 'test-second-node.md';
    const secondContent = '# Second Node\n\nThis is the second node.';

    await page.evaluate(({ path, content }) => {
      (window as any).testHandlers.handleFileAdded({ path, content });
    }, { path: secondPath, content: secondContent });

    await page.waitForTimeout(500);

    // Both should be animating now
    const bothStatus = await page.evaluate(({ first, second }) => {
      const cy = (window as any).cytoscapeInstance;
      const firstId = first.replace(/\.md$/, '').replace(/\//g, '_');
      const secondId = second.replace(/\.md$/, '').replace(/\//g, '_');
      return {
        first: cy.getElementById(firstId).data('breathingActive'),
        second: cy.getElementById(secondId).data('breathingActive')
      };
    }, { first: firstPath, second: secondPath });

    expect(bothStatus.first).toBe(true);
    expect(bothStatus.second).toBe(true);
    console.log('✓ Both nodes animating after second node created');

    // Wait 10.5 seconds - first node should timeout, second should still animate
    console.log('Waiting 10.5s for first node timeout...');
    await page.waitForTimeout(10500);

    const afterTimeout = await page.evaluate(({ first, second }) => {
      const cy = (window as any).cytoscapeInstance;
      const firstId = first.replace(/\.md$/, '').replace(/\//g, '_');
      const secondId = second.replace(/\.md$/, '').replace(/\//g, '_');
      return {
        first: {
          breathing: cy.getElementById(firstId).data('breathingActive'),
          border: cy.getElementById(firstId).style('border-width')
        },
        second: {
          breathing: cy.getElementById(secondId).data('breathingActive'),
          border: cy.getElementById(secondId).style('border-width')
        }
      };
    }, { first: firstPath, second: secondPath });

    console.log('After timeout:', afterTimeout);

    // First node should have stopped
    expect(afterTimeout.first.breathing).toBeFalsy();
    expect(afterTimeout.first.border).toMatch(/^(0px?|0)$/);

    // Second node should still be animating (no timeout)
    expect(afterTimeout.second.breathing).toBe(true);
    expect(afterTimeout.second.border).not.toMatch(/^(0px?|0)$/);

    console.log('✓ First node stopped, second node still animating');
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
