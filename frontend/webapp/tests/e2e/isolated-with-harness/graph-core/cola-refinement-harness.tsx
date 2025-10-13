import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import cytoscape, { type Core } from 'cytoscape';
import cola from 'cytoscape-cola';
import { applyColaRefinement, type NodeInfo } from '@/graph-core/graphviz/layout/ColaRefinement';
import { TidyLayoutStrategy, TreeOrientation } from '@/graph-core/graphviz/layout/TidyLayoutStrategy';

// Register Cola extension
cytoscape.use(cola);

// Extend window interface for test API
declare global {
  interface Window {
    cy?: Core;
    tidyLayout?: TidyLayoutStrategy;
    lastTidyPositions?: Map<string, { x: number; y: number }>;
    lastColaPositions?: Map<string, { x: number; y: number }>;
    testAPI?: {
      loadFixture: () => void;
      applyTidyLayout: () => Promise<void>;
      applyColaRefinement: () => Promise<void>;
      getCytoscape: () => Core | null;
      getNodes: () => NodeInfo[];
    };
  }
}

// Generate test tree
function generateTestTree(): NodeInfo[] {
  // Create a tree structure:
  //        root
  //       /  |  \
  //      A   B   C
  //     /|   |   |\
  //    D E   F   G H
  return [
    { id: 'root', size: { width: 200, height: 100 }, linkedNodeIds: [] },
    { id: 'A', size: { width: 180, height: 90 }, linkedNodeIds: ['root'] },
    { id: 'B', size: { width: 180, height: 90 }, linkedNodeIds: ['root'] },
    { id: 'C', size: { width: 180, height: 90 }, linkedNodeIds: ['root'] },
    { id: 'D', size: { width: 160, height: 80 }, linkedNodeIds: ['A'] },
    { id: 'E', size: { width: 160, height: 80 }, linkedNodeIds: ['A'] },
    { id: 'F', size: { width: 160, height: 80 }, linkedNodeIds: ['B'] },
    { id: 'G', size: { width: 160, height: 80 }, linkedNodeIds: ['C'] },
    { id: 'H', size: { width: 160, height: 80 }, linkedNodeIds: ['C'] },
  ];
}

export function ColaRefinementTestHarness() {
  const cyRef = useRef<Core | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<string>('Ready');
  const [statusType, setStatusType] = useState<'info' | 'success' | 'error'>('info');
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const tidyLayoutRef = useRef<TidyLayoutStrategy | null>(null);

  // Initialize Cytoscape
  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#4a90e2',
            'label': 'data(id)',
            'color': '#fff',
            'text-valign': 'center',
            'text-halign': 'center',
            'font-size': '12px',
            'width': 'data(width)',
            'height': 'data(height)',
          }
        },
        {
          selector: 'edge',
          style: {
            'width': 2,
            'line-color': '#666',
            'target-arrow-color': '#666',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier'
          }
        }
      ],
      layout: { name: 'preset' }
    });

    cyRef.current = cy;

    // Expose globally for test access
    window.cy = cy;

    return () => {
      cy.destroy();
    };
  }, []);

  const updateStatus = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setStatus(message);
    setStatusType(type);
    console.log(`[${type.toUpperCase()}] ${message}`);
  };

  const loadFixture = useCallback(() => {
    if (!cyRef.current) return;

    updateStatus('Loading fixture...', 'info');

    try {
      const testNodes = generateTestTree();
      setNodes(testNodes);

      // Add nodes to Cytoscape
      cyRef.current.batch(() => {
        testNodes.forEach(node => {
          cyRef.current!.add({
            data: {
              id: node.id,
              width: node.size.width,
              height: node.size.height,
              parentId: node.parentId,
              linkedNodeIds: node.linkedNodeIds || []
            },
            position: { x: 0, y: 0 }
          });
        });

        // Add edges from linkedNodeIds
        testNodes.forEach(node => {
          if (node.linkedNodeIds) {
            node.linkedNodeIds.forEach(linkedId => {
              cyRef.current!.add({
                data: {
                  id: `${node.id}-${linkedId}`,
                  source: linkedId,
                  target: node.id
                }
              });
            });
          }
        });
      });

      updateStatus(`Loaded ${testNodes.length} nodes`, 'success');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      updateStatus(`Error loading fixture: ${errorMessage}`, 'error');
      console.error(error);
    }
  }, []);

  const applyTidyLayout = useCallback(async () => {
    if (!cyRef.current || nodes.length === 0) {
      updateStatus('No nodes loaded', 'error');
      return;
    }

    updateStatus('Applying Tidy layout...', 'info');

    try {
      const tidyLayout = new TidyLayoutStrategy(TreeOrientation.TopDown);
      tidyLayoutRef.current = tidyLayout;

      const context = {
        nodes: [],
        newNodes: nodes,
        cy: cyRef.current
      };

      const result = await tidyLayout.position(context);

      // Apply positions to Cytoscape
      cyRef.current.batch(() => {
        for (const [nodeId, pos] of Array.from(result.positions.entries())) {
          const node = cyRef.current!.getElementById(nodeId);
          if (node.length > 0) {
            node.position({ x: pos.x, y: pos.y });
          }
        }
      });

      cyRef.current.fit(50);
      updateStatus(`Tidy layout applied to ${result.positions.size} nodes`, 'success');

      // Expose for testing
      window.tidyLayout = tidyLayout;
      window.lastTidyPositions = result.positions;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      updateStatus(`Error applying Tidy layout: ${errorMessage}`, 'error');
      console.error(error);
    }
  }, [nodes]);

  const applyColRefinement = useCallback(async () => {
    if (!cyRef.current || nodes.length === 0) {
      updateStatus('No nodes loaded', 'error');
      return;
    }

    updateStatus('Applying Cola refinement...', 'info');

    try {
      // Get current positions from Cytoscape
      const initialPositions = new Map<string, { x: number; y: number }>();
      cyRef.current.nodes().forEach(node => {
        const pos = node.position();
        initialPositions.set(node.id(), { x: pos.x, y: pos.y });
      });

      // Apply Cola refinement
      const refinedPositions = await applyColaRefinement(
        cyRef.current,
        initialPositions,
        nodes,
        {
          maxSimulationTime: 3000,
          avoidOverlap: true,
          nodeSpacing: 40,
          flow: { axis: 'y', minSeparation: 150 },
          parentChildEdgeLength: 250,
          defaultEdgeLength: 100
        }
      );

      // Positions are already applied by Cola to Cytoscape
      cyRef.current.fit(50);

      updateStatus(`Cola refinement applied to ${refinedPositions.size} nodes`, 'success');

      // Expose for testing
      window.lastColaPositions = refinedPositions;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      updateStatus(`Error applying Cola refinement: ${errorMessage}`, 'error');
      console.error(error);
    }
  }, [nodes]);

  const fitView = () => {
    if (!cyRef.current) return;
    cyRef.current.fit(50);
    updateStatus('View fitted', 'success');
  };

  // Expose API for tests
  useEffect(() => {
    window.testAPI = {
      loadFixture,
      applyTidyLayout,
      applyColaRefinement: applyColRefinement,
      getCytoscape: () => cyRef.current,
      getNodes: () => nodes
    };
  }, [nodes, loadFixture, applyTidyLayout, applyColRefinement]);

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px', background: '#2a2a2a', borderBottom: '1px solid #444' }}>
        <h2 style={{ margin: '0 0 12px 0' }}>Cola Refinement Test Harness</h2>
        <div style={{ marginBottom: '8px' }}>
          <button onClick={loadFixture} style={buttonStyle}>Load Fixture</button>
          <button onClick={applyTidyLayout} style={buttonStyle}>Apply Tidy Layout</button>
          <button onClick={applyColRefinement} style={buttonStyle}>Apply Cola Refinement</button>
          <button onClick={fitView} style={buttonStyle}>Fit View</button>
        </div>
        <div style={{
          color: statusType === 'success' ? '#4caf50' : statusType === 'error' ? '#f44336' : '#888',
          fontSize: '14px',
          marginTop: '8px'
        }}>
          {status}
        </div>
      </div>
      <div ref={containerRef} id="cy" style={{ flex: 1, position: 'relative', background: '#1a1a1a' }} />
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  padding: '8px 16px',
  margin: '4px',
  background: '#4caf50',
  color: 'white',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '14px',
};

// Mount the app
const root = createRoot(document.getElementById('root')!);
root.render(<ColaRefinementTestHarness />);
