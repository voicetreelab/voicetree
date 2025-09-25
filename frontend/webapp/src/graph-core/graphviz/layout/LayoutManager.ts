import type { Core } from 'cytoscape';
import type {
  PositioningStrategy,
  PositioningContext,
  NodeInfo,
  Position
} from './types';
import { SeedParkRelaxStrategy } from './SeedParkRelaxStrategy';

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
  applyLayout(cy: Core, newNodeIds: string[]): void {
    const context = this.extractContext(cy, newNodeIds);
    const result = this.strategy.position(context);
    this.applyPositions(cy, result.positions);
  }

  /**
   * Position a single new node
   */
  positionNode(cy: Core, nodeId: string, parentId?: string): void {
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

    const result = this.strategy.position(context);
    this.applyPositions(cy, result.positions);
  }

  /**
   * Position multiple nodes incrementally (for online addition)
   */
  positionNodesIncremental(cy: Core, nodeIds: string[]): void {
    // Position nodes one at a time, treating previously positioned ones as existing
    const positioned = new Set<string>();

    for (const nodeId of nodeIds) {
      const context = this.extractContext(cy, [nodeId], positioned);
      const result = this.strategy.position(context);
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
      const nodeInfo: NodeInfo = {
        id: node.id(),
        position: node.position(),
        size: this.getNodeSize(node),
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

  private getNodeSize(node: any): { width: number; height: number } {
    const bb = node.boundingBox({ includeLabels: false });
    return {
      width: bb.w || 40,
      height: bb.h || 40
    };
  }

  private getLinkedNodeIds(cy: Core, node: any): string[] {
    // First check if node has linkedNodeIds data
    const dataLinks = node.data('linkedNodeIds');
    if (dataLinks && Array.isArray(dataLinks)) {
      return dataLinks;
    }

    // Fallback to actual edges
    const linkedIds: string[] = [];
    const edges = node.connectedEdges();

    edges.forEach((edge: any) => {
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

    positions.forEach((pos, nodeId) => {
      const node = cy.$id(nodeId);
      if (node.length > 0) {
        node.position(pos);
      }
    });

    cy.endBatch();
  }

  /**
   * Helper to position nodes in BFS order from a root
   */
  positionGraphBFS(cy: Core, rootId?: string): void {
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
      connected.forEach((neighbor: any) => {
        const neighborId = neighbor.id();

        if (!positioned.has(neighborId)) {
          // Position this node relative to current
          this.positionNode(cy, neighborId, currentId);
          positioned.add(neighborId);
          queue.push(neighborId);
        }
      });
    }

    // Position any orphaned nodes
    nodes.forEach(node => {
      if (!positioned.has(node.id())) {
        this.positionNode(cy, node.id());
        positioned.add(node.id());
      }
    });
  }

  private findBestRoot(cy: Core): any {
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