import { ExampleLoader } from './data/load_markdown/ExampleLoader';
import { CytoscapeCore } from './graphviz/CytoscapeCore';
import { type NodeDefinition, type EdgeDefinition, type GraphData } from './types';
import { LayoutManager, SeedParkRelaxStrategy } from './graphviz/layout';

let cytoscapeCore: CytoscapeCore | null = null;
let layoutManager: LayoutManager;

function updateStatus(message: string, type: 'info' | 'success' | 'error' = 'info') {
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
  }
  console.log(`[${type.toUpperCase()}] ${message}`);
}

function clearGraph() {
  const container = document.getElementById('graph-container');
  if (container && cytoscapeCore) {
    const cy = cytoscapeCore.getCore();
    if (cy) {
      cy.elements().remove();
      cy.fit();
    }
    cytoscapeCore.destroy();
    cytoscapeCore = null;
  }
  // Also clear window reference
  (window as typeof window & { cy?: unknown; cytoscapeCore?: unknown }).cy = null;
  (window as typeof window & { cy?: unknown; cytoscapeCore?: unknown }).cytoscapeCore = null;
  updateStatus('Graph cleared');
}

function renderGraph(graphData: GraphData) {
  try {
    const container = document.getElementById('graph-container');
    if (!container) {
      throw new Error('Graph container not found');
    }

    // Clear existing graph
    if (cytoscapeCore) {
      cytoscapeCore.destroy();
    }

    // Convert GraphData to cytoscape elements
    const elements: (NodeDefinition | EdgeDefinition)[] = [
      ...graphData.nodes.map(node => ({
        data: {
          id: node.data.id,
          label: node.data.label,
          linkedNodeIds: node.data.linkedNodeIds
        }
      })),
      ...graphData.edges.map(edge => ({
        data: {
          id: edge.data.id,
          source: edge.data.source,
          target: edge.data.target,
          label: edge.data.id.includes('->') ? 'link' : 'connection'
        }
      }))
    ];

    // Initialize Cytoscape
    cytoscapeCore = new CytoscapeCore(container, elements);
    const cy = cytoscapeCore.getCore();

    // Apply styling
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

    // Set initial positions
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

    // Apply layout
    layoutManager = new LayoutManager(new SeedParkRelaxStrategy());
    layoutManager.positionGraphBFS(cy);
    cy.fit(50);

    // Expose to window for testing
    (window as typeof window & { cy?: unknown; cytoscapeCore?: unknown; layoutManager?: unknown }).cy = cy;
    (window as typeof window & { cy?: unknown; cytoscapeCore?: unknown; layoutManager?: unknown }).cytoscapeCore = cytoscapeCore;
    (window as typeof window & { cy?: unknown; cytoscapeCore?: unknown; layoutManager?: unknown }).layoutManager = layoutManager;

    // Add event listeners
    cy.on('tap', 'node', function(evt) {
      const node = evt.target;
      console.log('Node clicked:', {
        id: node.data('id'),
        label: node.data('label')
      });
    });

    updateStatus(`Graph rendered successfully with ${nodes.length} nodes and ${cy.edges().length} edges`, 'success');

  } catch (error) {
    console.error('Failed to render graph:', error);
    updateStatus(`Failed to render graph: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

// Helper function to simulate file loading with test data for automation
function loadTestData(): GraphData {
  // Return the same structure as ExampleLoader.loadExampleSmall() but simplified
  return {
    nodes: [
      { data: { id: 'test1.md', label: 'Test Node 1', linkedNodeIds: ['test2.md'] } },
      { data: { id: 'test2.md', label: 'Test Node 2', linkedNodeIds: ['test3.md'] } },
      { data: { id: 'test3.md', label: 'Test Node 3', linkedNodeIds: [] } }
    ],
    edges: [
      { data: { id: 'test1.md->test2.md', source: 'test1.md', target: 'test2.md' } },
      { data: { id: 'test2.md->test3.md', source: 'test2.md', target: 'test3.md' } }
    ]
  };
}

async function initializeFilePickers() {
  updateStatus('Initializing file picker interface...');

  // Button handlers
  const btnSingleFile = document.getElementById('btn-single-file');
  const btnMultipleFiles = document.getElementById('btn-multiple-files');
  const btnDirectory = document.getElementById('btn-directory');
  const btnExampleData = document.getElementById('btn-example-data');
  const btnClear = document.getElementById('btn-clear');
  const testFileInput = document.getElementById('test-file-input') as HTMLInputElement;

  if (btnSingleFile) {
    btnSingleFile.addEventListener('click', async () => {
      updateStatus('Opening single file picker...', 'info');
      try {
        const graphData = await ExampleLoader.loadSingleFile();
        if (graphData) {
          renderGraph(graphData);
        } else {
          updateStatus('No file selected', 'info');
        }
      } catch (error) {
        updateStatus(`Error loading single file: ${error}`, 'error');
      }
    });
  }

  if (btnMultipleFiles) {
    btnMultipleFiles.addEventListener('click', async () => {
      updateStatus('Opening multiple files picker...', 'info');
      try {
        const graphData = await ExampleLoader.loadFromUserFiles();
        if (graphData) {
          renderGraph(graphData);
        } else {
          updateStatus('No files selected', 'info');
        }
      } catch (error) {
        updateStatus(`Error loading multiple files: ${error}`, 'error');
      }
    });
  }

  if (btnDirectory) {
    btnDirectory.addEventListener('click', async () => {
      updateStatus('Opening directory picker...', 'info');
      try {
        const graphData = await ExampleLoader.loadFromDirectory();
        if (graphData) {
          renderGraph(graphData);
        } else {
          updateStatus('No directory selected', 'info');
        }
      } catch (error) {
        updateStatus(`Error loading directory: ${error}`, 'error');
      }
    });
  }

  if (btnExampleData) {
    btnExampleData.addEventListener('click', async () => {
      updateStatus('Loading example data...', 'info');
      try {
        const graphData = await ExampleLoader.loadExampleSmall();
        renderGraph(graphData);
      } catch (error) {
        updateStatus(`Error loading example data: ${error}`, 'error');
      }
    });
  }

  if (btnClear) {
    btnClear.addEventListener('click', () => {
      clearGraph();
    });
  }

  // Test file input for automation
  if (testFileInput) {
    testFileInput.addEventListener('change', async (event) => {
      const files = (event.target as HTMLInputElement).files;
      if (!files || files.length === 0) {
        updateStatus('No files selected in test input', 'info');
        return;
      }

      updateStatus(`Processing ${files.length} files from test input...`, 'info');
      try {
        const fileMap = new Map<string, string>();

        for (const file of Array.from(files)) {
          if (file.name.endsWith('.md') || file.type === 'text/markdown') {
            const content = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = () => reject(reader.error);
              reader.readAsText(file);
            });
            fileMap.set(file.name, content);
          }
        }

        if (fileMap.size === 0) {
          updateStatus('No markdown files found in selection', 'error');
          return;
        }

        // Use MarkdownParser to process files
        const { MarkdownParser } = await import('./data/load_markdown/MarkdownParser');
        const graphData = await MarkdownParser.parseDirectory(fileMap);
        renderGraph(graphData);

      } catch (error) {
        updateStatus(`Error processing test files: ${error}`, 'error');
      }
    });
  }

  // Set up drop zone
  const dropZone = document.getElementById('drop-zone');
  if (dropZone) {
    const fileDropZone = ExampleLoader.createFileDropZone((graphData: GraphData) => {
      renderGraph(graphData);
    });

    // Replace the existing drop zone with the functional one
    if (dropZone.parentNode) {
      dropZone.parentNode.replaceChild(fileDropZone, dropZone);
      fileDropZone.id = 'drop-zone';
      fileDropZone.className = 'drop-zone';
      fileDropZone.textContent = 'Drop markdown files here or click to browse';
    }
  }

  // Set up paste handler
  ExampleLoader.setupFilePasteHandler((graphData: GraphData) => {
    updateStatus('Files pasted successfully', 'success');
    renderGraph(graphData);
  });

  // Expose functions for testing
  (window as typeof window & { loadTestData?: () => void }).loadTestData = () => {
    const testData = loadTestData();
    renderGraph(testData);
    updateStatus('Test data loaded for automation', 'success');
  };

  (window as typeof window & { simulateFileLoad?: (files: File[]) => void }).simulateFileLoad = (files: File[]) => {
    // This function can be used by automation to simulate file loading
    updateStatus(`Simulating load of ${files.length} files...`, 'info');
    const testData = loadTestData();
    renderGraph(testData);
  };

  updateStatus('File picker interface ready. Try the buttons or drop files!', 'success');
}

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeFilePickers);
} else {
  initializeFilePickers();
}