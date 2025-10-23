import cytoscape, { type Core, type NodeCollection, type EdgeCollection, type NodeSingular, type CytoscapeOptions } from 'cytoscape';
import { type NodeDefinition, type EdgeDefinition } from '@/graph-core/types';
import { CLASS_HOVER, CLASS_UNHOVER, CLASS_CONNECTED_HOVER, CLASS_PINNED, CLASS_EXPANDED, MIN_ZOOM, MAX_ZOOM, GHOST_ROOT_ID } from '@/graph-core/constants';
import { ContextMenuService, type ContextMenuConfig } from '@/graph-core/services/ContextMenuService';
import { StyleService } from '@/graph-core/services/StyleService';
import { BreathingAnimationService, AnimationType } from '@/graph-core/services/BreathingAnimationService';
import { ZoomCollapseService } from '@/graph-core/services/ZoomCollapseService';

export { AnimationType };

export class CytoscapeCore {
  private viz: Core;
  private container: HTMLElement;
  private contextMenuService: ContextMenuService | null = null;
  private styleService: StyleService;
  private animationService: BreathingAnimationService;
  private zoomCollapseService: ZoomCollapseService | null = null;

  constructor(container: HTMLElement, elements: (NodeDefinition | EdgeDefinition)[] = [], headless = false) {
    this.container = container;
    this.styleService = new StyleService();

    // Add ghost root node as the first element to ensure it exists before any edges reference it
    const ghostRootNode: NodeDefinition = {
      data: {
        id: GHOST_ROOT_ID,
        label: '',
        linkedNodeIds: [],
        isGhostRoot: true
      },
      position: { x: 0, y: 0 }
    };

    // Filter out any ghost edges from initial elements to prevent "nonexistent source" errors
    // Ghost edges should only be created by GraphMutator when adding orphan nodes
    const filteredElements = elements.filter(el => {
      // Keep all nodes and non-ghost edges
      if ('source' in el.data && 'target' in el.data) {
        // It's an edge - filter out ghost edges
        const edgeData = el.data as any;
        const isGhostEdge = edgeData.isGhostEdge || edgeData.id?.startsWith(`${GHOST_ROOT_ID}->`);
        if (isGhostEdge) {
          console.warn(`[CytoscapeCore] Filtering out ghost edge from initial elements: ${edgeData.id}`);
        }
        return !isGhostEdge;
      }
      return true; // Keep all nodes
    });

    // Initialize cytoscape with ghost root first, then filtered user elements
    const cytoscapeOptions: CytoscapeOptions = {
      elements: [ghostRootNode, ...filteredElements],
      style: this.styleService.getCombinedStylesheet(),
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      ...(headless ? { headless: true } : { container: container })
    };

    this.viz = cytoscape(cytoscapeOptions);

    // Initialize animation service with cy instance (sets up event listeners)
    this.animationService = new BreathingAnimationService(this.viz);

    // Update node degrees after initial elements are added
    this.updateNodeDegrees();

    this.setupEventListeners();
  }

  /**
   * Update the degree data attribute for all nodes based on their connections.
   * This is used by the StyleService to apply degree-based sizing and styling.
   */
  private updateNodeDegrees(): void {
    if (!this.viz) return;
    this.viz.nodes().forEach(node => {
      node.data('degree', node.degree());
    });
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

      // Stop breathing animation on hover for new nodes and appended content
      if (this.animationService.isAnimationActive(node)) {
        const animationType = node.data('animationType');
        if (animationType === 'new_node' || animationType === 'appended_content') {
          this.animationService.stopAnimationForNode(node);
        }
      }
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
    const addedNodes = this.viz.add(nodes).nodes();
    this.updateNodeDegrees();
    return addedNodes;
  }

  // Add edges to the graph
  addEdges(edges: EdgeDefinition[]): EdgeCollection {
    const addedEdges = this.viz.add(edges).edges();
    // Update degrees for all nodes since edges affect node degrees
    this.updateNodeDegrees();
    return addedEdges;
  }

  // Add elements (nodes and edges) to the graph
  addElements(elements: (NodeDefinition | EdgeDefinition)[]): void {
    this.viz.add(elements);
    this.updateNodeDegrees();
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

  updateTheme(): void {
    // Recreate the StyleService to pick up current theme
    this.styleService = new StyleService();
    // Update cytoscape with new styles
    this.viz.style(this.styleService.getCombinedStylesheet());
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

  // SPIKE: Enable zoom-based auto-collapse
  enableZoomCollapse(edgeLengthThreshold = 50): void {
    if (!this.zoomCollapseService) {
      this.zoomCollapseService = new ZoomCollapseService(this.viz, edgeLengthThreshold);
      this.zoomCollapseService.initialize();
    }
  }

  // SPIKE: Disable zoom-based auto-collapse
  disableZoomCollapse(): void {
    if (this.zoomCollapseService) {
      this.zoomCollapseService.destroy();
      this.zoomCollapseService = null;
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

  setAnimationTimeout(node: NodeSingular, timeout: number): void {
    this.animationService.setAnimationTimeout(node, timeout);
  }

  stopAllAnimations(): void {
    this.animationService.stopAllAnimations(this.viz.nodes());
  }

  // Proxy floating window extension method to underlying cytoscape instance
  addFloatingWindow(config: {
    id: string;
    component: string | React.ReactElement;
    position?: { x: number; y: number };
    nodeData?: Record<string, unknown>;
    resizable?: boolean;
    initialContent?: string;
    onSave?: (content: string) => Promise<void>;
  }): NodeSingular {
    console.log('[CytoscapeCore] addFloatingWindow called, checking viz...');
    const vizWithExtension = this.viz as Core & { addFloatingWindow?: (config: unknown) => NodeSingular };
    console.log('[CytoscapeCore] viz.addFloatingWindow type:', typeof vizWithExtension.addFloatingWindow);
    console.log('[CytoscapeCore] viz methods:', Object.keys(vizWithExtension).slice(0, 10));

    if (typeof vizWithExtension.addFloatingWindow === 'function') {
      console.log('[CytoscapeCore] Calling viz.addFloatingWindow');
      return vizWithExtension.addFloatingWindow(config);
    }
    console.error('[CytoscapeCore] Floating windows extension not found on viz instance');
    throw new Error('Floating windows extension not registered');
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
    if (this.zoomCollapseService) {
      this.zoomCollapseService.destroy();
      this.zoomCollapseService = null;
    }
    if (this.viz) {
      this.viz.destroy();
    }
  }
}