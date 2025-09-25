import cytoscape, { type Core, type NodeCollection, type EdgeCollection } from 'cytoscape';
import { type NodeDefinition, type EdgeDefinition } from '../types';
import { CLASS_HOVER, CLASS_UNHOVER, CLASS_CONNECTED_HOVER } from '../constants';

export class CytoscapeCore {
  private viz: Core;
  private container: HTMLElement;

  constructor(container: HTMLElement, elements: any[] = []) {
    this.container = container;

    // Initialize cytoscape with minimal configuration
    this.viz = cytoscape({
      container: container,
      elements: elements,
      minZoom: 0.3,
      maxZoom: 10,
      wheelSensitivity: 1.0,
    });

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Basic hover effects
    this.viz.on('mouseover', 'node', (e) => {
      if (!e.target) return;

      const node = e.target;
      this.viz.elements()
        .difference(node.closedNeighborhood())
        .addClass(CLASS_UNHOVER);

      node.addClass(CLASS_HOVER)
        .connectedEdges()
        .addClass(CLASS_CONNECTED_HOVER)
        .connectedNodes()
        .addClass(CLASS_CONNECTED_HOVER);
    });

    this.viz.on('mouseout', (e) => {
      if (!e.target || e.target === this.viz) return;

      this.viz.elements().removeClass([
        CLASS_HOVER,
        CLASS_UNHOVER,
        CLASS_CONNECTED_HOVER
      ]);
    });

    // Focus handling
    this.viz.on('tap boxselect', () => {
      this.container.focus();
    });
  }

  // Add nodes to the graph
  addNodes(nodes: NodeDefinition[]): NodeCollection {
    return this.viz.add(nodes).nodes();
  }

  // Add edges to the graph
  addEdges(edges: EdgeDefinition[]): EdgeCollection {
    return this.viz.add(edges).edges();
  }

  // Add elements (nodes and edges) to the graph
  addElements(elements: (NodeDefinition | EdgeDefinition)[]): void {
    this.viz.add(elements);
  }

  // Get all nodes
  getNodes(): NodeCollection {
    return this.viz.nodes();
  }

  // Get all edges
  getEdges(): EdgeCollection {
    return this.viz.edges();
  }

  // Fit viewport to show all elements
  fitView(): void {
    this.viz.fit();
  }

  // Fit viewport to specific elements
  fitToElements(elements?: NodeCollection): void {
    if (elements && elements.length > 0) {
      this.viz.fit(elements);
    } else {
      this.fitView();
    }
  }

  // Center viewport
  center(): void {
    this.viz.center();
  }

  // Get the cytoscape core instance for advanced usage
  getCore(): Core {
    return this.viz;
  }

  // Destroy the graph
  destroy(): void {
    if (this.viz) {
      this.viz.destroy();
    }
  }
}