import cytoscape from 'cytoscape';
// @ts-ignore
import cola from 'cytoscape-cola';
import { MarkdownParser, type ParsedNode } from './data/load_markdown/MarkdownParser';
import { CytoscapeCore } from './graphviz/CytoscapeCore';
import { type NodeDefinition, type EdgeDefinition } from './types';
import { LayoutManager, SeedParkRelaxStrategy } from './graphviz/layout';

// Import all markdown files from the tests directory
const markdownModules = import.meta.glob('../../tests/example_small/*.md', {
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

    // Initialize LayoutManager with SeedParkRelaxStrategy
    const layoutManager = new LayoutManager(new SeedParkRelaxStrategy());

    // Store linkedNodeIds on nodes for the layout algorithm
    nodeElements.forEach(nodeEl => {
      const linkedIds: string[] = [];
      edgeElements.forEach(edgeEl => {
        if (edgeEl.data.source === nodeEl.data.id) {
          linkedIds.push(edgeEl.data.target);
        } else if (edgeEl.data.target === nodeEl.data.id) {
          linkedIds.push(edgeEl.data.source);
        }
      });
      nodeEl.data.linkedNodeIds = linkedIds;
    });

    // Apply the layout using BFS from root
    console.log('Applying incremental layout...');
    layoutManager.positionGraphBFS(cy);

    // Fit to viewport
    cy.fit(50);

    // Expose to window for debugging and testing
    (window as any).cy = cy;
    (window as any).cytoscapeCore = cytoscapeCore;
    (window as any).parsedNodes = parsedNodes;
    (window as any).layoutManager = layoutManager;
    (window as any).LayoutManager = LayoutManager;
    (window as any).SeedParkRelaxStrategy = SeedParkRelaxStrategy;

    console.log('Graph initialization complete!');
    console.log('Available in window: cy, cytoscapeCore, parsedNodes');

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