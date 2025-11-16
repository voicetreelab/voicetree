/**
 * Random Node Addition Test Script
 *
 * Copy-paste this into your browser console to test TidyLayoutStrategy
 * with incremental node additions.
 *
 * Usage: Just paste the entire script into console and run it.
 */

(async function() {
  // Get cytoscape instance and layout manager from your app
  const cy = window.cytoscapeInstance;
  const layoutManager = window.layoutManager;

  if (!cy || !layoutManager) {
    console.error('Cytoscape or LayoutManager not found! Make sure the graph is loaded.');
    console.error('cy:', !!cy, 'layoutManager:', !!layoutManager);
    return;
  }

  console.log('[TestScript] Starting random node addition test...');
  console.log('[TestScript] Initial node count:', cy.nodes().length);

  let nodesAdded = 0;
  const totalNodes = 100;
  let nodeCounter = cy.nodes().length;

  const interval = setInterval(async () => {
    // Get all existing nodes (includes both original nodes and test nodes added so far)
    const existingNodes = cy.nodes().toArray();

    if (existingNodes.length === 0) {
      console.warn('[TestScript] No existing nodes found! Adding root node first...');
      cy.add({
        group: 'nodes',
        data: {
          id: `test-node-0`,
          label: `Test Node 0`,
          width: 20,
          height: 10
        },
        position: { x: 0, y: 0 }
      });
      nodeCounter++;
      nodesAdded++;
      return;
    }

    // Pick random parent from all existing nodes (can be original or previously added test node)
    const randomParent = existingNodes[Math.floor(Math.random() * existingNodes.length)];
    const parentId = randomParent.id();
    const isTestNode = parentId.startsWith('test-node-');

    console.log(`[TestScript] Selected parent: ${parentId}${isTestNode ? ' (test node)' : ' (original node)'}, available nodes: ${existingNodes.length}`);

    // Create new node ID
    const newNodeId = `test-node-${nodeCounter}`;
    nodeCounter++;

    // Add node to cytoscape
    cy.add([
      {
        group: 'nodes',
        data: {
          id: newNodeId,
          label: `Test Node ${nodeCounter}`,
          parent: parentId, // Store parent for layout
          width: 20,
          height: 10
        },
        position: { x: 0, y: 0 } // Will be positioned by layout
      },
      {
        group: 'edges',
        data: {
          id: `edge-${newNodeId}`,
          source: parentId,
          target: newNodeId
        }
      }
    ]);

    nodesAdded++;
    console.log(`[TestScript] Added node ${nodesAdded}/${totalNodes}: ${newNodeId} -> parent: ${parentId}`);

    // Directly trigger layout for the new node
    await layoutManager.applyLayout(cy, [newNodeId]);

    // Stop after 100 nodes
    if (nodesAdded >= totalNodes) {
      clearInterval(interval);
      console.log('[TestScript] Test complete! Added', nodesAdded, 'nodes');
      console.log('[TestScript] Final node count:', cy.nodes().length);
    }
  }, 1000); // 1 second interval

  // Allow stopping the test early
  window.stopNodeTest = () => {
    clearInterval(interval);
    console.log('[TestScript] Test stopped by user. Nodes added:', nodesAdded);
  };

  console.log('[TestScript] Test running... (call window.stopNodeTest() to stop early)');
})();
