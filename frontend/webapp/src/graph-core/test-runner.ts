import { MarkdownParser } from './data/load_markdown/MarkdownParser';
import { CytoscapeCore } from './graphviz/CytoscapeCore';
import { LayoutManager, SeedParkRelaxStrategy, TidyLayoutStrategy, IncrementalTidyLayoutStrategy as _IncrementalTidyLayoutStrategy } from './graphviz/layout';

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
  : import.meta.glob('../../tests/fixtures/example_small/*.md', {
      query: '?raw',
      import: 'default',
      eager: true
    });

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

    // Use parseDirectory to get correct parent-child relationships
    const graphData = await MarkdownParser.parseDirectory(fileMap);

    console.log(`Parsed ${graphData.nodes.length} nodes and ${graphData.edges.length} edges`);

    // Initialize Cytoscape with elements (already in correct format)
    console.log('Initializing Cytoscape...');
    const cytoscapeCore = new CytoscapeCore(container, [...graphData.nodes, ...graphData.edges]);

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
    const isBulkLoad = graphData.nodes.length > 10; // Heuristic: >10 nodes = bulk load
    const strategy = isBulkLoad ? new TidyLayoutStrategy() : new SeedParkRelaxStrategy();
    const layoutManager = new LayoutManager(strategy);

    console.log(`Using ${strategy.name} layout strategy for ${graphData.nodes.length} nodes`);

    // Store linkedNodeIds on nodes for the layout algorithm
    // Edges in our data go FROM child TO parent (child links to parent)
    // So linkedNodeIds = targets of outgoing edges = parents
    graphData.nodes.forEach(nodeEl => {
      const linkedIds: string[] = [];
      graphData.edges.forEach(edgeEl => {
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
      const allNodeIds = graphData.nodes.map(n => n.data.id);
      layoutManager.applyLayout(cy, allNodeIds);

      // Fit to viewport after layout animation completes
      setTimeout(() => {
        cy.fit(undefined, 50);
        console.log('Initial fit complete');
      }, 350); // 300ms layout animation + 50ms buffer
    } else {
      // For incremental, use BFS positioning
      console.log('Applying incremental layout...');
      layoutManager.positionGraphBFS(cy);
      // Fit immediately for incremental (no animation)
      cy.fit(undefined, 50);
    }

    // Expose to window for debugging and testing
    (window as typeof window & { cy?: unknown; cytoscapeCore?: unknown; graphData?: unknown; layoutManager?: unknown; LayoutManager?: unknown; SeedParkRelaxStrategy?: unknown }).cy = cy;
    (window as typeof window & { cy?: unknown; cytoscapeCore?: unknown; graphData?: unknown; layoutManager?: unknown; LayoutManager?: unknown; SeedParkRelaxStrategy?: unknown }).cytoscapeCore = cytoscapeCore;
    (window as typeof window & { cy?: unknown; cytoscapeCore?: unknown; graphData?: unknown; layoutManager?: unknown; LayoutManager?: unknown; SeedParkRelaxStrategy?: unknown }).graphData = graphData;
    (window as typeof window & { cy?: unknown; cytoscapeCore?: unknown; graphData?: unknown; layoutManager?: unknown; LayoutManager?: unknown; SeedParkRelaxStrategy?: unknown }).layoutManager = layoutManager;
    (window as typeof window & { cy?: unknown; cytoscapeCore?: unknown; graphData?: unknown; layoutManager?: unknown; LayoutManager?: unknown; SeedParkRelaxStrategy?: unknown }).LayoutManager = LayoutManager;
    (window as typeof window & { cy?: unknown; cytoscapeCore?: unknown; graphData?: unknown; layoutManager?: unknown; LayoutManager?: unknown; SeedParkRelaxStrategy?: unknown }).SeedParkRelaxStrategy = SeedParkRelaxStrategy;

    console.log('Graph initialization complete!');
    console.log(`Loaded ${fixtureSet} fixture with ${graphData.nodes.length} nodes and ${graphData.edges.length} edges`);
    console.log('Available in window: cy, cytoscapeCore, graphData, layoutManager');

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