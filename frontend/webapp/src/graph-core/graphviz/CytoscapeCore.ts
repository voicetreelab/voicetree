import cytoscape, { type Core, type NodeCollection, type EdgeCollection, type NodeSingular } from 'cytoscape';
import { type NodeDefinition, type EdgeDefinition } from '@/graph-core/types';
import { CLASS_HOVER, CLASS_UNHOVER, CLASS_CONNECTED_HOVER, CLASS_PINNED, CLASS_EXPANDED } from '@/graph-core/constants';
import { ContextMenuService, type ContextMenuConfig } from '@/graph-core/services/ContextMenuService';
import { StyleService } from '@/graph-core/services/StyleService';
import { BreathingAnimationService, AnimationType } from '@/graph-core/services/BreathingAnimationService';

export { AnimationType };

export class CytoscapeCore {
  private viz: Core;
  private container: HTMLElement;
  private contextMenuService: ContextMenuService | null = null;
  private styleService: StyleService;
  private animationService: BreathingAnimationService;

  constructor(container: HTMLElement, elements: (NodeDefinition | EdgeDefinition)[] = []) {
    this.container = container;
    this.styleService = new StyleService();
    this.animationService = new BreathingAnimationService();

    // Initialize cytoscape with styling
    this.viz = cytoscape({
      container: container,
      elements: elements,
      style: this.styleService.getCombinedStylesheet(),
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

  // Enable context menu with configuration
  enableContextMenu(config: ContextMenuConfig): void {
    if (!this.contextMenuService) {
      this.contextMenuService = new ContextMenuService(config);
      this.contextMenuService.initialize(this.viz);
    } else {
      this.contextMenuService.updateConfig(config);
    }
  }

  // Disable context menu
  disableContextMenu(): void {
    if (this.contextMenuService) {
      this.contextMenuService.destroy();
      this.contextMenuService = null;
    }
  }

  // Pin a node to its current position
  pinNode(node: NodeSingular): void {
    node.addClass(CLASS_PINNED);
    node.lock();
    this.animationService.addBreathingAnimation(node, AnimationType.PINNED);
  }

  // Unpin a node
  unpinNode(node: NodeSingular): void {
    node.removeClass(CLASS_PINNED);
    node.unlock();
    this.animationService.stopAnimationForNode(node);
  }

  // Mark node as expanded
  expandNode(node: NodeSingular): void {
    node.addClass(CLASS_EXPANDED);
  }

  // Mark node as collapsed
  collapseNode(node: NodeSingular): void {
    node.removeClass(CLASS_EXPANDED);
  }

  // Remove/hide a node from the graph
  hideNode(node: NodeSingular): void {
    node.remove();
  }

  // Animation methods
  animateNewNode(node: NodeSingular): void {
    this.animationService.addBreathingAnimation(node, AnimationType.NEW_NODE);
  }

  animatePinnedNode(node: NodeSingular): void {
    this.animationService.addBreathingAnimation(node, AnimationType.PINNED);
  }

  animateAppendedContent(node: NodeSingular): void {
    this.animationService.addBreathingAnimation(node, AnimationType.APPENDED_CONTENT);
  }

  stopNodeAnimation(node: NodeSingular): void {
    this.animationService.stopAnimationForNode(node);
  }

  stopAllAnimations(): void {
    this.animationService.stopAllAnimations(this.viz.nodes());
  }

  // Destroy the graph
  destroy(): void {
    if (this.animationService) {
      this.animationService.destroy();
    }
    if (this.contextMenuService) {
      this.contextMenuService.destroy();
      this.contextMenuService = null;
    }
    if (this.viz) {
      this.viz.destroy();
    }
  }
}