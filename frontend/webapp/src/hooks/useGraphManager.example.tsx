/**
 * Example usage of useGraphManager hook
 *
 * This file demonstrates how to integrate the useGraphManager hook
 * with a React component to create a file-watching graph interface.
 */

import React, { useState } from 'react';
import { useGraphManager } from './useGraphManager';
import type { FileObserverConfig } from '../lib/file-observer';

export function GraphManagerExample() {
  const { graphData, isLoading, error, start, stop, isWatching } = useGraphManager();
  const [directory, setDirectory] = useState('/Users/username/markdown-notes');

  const handleStart = async () => {
    try {
      const config: FileObserverConfig = {
        watchDirectory: directory,
        extensions: ['.md'],
        recursive: true,
        debounceMs: 100
      };

      await start(config);
      console.log('Started watching directory:', directory);
    } catch (err) {
      console.error('Failed to start file watching:', err);
    }
  };

  const handleStop = async () => {
    try {
      await stop();
      console.log('Stopped file watching');
    } catch (err) {
      console.error('Failed to stop file watching:', err);
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <h2>Graph Manager Example</h2>

      {/* Directory Input */}
      <div style={{ marginBottom: '10px' }}>
        <label>
          Directory to watch:
          <input
            type="text"
            value={directory}
            onChange={(e) => setDirectory(e.target.value)}
            style={{ marginLeft: '10px', width: '300px' }}
            disabled={isWatching}
          />
        </label>
      </div>

      {/* Control Buttons */}
      <div style={{ marginBottom: '20px' }}>
        <button
          onClick={handleStart}
          disabled={isWatching || isLoading}
          style={{ marginRight: '10px' }}
        >
          {isLoading ? 'Starting...' : 'Start Watching'}
        </button>
        <button
          onClick={handleStop}
          disabled={!isWatching}
        >
          Stop Watching
        </button>
      </div>

      {/* Status Display */}
      <div style={{ marginBottom: '20px' }}>
        <p><strong>Status:</strong> {isWatching ? 'Watching' : 'Stopped'}</p>
        <p><strong>Loading:</strong> {isLoading ? 'Yes' : 'No'}</p>
        {error && (
          <p style={{ color: 'red' }}>
            <strong>Error:</strong> {error.message}
          </p>
        )}
      </div>

      {/* Graph Data Summary */}
      <div style={{ marginBottom: '20px' }}>
        <h3>Graph Data Summary</h3>
        <p><strong>Nodes:</strong> {graphData.nodes.length}</p>
        <p><strong>Edges:</strong> {graphData.edges.length}</p>
      </div>

      {/* Node List */}
      {graphData.nodes.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <h4>Nodes:</h4>
          <ul>
            {graphData.nodes.slice(0, 10).map((node) => (
              <li key={node.data.id}>
                <strong>{node.data.label}</strong>
                {node.data.linkedNodeIds.length > 0 && (
                  <span> → {node.data.linkedNodeIds.length} links</span>
                )}
              </li>
            ))}
            {graphData.nodes.length > 10 && (
              <li>... and {graphData.nodes.length - 10} more nodes</li>
            )}
          </ul>
        </div>
      )}

      {/* Edge List */}
      {graphData.edges.length > 0 && (
        <div>
          <h4>Edges:</h4>
          <ul>
            {graphData.edges.slice(0, 10).map((edge) => (
              <li key={edge.data.id}>
                {edge.data.source} → {edge.data.target}
              </li>
            ))}
            {graphData.edges.length > 10 && (
              <li>... and {graphData.edges.length - 10} more edges</li>
            )}
          </ul>
        </div>
      )}

      {/* Integration Example */}
      <div style={{ marginTop: '30px', padding: '15px', backgroundColor: '#f5f5f5' }}>
        <h4>Integration with Graph Visualization:</h4>
        <pre style={{ fontSize: '12px', overflow: 'auto' }}>
{`// Example of using graphData with Cytoscape
import cytoscape from 'cytoscape';

useEffect(() => {
  if (graphData.nodes.length > 0) {
    const cy = cytoscape({
      container: document.getElementById('cy'),
      elements: graphData,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#666',
            'label': 'data(label)'
          }
        },
        {
          selector: 'edge',
          style: {
            'width': 3,
            'line-color': '#ccc',
            'target-arrow-color': '#ccc',
            'target-arrow-shape': 'triangle'
          }
        }
      ],
      layout: {
        name: 'grid',
        rows: 1
      }
    });
  }
}, [graphData]);`}
        </pre>
      </div>
    </div>
  );
}

/**
 * Hook Integration Pattern
 *
 * Here's a pattern for integrating useGraphManager with existing graph components:
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useGraphManagerIntegration() {
  const graphManager = useGraphManager();

  // Auto-start watching when component mounts (optional)
  React.useEffect(() => {
    const startWatching = async () => {
      try {
        await graphManager.start({
          watchDirectory: process.env.MARKDOWN_DIRECTORY || '/default/path',
          extensions: ['.md'],
          recursive: true,
          debounceMs: 100
        });
      } catch (error) {
        console.error('Auto-start failed:', error);
      }
    };

    startWatching();

    // Cleanup on unmount
    return () => {
      if (graphManager.isWatching) {
        graphManager.stop().catch(console.error);
      }
    };
  }, [graphManager]);

  return graphManager;
}