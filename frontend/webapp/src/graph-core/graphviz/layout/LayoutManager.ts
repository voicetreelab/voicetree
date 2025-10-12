import type { Core, NodeSingular, EdgeSingular } from 'cytoscape';
import type {
  PositioningStrategy,
  PositioningContext,
  NodeInfo,
  Position
} from './types';
import type { Node, MarkdownTree } from '@/graph-core/types';
import { SeedParkRelaxStrategy } from './SeedParkRelaxStrategy';

// Animation duration for layout transitions (0 in automated tests, 300ms otherwise)
const LAYOUT_ANIMATION_DURATION = (typeof navigator !== 'undefined' && navigator.webdriver) ? 0 : 300;

export class LayoutManager {
  private strategy: PositioningStrategy;

  constructor(strategy?: PositioningStrategy) {
    this.strategy = strategy || new SeedParkRelaxStrategy();
  }

  setStrategy(strategy: PositioningStrategy): void {
    this.strategy = strategy;
  }

  /**
   * Apply layout to new nodes in the graph
   */
  async applyLayout(cy: Core, newNodeIds: string[]): Promise<void> {
    const context = this.extractContext(cy, newNodeIds);
    const result = await this.strategy.position(context);
    this.applyPositions(cy, result.positions);
  }

  /**
   * Update dimensions of existing nodes and trigger partial relayout
   * Used when floating windows resize
   */
  async updateNodeDimensions(cy: Core, nodeIds: string[]): Promise<void> {
    // Check if strategy supports dimension updates
    const strategyWithDimensionUpdate = this.strategy as PositioningStrategy & {
      updateNodeDimensions?: (cy: Core, nodeIds: string[]) => Promise<Map<string, Position>>;
    };

    if (strategyWithDimensionUpdate.updateNodeDimensions) {
      const positions = await strategyWithDimensionUpdate.updateNodeDimensions(cy, nodeIds);
      this.applyPositions(cy, positions);
    } else {
      // Fallback to regular layout
      await this.applyLayout(cy, nodeIds);
    }
  }

  /**
   * Apply layout using canonical tree structure from MarkdownTree or Node map
   */
  async applyLayoutWithTree(
    cy: Core,
    tree: MarkdownTree | Map<string, Node>,
    newNodeIds: string[]
  ): Promise<void> {
    const nodeMap = tree instanceof Map ? tree : tree.tree;
    const context = this.extractContextWithTree(cy, nodeMap, newNodeIds);
    const result = await this.strategy.position(context);
    this.applyPositions(cy, result.positions);
  }

  /**
   * Position a single new node
   */
  async positionNode(cy: Core, nodeId: string, parentId?: string): Promise<void> {
    const node = cy.$id(nodeId);
    if (node.length === 0) return;

    // Build minimal context
    const context = this.extractContext(cy, [nodeId]);

    // If parent specified, ensure it's in linkedNodeIds
    if (parentId) {
      const newNode = context.newNodes[0];
      if (newNode && !newNode.linkedNodeIds.includes(parentId)) {
        newNode.linkedNodeIds.push(parentId);
      }
    }

    const result = await this.strategy.position(context);
    this.applyPositions(cy, result.positions);
  }

  /**
   * Position multiple nodes incrementally (for online addition)
   */
  async positionNodesIncremental(cy: Core, nodeIds: string[]): Promise<void> {
    // Position nodes one at a time, treating previously positioned ones as existing
    const positioned = new Set<string>();

    for (const nodeId of nodeIds) {
      const context = this.extractContext(cy, [nodeId], positioned);
      const result = await this.strategy.position(context);
      this.applyPositions(cy, result.positions);
      positioned.add(nodeId);
    }
  }

  private extractContext(
    cy: Core,
    newNodeIds: string[],
    treatAsExisting?: Set<string>
  ): PositioningContext {
    const allNodes = cy.nodes();
    const nodes: NodeInfo[] = [];
    const newNodes: NodeInfo[] = [];

    allNodes.forEach(node => {
      const parentId = node.data('parentId');
      const children = node.data('children');

      const nodeInfo: NodeInfo = {
        id: node.id(),
        position: node.position(),
        size: this.getNodeSize(node),
        parentId: parentId || undefined,
        children: children || undefined,
        linkedNodeIds: this.getLinkedNodeIds(cy, node)
      };

      const isNew = newNodeIds.includes(node.id()) &&
                    !(treatAsExisting && treatAsExisting.has(node.id()));

      if (isNew) {
        newNodes.push(nodeInfo);
      } else {
        nodes.push(nodeInfo);
      }
    });

    return {
      nodes,
      newNodes,
      bounds: {
        width: cy.width(),
        height: cy.height()
      }
    };
  }

  /**
   * Extract context using canonical tree structure from Node types
   */
  private extractContextWithTree(
    cy: Core,
    nodeMap: Map<string, Node>,
    newNodeIds: string[],
    treatAsExisting?: Set<string>
  ): PositioningContext {
    const allNodes = cy.nodes();
    const nodes: NodeInfo[] = [];
    const newNodes: NodeInfo[] = [];

    allNodes.forEach(node => {
      const nodeId = node.id();
      const canonicalNode = nodeMap.get(nodeId);

      const nodeInfo: NodeInfo = {
        id: nodeId,
        position: node.position(),
        size: this.getNodeSize(node),
        // Use canonical tree structure if available
        parentId: canonicalNode?.parentId,
        children: canonicalNode?.children || [],
        // Keep linkedNodeIds for backward compatibility
        linkedNodeIds: canonicalNode ? undefined : this.getLinkedNodeIds(cy, node)
      };

      const isNew = newNodeIds.includes(nodeId) &&
                    !(treatAsExisting && treatAsExisting.has(nodeId));

      if (isNew) {
        newNodes.push(nodeInfo);
      } else {
        nodes.push(nodeInfo);
      }
    });

    return {
      nodes,
      newNodes,
      bounds: {
        width: cy.width(),
        height: cy.height()
      }
    };
  }

  private getNodeSize(node: NodeSingular): { width: number; height: number } {
    const bb = node.boundingBox({ includeLabels: false });
    return {
      width: bb.w || 40,
      height: bb.h || 40
    };
  }

  private getLinkedNodeIds(_cy: Core, node: NodeSingular): string[] {
    // First check if node has linkedNodeIds data
    const dataLinks = node.data('linkedNodeIds');
    if (dataLinks && Array.isArray(dataLinks)) {
      return dataLinks;
    }

    // Fallback to actual edges
    const linkedIds: string[] = [];
    const edges = node.connectedEdges();

    edges.forEach((edge: EdgeSingular) => {
      const source = edge.source();
      const target = edge.target();

      if (source.id() === node.id()) {
        linkedIds.push(target.id());
      } else {
        linkedIds.push(source.id());
      }
    });

    return linkedIds;
  }

  private applyPositions(cy: Core, positions: Map<string, Position>): void {
    cy.startBatch();

    let appliedCount = 0;
    const samples: string[] = [];

    positions.forEach((pos, nodeId) => {
      const node = cy.$id(nodeId);
      if (node.length > 0) {
        if (LAYOUT_ANIMATION_DURATION === 0) {
          node.position(pos);
        } else {
          console.log(`[LayoutManager] Animating node ${nodeId} with duration ${LAYOUT_ANIMATION_DURATION}ms to (${pos.x}, ${pos.y})`);
          node.animate({
            position: pos,
            duration: LAYOUT_ANIMATION_DURATION,
            easing: 'ease-out'
          });
        }
        appliedCount++;

        // Sample first 5 for debugging
        if (samples.length < 5) {
          samples.push(`${nodeId}: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})`);
        }
      }
    });

    cy.endBatch();

    console.log(`[LayoutManager] Applied ${appliedCount} positions. Samples:`, samples);
  }

  /**
   * Helper to position nodes in BFS order from a root
   */
  async positionGraphBFS(cy: Core, rootId?: string): Promise<void> {
    const nodes = cy.nodes();
    if (nodes.length === 0) return;

    // Find root node
    const root = rootId ? cy.$id(rootId) : this.findBestRoot(cy);
    if (!root || root.length === 0) return;

    // Position root at center
    const cx = cy.width() / 2;
    const cy_height = cy.height() / 2;
    root.position({ x: cx, y: cy_height });

    // BFS traversal
    const positioned = new Set<string>([root.id()]);
    const queue = [root.id()];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const current = cy.$id(currentId);

      // Get connected nodes
      const connected = current.neighborhood('node');
      for (const neighbor of connected.toArray()) {
        const neighborId = neighbor.id();

        if (!positioned.has(neighborId)) {
          // Position this node relative to current
          await this.positionNode(cy, neighborId, currentId);
          positioned.add(neighborId);
          queue.push(neighborId);
        }
      }
    }

    // Position any orphaned nodes
    for (const node of nodes.toArray()) {
      if (!positioned.has(node.id())) {
        await this.positionNode(cy, node.id());
        positioned.add(node.id());
      }
    }
  }

  private findBestRoot(cy: Core): NodeSingular {
    // Find node with most connections
    let bestNode = null;
    let maxDegree = -1;

    cy.nodes().forEach(node => {
      const degree = node.degree();
      if (degree > maxDegree) {
        maxDegree = degree;
        bestNode = node;
      }
    });

    return bestNode;
  }
}