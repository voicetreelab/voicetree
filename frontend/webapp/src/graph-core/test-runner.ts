import cytoscape from 'cytoscape';
// @ts-ignore
import cola from 'cytoscape-cola';
import { MarkdownParser, type ParsedNode } from './data/MarkdownParser';
import { CytoscapeCore } from './CytoscapeCore';
import { type NodeDefinition, type EdgeDefinition } from './types';

// Register cola extension with cytoscape
cytoscape.use(cola);

// Files to load from the example_small directory
const TEST_FILES = [
  '/Users/bobbobby/repos/VoiceTree/frontend/tests/example_small/1_VoiceTree_Website_Development_and_Node_Display_Bug.md',
  '/Users/bobbobby/repos/VoiceTree/frontend/tests/example_small/2_VoiceTree_Node_ID_Duplication_Bug.md',
  '/Users/bobbobby/repos/VoiceTree/frontend/tests/example_small/3_Speaker_s_Immediate_Action_Testing.md',
  '/Users/bobbobby/repos/VoiceTree/frontend/tests/example_small/4_Test_Outcome_No_Output.md',
  '/Users/bobbobby/repos/VoiceTree/frontend/tests/example_small/5_Immediate_Test_Observation_No_Output.md',
  '/Users/bobbobby/repos/VoiceTree/frontend/tests/example_small/6_Personal_Logistics_and_Requests.md'
];

async function initializeGraph() {
  console.log('Initializing graph test...');

  try {
    // Get the container element
    const container = document.getElementById('graph-container');
    if (!container) {
      throw new Error('Graph container not found');
    }

    // Load and parse markdown files
    console.log('Loading markdown files...');
    const fileMap = new Map<string, string>();

    for (const filePath of TEST_FILES) {
      try {
        const fileName = filePath.split('/').pop() || '';
        const content = await loadFileViaDevServer(fileName);
        fileMap.set(fileName, content);
      } catch (error) {
        console.warn(`Failed to load ${filePath}:`, error);
      }
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
        if (link.targetNodeId) {
          edgeElements.push({
            data: {
              id: `${node.id}-${link.targetNodeId}-${index}`,
              source: node.id,
              target: link.targetNodeId,
              label: link.type
            }
          });
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

    // Apply Cola layout
    console.log('Running Cola layout...');
    const layout = cy.layout({
      name: 'cola',
      animate: true,
      refresh: 1,
      maxSimulationTime: 4000,
      ungrabifyWhileSimulating: false,
      fit: true,
      padding: 30,
      nodeDimensionsIncludeLabels: true,
      randomize: false,
      avoidOverlap: true,
      convergenceThreshold: 0.01,
      nodeSpacing: function(node: any) { return 50; },
      edgeLength: function(edge: any) { return 100; }
    } as any);

    layout.run();

    // Expose to window for debugging
    (window as any).cy = cy;
    (window as any).cytoscapeCore = cytoscapeCore;
    (window as any).parsedNodes = parsedNodes;

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

// Alternative approach: Load files from relative paths via vite dev server
async function loadFileViaDevServer(fileName: string): Promise<string> {
  try {
    // Try to load from public directory or served assets
    const response = await fetch(`/example_small/${fileName}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.text();
  } catch (error) {
    console.warn(`Failed to load ${fileName} via dev server, trying direct file access...`);
    throw error;
  }
}

// Initialize function - attempts to load files and render graph

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeGraph);
} else {
  initializeGraph();
}