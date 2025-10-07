import React from 'react';
import { createRoot } from 'react-dom/client';
import { CytoscapeCore } from '@/graph-core/graphviz/CytoscapeCore';
import { LayoutManager, IncrementalTidyLayoutStrategy } from '@/graph-core/graphviz/layout';

/**
 * Minimal test harness for incremental layout testing
 *
 * Initializes:
 * - Empty Cytoscape graph
 * - LayoutManager with IncrementalTidyLayoutStrategy
 *
 * Exposes to window:
 * - cy: Cytoscape core instance
 * - layoutManager: LayoutManager instance
 */

// Extend window type for test harness
interface TestWindow extends Window {
  cy: ReturnType<CytoscapeCore['getCore']>;
  layoutManager: LayoutManager;
  IncrementalTidyLayoutStrategy: typeof IncrementalTidyLayoutStrategy;
  LayoutManager: typeof LayoutManager;
}

declare const window: TestWindow;

export function GraphHarness() {
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!containerRef.current) return;

    console.log('[Incremental Layout Harness] Initializing...');

    // Initialize Cytoscape with empty graph
    const cytoscapeCore = new CytoscapeCore(containerRef.current, []);
    const cy = cytoscapeCore.getCore();

    // Apply basic styling
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
          'curve-style': 'bezier'
        }
      }
    ]);

    // Initialize LayoutManager with incremental strategy
    const strategy = new IncrementalTidyLayoutStrategy();
    const layoutManager = new LayoutManager(strategy);

    console.log('[Incremental Layout Harness] Using IncrementalTidyLayoutStrategy');

    // Expose to window for test access
    window.cy = cy;
    window.layoutManager = layoutManager;
    window.IncrementalTidyLayoutStrategy = IncrementalTidyLayoutStrategy;
    window.LayoutManager = LayoutManager;

    console.log('[Incremental Layout Harness] Ready! Available: window.cy, window.layoutManager, window.IncrementalTidyLayoutStrategy, window.LayoutManager');

    return () => {
      cy.destroy();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100vw',
        height: '100vh',
        background: '#f0f0f0'
      }}
    />
  );
}

// Mount the harness
const root = createRoot(document.getElementById('root')!);
root.render(<GraphHarness />);
