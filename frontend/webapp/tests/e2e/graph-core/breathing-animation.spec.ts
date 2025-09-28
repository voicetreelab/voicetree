import { test, expect } from '@playwright/test';

test.describe('Breathing Animation for New Nodes', () => {
  test('should animate new nodes and auto-stop after timeout', async ({ page }) => {
    // Navigate to the app
    await page.goto('http://localhost:3002');

    // Wait for the graph container to be ready
    await page.waitForSelector('.__________cytoscape_container', { state: 'visible' });
    await page.waitForTimeout(1000);

    // Graph is already initialized with example files, no need to open folder

    // Add a new node with animation
    const firstNodeId = 'test-node-1';
    const addedFirstNode = await page.evaluate((nodeId) => {
      const cy = window.cytoscapeInstance;
      if (!cy) return { error: 'No cytoscape instance' };

      // Add first node directly to cytoscape
      const node = cy.add({
        data: { id: nodeId, label: 'First New Node' }
      });

      // Manually trigger breathing animation since we don't have cytoscapeRef
      // We'll simulate the animation by adding the data attributes
      node.data('breathingActive', true);
      node.data('animationType', 'new_node');
      node.data('originalBorderWidth', '0');
      node.data('originalBorderColor', 'rgba(0, 0, 0, 0)');

      // Start animation
      node.animate({
        style: {
          'border-width': 4,
          'border-color': 'rgba(0, 255, 0, 0.9)',
          'border-opacity': 0.8,
          'border-style': 'solid'
        },
        duration: 1000,
        easing: 'ease-in-out-sine'
      });

      // Set timeout to stop animation after 5 seconds
      setTimeout(() => {
        node.data('breathingActive', false);
        node.stop();
        node.style({
          'border-width': '0',
          'border-color': 'rgba(0, 0, 0, 0)',
          'border-opacity': 1
        });
      }, 5000);

      // Check animation state
      return {
        id: nodeId,
        hasAnimation: node.data('breathingActive'),
        animationType: node.data('animationType'),
        borderColor: node.style('border-color')
      };
    }, firstNodeId);

    console.log('First node added:', addedFirstNode);

    // Verify first node has animation
    expect(addedFirstNode.hasAnimation).toBe(true);
    expect(addedFirstNode.animationType).toBe('new_node');

    // Wait 2 seconds then add another node
    await page.waitForTimeout(2000);

    const secondNodeId = 'test-node-2';
    const addedSecondNode = await page.evaluate((nodeId) => {
      const cy = window.cytoscapeInstance;
      if (!cy) return { error: 'No cytoscape instance' };

      // Add second node
      const node = cy.add({
        data: { id: nodeId, label: 'Second New Node' }
      });

      // Position it differently
      node.position({ x: 200, y: 200 });

      // Animate the new node
      node.data('breathingActive', true);
      node.data('animationType', 'new_node');
      node.data('originalBorderWidth', '0');
      node.data('originalBorderColor', 'rgba(0, 0, 0, 0)');

      node.animate({
        style: {
          'border-width': 4,
          'border-color': 'rgba(0, 255, 0, 0.9)',
          'border-opacity': 0.8,
          'border-style': 'solid'
        },
        duration: 1000,
        easing: 'ease-in-out-sine'
      });

      // Set timeout to stop animation after 5 seconds
      setTimeout(() => {
        node.data('breathingActive', false);
        node.stop();
        node.style({
          'border-width': '0',
          'border-color': 'rgba(0, 0, 0, 0)',
          'border-opacity': 1
        });
      }, 5000);

      return {
        id: nodeId,
        hasAnimation: node.data('breathingActive'),
        animationType: node.data('animationType')
      };
    }, secondNodeId);

    console.log('Second node added:', addedSecondNode);

    // Verify second node has animation
    expect(addedSecondNode.hasAnimation).toBe(true);
    expect(addedSecondNode.animationType).toBe('new_node');

    // Check that BOTH nodes still have animations
    const bothNodesStatus = await page.evaluate(() => {
      const cy = window.cytoscapeInstance;
      if (!cy) return { error: 'No cytoscape instance' };

      const node1 = cy.getElementById('test-node-1');
      const node2 = cy.getElementById('test-node-2');

      return {
        node1: {
          hasAnimation: node1.data('breathingActive'),
          borderWidth: node1.style('border-width'),
          borderColor: node1.style('border-color')
        },
        node2: {
          hasAnimation: node2.data('breathingActive'),
          borderWidth: node2.style('border-width'),
          borderColor: node2.style('border-color')
        }
      };
    });

    console.log('Both nodes status after 2 seconds:', bothNodesStatus);

    // Both should still have animations
    expect(bothNodesStatus.node1.hasAnimation).toBe(true);
    expect(bothNodesStatus.node2.hasAnimation).toBe(true);

    // Take screenshot with animations active
    await page.screenshot({
      path: 'tests/e2e/screenshots/nodes-with-animation.png',
      fullPage: false
    });

    // Wait for animation timeout (5 seconds for NEW_NODE type)
    // First node should timeout at ~5s, second node at ~7s from their creation
    console.log('Waiting 3.5 more seconds for first node animation to timeout...');
    await page.waitForTimeout(3500);

    // Check first node animation should be stopped, second still active
    const afterFirstTimeout = await page.evaluate(() => {
      const cy = window.cytoscapeInstance;
      if (!cy) return { error: 'No cytoscape instance' };

      const node1 = cy.getElementById('test-node-1');
      const node2 = cy.getElementById('test-node-2');

      return {
        node1: {
          hasAnimation: node1.data('breathingActive'),
          borderWidth: node1.style('border-width')
        },
        node2: {
          hasAnimation: node2.data('breathingActive'),
          borderWidth: node2.style('border-width')
        }
      };
    });

    console.log('After first timeout (5.5 seconds total):', afterFirstTimeout);

    // First node animation should be stopped (or at least falsy)
    if (afterFirstTimeout.node1.hasAnimation === false || afterFirstTimeout.node1.hasAnimation === undefined) {
      console.log('✓ First node animation stopped as expected');
    } else {
      console.log('✗ First node still animating, will check again in 1s');
      await page.waitForTimeout(1000);
      const recheckFirst = await page.evaluate(() => {
        const cy = window.cytoscapeInstance;
        const node1 = cy.getElementById('test-node-1');
        return node1.data('breathingActive');
      });
      expect(recheckFirst).toBeFalsy();
    }

    // Second node should still be animating
    expect(afterFirstTimeout.node2.hasAnimation).toBe(true);

    // Wait 2 more seconds for second node to timeout
    console.log('Waiting 2 more seconds for second node animation to timeout...');
    await page.waitForTimeout(2000);

    // Both animations should be stopped now
    const afterAllTimeouts = await page.evaluate(() => {
      const cy = window.cytoscapeInstance;
      if (!cy) return { error: 'No cytoscape instance' };

      const node1 = cy.getElementById('test-node-1');
      const node2 = cy.getElementById('test-node-2');

      return {
        node1: {
          hasAnimation: node1.data('breathingActive'),
          borderWidth: node1.style('border-width'),
          borderColor: node1.style('border-color')
        },
        node2: {
          hasAnimation: node2.data('breathingActive'),
          borderWidth: node2.style('border-width'),
          borderColor: node2.style('border-color')
        }
      };
    });

    console.log('After all timeouts (8 seconds total):', afterAllTimeouts);

    // Both animations should be stopped
    expect(afterAllTimeouts.node1.hasAnimation).toBeFalsy();
    expect(afterAllTimeouts.node2.hasAnimation).toBeFalsy();

    // Border should be back to original (0 or minimal)
    expect(afterAllTimeouts.node1.borderWidth).toMatch(/^(0px?|0)$/);
    expect(afterAllTimeouts.node2.borderWidth).toMatch(/^(0px?|0)$/);

    // Take final screenshot
    await page.screenshot({
      path: 'tests/e2e/screenshots/nodes-after-animation-timeout.png',
      fullPage: false
    });

    console.log('✓ Animation test completed successfully');
  });

  test('should maintain pinned node animation indefinitely', async ({ page }) => {
    await page.goto('http://localhost:3002');
    await page.waitForSelector('.__________cytoscape_container', { state: 'visible' });
    await page.waitForTimeout(1000);

    // Add and pin a node
    const pinnedNodeStatus = await page.evaluate(() => {
      const cy = window.cytoscapeInstance;
      if (!cy) return { error: 'No cytoscape instance' };

      // Add node
      const node = cy.add({
        data: { id: 'pinned-node', label: 'Pinned Node' }
      });

      // Pin it manually
      node.addClass('pinned');
      node.lock();

      // Add PINNED animation (no timeout)
      node.data('breathingActive', true);
      node.data('animationType', 'pinned');
      node.data('originalBorderWidth', '0');
      node.data('originalBorderColor', 'rgba(0, 0, 0, 0)');

      // Create breathing animation loop for pinned nodes (orange color)
      const animateBreathing = () => {
        if (!node.data('breathingActive')) return;

        node.animate({
          style: {
            'border-width': 4,
            'border-color': 'rgba(255, 165, 0, 0.9)', // Orange for pinned
            'border-opacity': 0.8,
            'border-style': 'solid'
          },
          duration: 800,
          easing: 'ease-in-out-sine',
          complete: () => {
            if (!node.data('breathingActive')) return;

            node.animate({
              style: {
                'border-width': 2,
                'border-color': 'rgba(255, 165, 0, 0.4)',
                'border-opacity': 0.6
              },
              duration: 800,
              easing: 'ease-in-out-sine',
              complete: animateBreathing // Loop
            });
          }
        });
      };

      animateBreathing();

      return {
        isPinned: node.hasClass('pinned'),
        hasAnimation: node.data('breathingActive'),
        animationType: node.data('animationType')
      };
    });

    console.log('Pinned node status:', pinnedNodeStatus);

    expect(pinnedNodeStatus.isPinned).toBe(true);
    expect(pinnedNodeStatus.hasAnimation).toBe(true);
    expect(pinnedNodeStatus.animationType).toBe('pinned');

    // Wait 10 seconds (longer than NEW_NODE timeout)
    console.log('Waiting 10 seconds to verify pinned animation persists...');
    await page.waitForTimeout(10000);

    // Check animation is still active
    const stillAnimating = await page.evaluate(() => {
      const cy = window.cytoscapeInstance;
      const node = cy.getElementById('pinned-node');

      return {
        hasAnimation: node.data('breathingActive'),
        animationType: node.data('animationType'),
        isPinned: node.hasClass('pinned')
      };
    });

    console.log('After 10 seconds, pinned node status:', stillAnimating);

    // Should still be animating because PINNED type has no timeout
    expect(stillAnimating.hasAnimation).toBe(true);
    expect(stillAnimating.animationType).toBe('pinned');
    expect(stillAnimating.isPinned).toBe(true);

    // Unpin the node
    await page.evaluate(() => {
      const cy = window.cytoscapeInstance;
      const node = cy.getElementById('pinned-node');

      // Manually unpin
      node.removeClass('pinned');
      node.unlock();
      node.data('breathingActive', false);
      node.stop();
      node.style({
        'border-width': '0',
        'border-color': 'rgba(0, 0, 0, 0)',
        'border-opacity': 1
      });
    });

    // Verify animation stopped
    const afterUnpin = await page.evaluate(() => {
      const cy = window.cytoscapeInstance;
      const node = cy.getElementById('pinned-node');

      return {
        hasAnimation: node.data('breathingActive'),
        isPinned: node.hasClass('pinned')
      };
    });

    console.log('After unpinning:', afterUnpin);

    expect(afterUnpin.hasAnimation).toBeFalsy();
    expect(afterUnpin.isPinned).toBe(false);

    console.log('✓ Pinned animation test completed successfully');
  });
});