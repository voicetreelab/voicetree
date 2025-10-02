import cytoscape from 'cytoscape';
// @ts-expect-error - cytoscape-cola does not have proper TypeScript definitions
import cola from 'cytoscape-cola';
import { MarkdownParser, type ParsedNode } from './data/load_markdown/MarkdownParser';
import { CytoscapeCore } from './graphviz/CytoscapeCore';
import { type NodeDefinition, type EdgeDefinition } from './types';
import { LayoutManager, SeedParkRelaxStrategy, ReingoldTilfordStrategy } from './graphviz/layout';

// Import all markdown files from the tests directory
// Support different fixture sets via URL parameter: ?fixture=example_small or ?fixture=example_real_large
const urlParams = new URLSearchParams(window.location.search);
const fixtureSet = urlParams.get('fixture') || 'example_small';

const markdownModules = fixtureSet === 'example_real_large'
  ? import.meta.glob('../../tests/fixtures/example_real_large/**/*.md', {
      query: '?raw',
      import: 'default',
      eager: true
    })
  : import.meta.glob('../../tests/example_small/*.md', {
      query: '?raw',
      import: 'default',
      eager: true
    });

// Register cola extension with cytoscape
cytoscape.use(cola);

async function initializeGraph() {
  console.log('Initializing graph test...');

  try {
    // Get the container element
    const container = document.getElementById('graph-container');
    if (!container) {
      throw new Error('Graph container not found');
    }

    // Load and parse markdown files
    console.log('Loading markdown files from directory...');
    const fileMap = new Map<string, string>();

    // Process all imported markdown files
    for (const [path, content] of Object.entries(markdownModules)) {
      const fileName = path.split('/').pop() || '';
      fileMap.set(fileName, content as string);
    }

    if (fileMap.size === 0) {
      throw new Error('No files could be loaded');
    }

    console.log('Loaded files:', Array.from(fileMap.keys()));

    // Parse files with new parser method
    const parsedNodes: ParsedNode[] = [];
    for (const [filename, content] of fileMap) {
      const parsedNode = MarkdownParser.parseMarkdownFile(content, filename);
      parsedNodes.push(parsedNode);
    }

    console.log('Parsed nodes:', parsedNodes);

    // Debug: Log links for each node
    parsedNodes.forEach(node => {
      console.log(`Node ${node.id} (${node.filename}) has ${node.links.length} links:`, node.links);
    });

    // Convert parsed nodes to cytoscape elements
    const nodeElements: NodeDefinition[] = [];
    const edgeElements: EdgeDefinition[] = [];

    parsedNodes.forEach(node => {
      nodeElements.push({
        data: {
          id: node.id,
          label: node.title,
          content: node.content,
          filename: node.filename
        }
      });

      // Add edges for each link
      node.links.forEach((link, index) => {
        // Use targetFile as the target since that's what contains the actual filename
        if (link.targetFile) {
          // Find the corresponding node ID by matching the targetFile
          const targetNode = parsedNodes.find(n => n.filename === link.targetFile);
          if (targetNode) {
            edgeElements.push({
              data: {
                id: `${node.id}-${targetNode.id}-${index}`,
                source: node.id,
                target: targetNode.id,
                label: link.type
              }
            });
          }
        }
      });
    });

    // Initialize Cytoscape with elements
    console.log('Initializing Cytoscape...');
    const cytoscapeCore = new CytoscapeCore(container, [...nodeElements, ...edgeElements]);

    // Apply basic styling
    const cy = cytoscapeCore.getCore();
    cy.style([
      {
        selector: 'node',
        style: {
          'background-color': '#666',
          'label': 'data(label)',
          'text-valign': 'center',
          'text-halign': 'center',
          'color': '#fff',
          'font-size': '12px',
          'width': 'label',
          'height': 'label',
          'padding': '10px',
          'shape': 'round-rectangle'
        }
      },
      {
        selector: 'edge',
        style: {
          'width': 2,
          'line-color': '#ccc',
          'target-arrow-color': '#ccc',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'label': 'data(label)',
          'font-size': '10px',
          'text-rotation': 'autorotate'
        }
      },
      {
        selector: ':selected',
        style: {
          'background-color': '#4a90e2',
          'line-color': '#4a90e2',
          'target-arrow-color': '#4a90e2'
        }
      }
    ]);

    // Set initial positions in a circle
    console.log('Setting initial node positions...');
    const nodes = cy.nodes();
    const centerX = container.clientWidth / 2;
    const centerY = container.clientHeight / 2;
    const radius = Math.min(container.clientWidth, container.clientHeight) / 4;

    nodes.forEach((node, index) => {
      const angle = (2 * Math.PI * index) / nodes.length;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      node.position({ x, y });
    });

    // Choose layout strategy based on whether this is a bulk load
    // Bulk load: all nodes loaded at once (fixture loading)
    // Incremental: nodes added one at a time (file observer events)
    const isBulkLoad = nodeElements.length > 10; // Heuristic: >10 nodes = bulk load
    const strategy = isBulkLoad ? new ReingoldTilfordStrategy() : new SeedParkRelaxStrategy();
    const layoutManager = new LayoutManager(strategy);

    console.log(`Using ${strategy.name} layout strategy for ${nodeElements.length} nodes`);

    // Store linkedNodeIds on nodes for the layout algorithm
    // Edges in our data go FROM child TO parent (child links to parent)
    // So linkedNodeIds = targets of outgoing edges = parents
    nodeElements.forEach(nodeEl => {
      const linkedIds: string[] = [];
      edgeElements.forEach(edgeEl => {
        if (isBulkLoad) {
          // Hierarchical: linkedNodeIds = parents (targets of outgoing edges)
          if (edgeEl.data.source === nodeEl.data.id) {
            linkedIds.push(edgeEl.data.target);
          }
        } else {
          // Force-directed: bidirectional
          if (edgeEl.data.source === nodeEl.data.id) {
            linkedIds.push(edgeEl.data.target);
          } else if (edgeEl.data.target === nodeEl.data.id) {
            linkedIds.push(edgeEl.data.source);
          }
        }
      });
      nodeEl.data.linkedNodeIds = linkedIds;
    });

    // Apply the layout
    if (isBulkLoad) {
      // For bulk load with hierarchical layout, apply to all nodes at once
      console.log('Applying bulk hierarchical layout...');
      const allNodeIds = nodeElements.map(n => n.data.id);
      layoutManager.applyLayout(cy, allNodeIds);
    } else {
      // For incremental, use BFS positioning
      console.log('Applying incremental layout...');
      layoutManager.positionGraphBFS(cy);
    }

    // Fit to viewport
    cy.fit(50);

    // Expose to window for debugging and testing
    (window as typeof window & { cy?: unknown; cytoscapeCore?: unknown; parsedNodes?: unknown; layoutManager?: unknown; LayoutManager?: unknown; SeedParkRelaxStrategy?: unknown }).cy = cy;
    (window as typeof window & { cy?: unknown; cytoscapeCore?: unknown; parsedNodes?: unknown; layoutManager?: unknown; LayoutManager?: unknown; SeedParkRelaxStrategy?: unknown }).cytoscapeCore = cytoscapeCore;
    (window as typeof window & { cy?: unknown; cytoscapeCore?: unknown; parsedNodes?: unknown; layoutManager?: unknown; LayoutManager?: unknown; SeedParkRelaxStrategy?: unknown }).parsedNodes = parsedNodes;
    (window as typeof window & { cy?: unknown; cytoscapeCore?: unknown; parsedNodes?: unknown; layoutManager?: unknown; LayoutManager?: unknown; SeedParkRelaxStrategy?: unknown }).layoutManager = layoutManager;
    (window as typeof window & { cy?: unknown; cytoscapeCore?: unknown; parsedNodes?: unknown; layoutManager?: unknown; LayoutManager?: unknown; SeedParkRelaxStrategy?: unknown }).LayoutManager = LayoutManager;
    (window as typeof window & { cy?: unknown; cytoscapeCore?: unknown; parsedNodes?: unknown; layoutManager?: unknown; LayoutManager?: unknown; SeedParkRelaxStrategy?: unknown }).SeedParkRelaxStrategy = SeedParkRelaxStrategy;

    console.log('Graph initialization complete!');
    console.log(`Loaded ${fixtureSet} fixture with ${nodeElements.length} nodes and ${edgeElements.length} edges`);
    console.log('Available in window: cy, cytoscapeCore, parsedNodes, layoutManager');

    // Add event listeners for interactivity
    cy.on('tap', 'node', function(evt) {
      const node = evt.target;
      console.log('Node clicked:', {
        id: node.data('id'),
        label: node.data('label'),
        content: node.data('content'),
        filename: node.data('filename')
      });
    });

    cy.on('tap', 'edge', function(evt) {
      const edge = evt.target;
      console.log('Edge clicked:', {
        id: edge.data('id'),
        source: edge.data('source'),
        target: edge.data('target'),
        label: edge.data('label')
      });
    });

  } catch (error) {
    console.error('Failed to initialize graph:', error);

    // Display error in the container
    const container = document.getElementById('graph-container');
    if (container) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      container.innerHTML = `
        <div style="
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100%;
          font-family: Arial, sans-serif;
          color: #cc0000;
          flex-direction: column;
          padding: 20px;
          text-align: center;
        ">
          <h2>Graph Initialization Failed</h2>
          <p>Error: ${errorMessage}</p>
          <p style="font-size: 12px; opacity: 0.7;">Check console for details</p>
        </div>
      `;
    }
  }
}

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeGraph);
} else {
  initializeGraph();
}