import type { Page } from '@playwright/test';
import type { EdgeSingular, NodeSingular } from 'cytoscape';
import type {
  BulkLoadState,
  ComplexLinksGraphState,
  EdgeLabelCheck,
  EdgeVisibility,
  ExtendedWindow,
  GraphState,
  IncrementalLayoutState,
  NodeSizeData,
  StopFileWatchingResult
} from './types';

export * from './ui-helpers';

export const isAppReady = (appWindow: Page): Promise<boolean> =>
  appWindow.evaluate(() => {
    return !!(window as ExtendedWindow).cytoscapeInstance &&
           !!(window as ExtendedWindow).hostAPI;
  });

export const getNodeCount = (appWindow: Page): Promise<number> =>
  appWindow.evaluate(() => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (!cy) return 0;
    return cy.nodes().length;
  });

export const getGraphState = (appWindow: Page): Promise<GraphState> =>
  appWindow.evaluate(() => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not initialized');

    return {
      nodeCount: cy.nodes().length,
      edgeCount: cy.edges().length,
      nodeLabels: cy.nodes().map((n: NodeSingular) => n.data('label')).sort(),
      edges: cy.edges().map((e: EdgeSingular) => ({
        source: e.source().data('label'),
        target: e.target().data('label')
      }))
    };
  });

export const getGraphStateFromAvailableCytoscape = (appWindow: Page): Promise<GraphState> =>
  appWindow.evaluate(() => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not available');

    return {
      nodeCount: cy.nodes().length,
      edgeCount: cy.edges().length,
      nodeLabels: cy.nodes().map((n: NodeSingular) => n.data('label')).sort(),
      edges: cy.edges().map((e: EdgeSingular) => ({
        source: e.source().data('label'),
        target: e.target().data('label')
      }))
    };
  });

export const getEdgeVisibility = (appWindow: Page): Promise<EdgeVisibility> =>
  appWindow.evaluate(() => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not initialized');

    // Filter out ghost outgoingEdges (invisible outgoingEdges to GHOST_ROOT_ID)
    const visibleEdges = cy.edges('[!isGhostEdge]');
    if (visibleEdges.length === 0) return { visible: false, reason: 'no visible outgoingEdges' };

    // Sample first visible edge to check visibility styles
    const edge = visibleEdges.first();
    const opacity = parseFloat(edge.style('opacity'));
    const width = parseFloat(edge.style('width'));
    const color = edge.style('line-color');

    return {
      visible: opacity > 0 && width > 0 && color !== 'transparent',
      opacity,
      width,
      color,
      edgeCount: visibleEdges.length
    };
  });

export const getEdgeLabelCheck = (appWindow: Page): Promise<EdgeLabelCheck> =>
  appWindow.evaluate(() => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not initialized');

    const edges = cy.edges();
    if (edges.length === 0) return { hasLabels: false, reason: 'no outgoingEdges' };

    // Sample all outgoingEdges to check if ANY have labels
    const edgesWithLabels = edges.filter(e => {
      const label = e.data('label');
      return label && label.length > 0;
    });

    // Get style for edge labels
    const firstEdge = edges.first();
    const labelText = firstEdge.style('label');
    const fontSize = firstEdge.style('font-size');

    return {
      totalEdges: edges.length,
      edgesWithDataLabels: edgesWithLabels.length,
      sampleLabel: edges.first().data('label'),
      styleLabelValue: labelText,
      fontSize: fontSize
    };
  });

export const hasNodeLabel = (appWindow: Page, label: string): Promise<boolean> =>
  appWindow.evaluate((nodeLabel) => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (!cy) return false;

    const labels = cy.nodes().map((n: NodeSingular) => n.data('label'));
    return labels.includes(nodeLabel);
  }, label);

export const lacksNodeLabel = (appWindow: Page, label: string): Promise<boolean> =>
  appWindow.evaluate((nodeLabel) => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (!cy) return true; // Still processing

    const labels = cy.nodes().map((n: NodeSingular) => n.data('label'));
    return !labels.includes(nodeLabel);
  }, label);

export const stopFileWatching = (appWindow: Page): Promise<StopFileWatchingResult> =>
  appWindow.evaluate(async () => {
    const api = (window as ExtendedWindow).hostAPI;
    if (!api) throw new Error('hostAPI not available');

    return await api.main.stopFileWatching();
  });

export const getComplexLinksGraphState = (appWindow: Page): Promise<ComplexLinksGraphState | null> =>
  appWindow.evaluate(() => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not available');

    const complexNode = cy.nodes().filter((n: NodeSingular) =>
      n.data('label') === 'Complex Links Test' // Label from heading
    );

    if (complexNode.length === 0) return null;

    const connectedEdges = cy.edges().filter((e: EdgeSingular) =>
      e.source().id() === complexNode[0].id() ||
      e.target().id() === complexNode[0].id()
    );

    return {
      nodeExists: true,
      connectedEdgeCount: connectedEdges.length,
      connections: connectedEdges.map((e: EdgeSingular) => ({
        source: e.source().data('label'),
        target: e.target().data('label')
      }))
    };
  });

export const getBulkLoadState = (appWindow: Page): Promise<BulkLoadState> =>
  appWindow.evaluate(() => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not initialized');

    const nodes = cy.nodes();
    const positions = nodes.map(n => ({
      id: n.id(),
      x: n.position().x,
      y: n.position().y
    }));

    // Check Y-coordinate distribution
    const yCoords = positions.map(p => p.y);
    const uniqueY = new Set(yCoords);
    const allAtZero = yCoords.every(y => y === 0);

    return {
      nodeCount: nodes.length,
      yCoords,
      uniqueYCount: uniqueY.size,
      allAtZero,
      samplePositions: positions.slice(0, 5)
    };
  });

export const hasIncrementalNode = (appWindow: Page, index: number): Promise<boolean> =>
  appWindow.evaluate((nodeIndex) => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (!cy) return false;
    const labels = cy.nodes().map((n: NodeSingular) => n.data('label'));
    const expectedLabel = `Incremental Test ${nodeIndex + 1}`; // From heading
    return labels.includes(expectedLabel);
  }, index);

export const getIncrementalLayoutState = (appWindow: Page): Promise<IncrementalLayoutState> =>
  appWindow.evaluate(() => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not initialized');

    const nodes = cy.nodes();
    const positions = nodes.map(n => ({
      id: n.id(),
      x: n.position().x,
      y: n.position().y
    }));

    // Get the 3 new nodes specifically (by label, which comes from heading)
    const newNodeLabels = [
      'Incremental Test 1',
      'Incremental Test 2',
      'Incremental Test 3'
    ];

    const newNodes = cy.nodes().filter((n: NodeSingular) =>
      newNodeLabels.includes(n.data('label'))
    );

    const newNodePositions = newNodes.map((n: NodeSingular) => ({
      id: n.id(),
      x: n.position().x,
      y: n.position().y
    }));

    // Check Y-coordinates for new nodes
    const newYCoords = newNodePositions.map(p => p.y);
    const allNewAtZero = newYCoords.every(y => y === 0);

    // Check all Y-coordinates (old + new)
    const allYCoords = positions.map(p => p.y);
    const uniqueYAll = new Set(allYCoords);

    // Check for overlaps
    let overlapCount = 0;
    const MINIMUM_DISTANCE = 30;

    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dist = Math.hypot(
          positions[i].x - positions[j].x,
          positions[i].y - positions[j].y
        );
        if (dist < MINIMUM_DISTANCE) {
          overlapCount++;
        }
      }
    }

    return {
      totalNodes: nodes.length,
      newNodePositions,
      allNewAtZero,
      uniqueYLevels: uniqueYAll.size,
      overlapCount
    };
  });

export const getNodeSizeData = (appWindow: Page): Promise<NodeSizeData> =>
  appWindow.evaluate(() => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not initialized');

    // Filter out nodes with special classes that override border-width styling
    // These classes (hover, pinned, editor-shadow, terminal-shadow) set fixed border-width values
    // that don't scale with degree, so they would skew our test results
    const normalNodes = cy.nodes().filter((n: NodeSingular) => {
      return n.id().includes(".");
    });

    const nodeData = normalNodes.map((n: NodeSingular) => {
      // Check if degree is already set, otherwise calculate it
      let degree = n.data('degree');
      if (degree === undefined || degree === null) {
        degree = n.degree(); // Calculate from actual connections
        n.data('degree', degree); // Set it for styling
      }

      return {
        id: n.id(),
        label: n.data('label'),
        degree: degree,
        width: n.width(),
        height: n.height(),
        borderWidth: parseFloat(n.style('border-width'))
      };
    });

    // Sort by degree to get high and low degree nodes
    nodeData.sort((a, b) => a.degree - b.degree);

    return {
      all: nodeData,
      lowest: nodeData[0],
      highest: nodeData[nodeData.length - 1]
    };
  });
