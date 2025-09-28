import { test, expect } from '@playwright/test';

test('Quick style verification', async ({ page }) => {
  // Navigate to the test page
  await page.goto('http://localhost:3002/test-style-verification.html');

  // Wait for CytoscapeCore to initialize
  await page.waitForTimeout(1000);

  // Check status
  const status = await page.textContent('#status');
  console.log('Status:', status);

  // Get node information
  const nodeInfo = await page.evaluate(() => {
    // @ts-expect-error - Accessing window.cytoscapeCore for testing purposes - Mock cytoscape style methods for testing
    const cy = window.cytoscapeCore?.getCore();
    if (!cy) return { error: 'No cytoscape instance' };

    const nodes = cy.nodes().map((node: any) => ({
      id: node.id(),
      label: node.data('label'),
      degree: node.data('degree'),
      // Get actual rendered styles
      width: node.renderedWidth(),
      height: node.renderedHeight(),
      backgroundColor: node.renderedStyle('background-color'),
      shape: node.renderedStyle('shape'),
      classes: node.classes().join(' ')
    }));

    const edges = cy.edges().map((edge: any) => ({
      id: edge.id(),
      width: edge.renderedStyle('line-color'),
      lineColor: edge.renderedStyle('line-color'),
      edgeCount: edge.data('edgeCount')
    }));

    return { nodes, edges };
  });

  console.log('=== STYLE VERIFICATION RESULTS ===');
  console.log('Nodes:', JSON.stringify(nodeInfo.nodes, null, 2));
  console.log('Edges:', JSON.stringify(nodeInfo.edges, null, 2));

  // Verify size differences based on degree
  const small = nodeInfo.nodes?.find((n: any) => n.id === 'small');
  const large = nodeInfo.nodes?.find((n: any) => n.id === 'large');

  console.log('\n=== SIZE COMPARISON ===');
  console.log(`Small node (degree 2): width=${small?.width}, height=${small?.height}`);
  console.log(`Large node (degree 40): width=${large?.width}, height=${large?.height}`);

  if (small && large) {
    expect(large.width).toBeGreaterThan(small.width);
    expect(large.height).toBeGreaterThan(small.height);
    console.log('✓ Degree-based sizing is working!');
  }

  // Check dangling node color
  const dangling = nodeInfo.nodes?.find((n: any) => n.id === 'dangling');
  console.log(`\nDangling node color: ${dangling?.backgroundColor}`);
  console.log(`Dangling node classes: ${dangling?.classes}`);

  // Test hover effect
  await page.click('#controls button:nth-child(2)'); // Click "Test Hover"
  await page.waitForTimeout(500);

  const hoverInfo = await page.evaluate(() => {
    // @ts-expect-error - Accessing window.cytoscapeCore for testing purposes - Mock cytoscape style methods for testing
    const cy = window.cytoscapeCore?.getCore();
    const medium = cy?.getElementById('medium');
    return {
      hasHoverClass: medium?.hasClass('hover'),
      currentColor: medium?.renderedStyle('background-color')
    };
  });

  console.log('\n=== HOVER TEST ===');
  console.log(`Has hover class: ${hoverInfo.hasHoverClass}`);
  console.log(`Current color during hover: ${hoverInfo.currentColor}`);

  // Test pin animation
  await page.click('#controls button:nth-child(3)'); // Click "Test Pin Animation"
  await page.waitForTimeout(500);

  const animationInfo = await page.evaluate(() => {
    // @ts-expect-error - Accessing window.cytoscapeCore for testing purposes - Mock cytoscape style methods for testing
    const cy = window.cytoscapeCore?.getCore();
    const small = cy?.getElementById('small');
    return {
      isPinned: small?.hasClass('pinned'),
      isLocked: small?.locked(),
      hasAnimation: small?.data('breathingActive'),
      animationType: small?.data('animationType'),
      borderWidth: small?.renderedStyle('border-width'),
      borderColor: small?.renderedStyle('border-color')
    };
  });

  console.log('\n=== ANIMATION TEST ===');
  console.log('Animation info:', JSON.stringify(animationInfo, null, 2));

  if (animationInfo.hasAnimation) {
    console.log('✓ Breathing animation is working!');
  }

  // Take a screenshot
  await page.screenshot({
    path: 'tests/e2e/screenshots/style-verification.png',
    fullPage: true
  });

  console.log('\n✓ Screenshot saved to tests/e2e/screenshots/style-verification.png');
});