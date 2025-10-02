/**
 * ReingoldTilfordStrategy: Hierarchical tree layout algorithm
 *
 * This strategy implements a variant of the Reingold-Tilford algorithm for laying out
 * tree structures in a hierarchical manner. It positions nodes in a top-down tree layout
 * with proper spacing and aesthetic centering.
 *
 * Key features:
 * - Parents positioned above children (increasing y-coordinate for depth)
 * - Siblings spaced horizontally at the same y-level
 * - Parents centered over their children
 * - Handles forests (multiple disconnected trees)
 * - Consistent level spacing (vertical) and sibling spacing (horizontal)
 *
 * Algorithm overview:
 * 1. Build tree structure from node links
 * 2. Assign depth levels (BFS from roots)
 * 3. Position nodes recursively (post-order):
 *    - Children positioned first (left to right)
 *    - Parent positioned at center of children
 * 4. Handle multiple trees by spacing them horizontally
 */
import type {
  PositioningStrategy,
  PositioningContext,
  PositioningResult,
  Position,
  NodeInfo
} from '@/graph-core/graphviz/layout/types';

interface TreeNode {
  id: string;
  children: string[];
  parents: string[];
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export class ReingoldTilfordStrategy implements PositioningStrategy {
  name = 'reingold-tilford';

  private readonly LEVEL_HEIGHT = 150;  // Vertical spacing between levels
  private readonly MIN_SIBLING_SPACING = 100;  // Minimum horizontal spacing between siblings
  private readonly TREE_SPACING = 400;  // Spacing between separate trees in forest (generous for wide nodes)
  private readonly NODE_PADDING = 50;  // Extra padding around each node

  position(context: PositioningContext): PositioningResult {
    const positions = new Map<string, Position>();

    if (context.newNodes.length === 0) {
      return { positions };
    }

    // Build tree structure
    const treeNodes = this.buildTree(context.newNodes);

    // Find root nodes (nodes that no other node points to as a child)
    const nodeIds = new Set(context.newNodes.map(n => n.id));
    const childrenSet = new Set<string>();

    // Collect all nodes that are children (appear in some node's linkedNodeIds)
    context.newNodes.forEach(n => {
      n.linkedNodeIds.forEach(childId => {
        if (nodeIds.has(childId)) {
          childrenSet.add(childId);
        }
      });
    });

    // Roots are nodes that are NOT children of any other node
    const roots = context.newNodes.filter(n => !childrenSet.has(n.id));

    if (roots.length === 0) {
      // All nodes have parents - pick one arbitrarily as root
      roots.push(context.newNodes[0]);
    }

    // Assign depths via BFS
    this.assignDepths(treeNodes, roots.map(r => r.id));

    // Position each tree
    let forestOffset = 0;
    const treeSets = this.partitionIntoTrees(treeNodes, roots.map(r => r.id));

    for (const treeRootIds of treeSets) {
      // Position this tree starting at forestOffset
      const treeWidth = this.positionTree(treeNodes, treeRootIds, forestOffset);
      forestOffset += treeWidth + this.TREE_SPACING;
    }

    // Convert tree positions to result map
    for (const [id, treeNode] of treeNodes) {
      positions.set(id, { x: treeNode.x, y: treeNode.y });
    }

    return { positions };
  }

  private buildTree(nodes: NodeInfo[]): Map<string, TreeNode> {
    const treeNodes = new Map<string, TreeNode>();
    const nodeIds = new Set(nodes.map(n => n.id));

    // Initialize tree nodes
    for (const node of nodes) {
      treeNodes.set(node.id, {
        id: node.id,
        children: [],
        parents: [],
        depth: 0,
        x: 0,
        y: 0,
        width: node.size.width,
        height: node.size.height
      });
    }

    // Build parent-child relationships
    // linkedNodeIds contains the children (targets of outgoing edges)
    for (const node of nodes) {
      const treeNode = treeNodes.get(node.id)!;

      for (const childId of node.linkedNodeIds) {
        // Skip self-references to prevent infinite recursion
        if (childId === node.id) continue;

        if (!nodeIds.has(childId)) continue;

        const childTreeNode = treeNodes.get(childId);
        if (!childTreeNode) continue;

        // node.id is parent of childId (linkedNodeIds contains children/targets)
        treeNode.children.push(childId);
        childTreeNode.parents.push(node.id);
      }
    }

    return treeNodes;
  }

  private assignDepths(treeNodes: Map<string, TreeNode>, rootIds: string[]): void {
    const visited = new Set<string>();
    const queue: string[] = [...rootIds];

    // Set root depths to 0
    for (const rootId of rootIds) {
      const node = treeNodes.get(rootId);
      if (node) {
        node.depth = 0;
        visited.add(rootId);
      }
    }

    // BFS to assign depths
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      const node = treeNodes.get(nodeId);
      if (!node) continue;

      for (const childId of node.children) {
        if (visited.has(childId)) continue;

        const child = treeNodes.get(childId);
        if (!child) continue;

        child.depth = node.depth + 1;
        visited.add(childId);
        queue.push(childId);
      }
    }
  }

  private partitionIntoTrees(treeNodes: Map<string, TreeNode>, rootIds: string[]): string[][] {
    // For simplicity, treat each root as a separate tree
    // A more sophisticated approach would merge roots that share descendants
    return rootIds.map(rootId => [rootId]);
  }

  private positionTree(treeNodes: Map<string, TreeNode>, rootIds: string[], offsetX: number): number {
    let maxWidth = 0;

    for (const rootId of rootIds) {
      const width = this.positionSubtree(treeNodes, rootId, offsetX);
      maxWidth = Math.max(maxWidth, width);
    }

    return maxWidth;
  }

  private positionSubtree(treeNodes: Map<string, TreeNode>, nodeId: string, offsetX: number): number {
    const node = treeNodes.get(nodeId);
    if (!node) return 0;

    // Base case: leaf node
    if (node.children.length === 0) {
      node.x = offsetX;
      node.y = node.depth * this.LEVEL_HEIGHT;
      // Return width including node size and padding
      return node.width + this.NODE_PADDING;
    }

    // Recursive case: position children first
    let childOffsetX = offsetX;
    const childPositions: number[] = [];

    for (const childId of node.children) {
      const childWidth = this.positionSubtree(treeNodes, childId, childOffsetX);
      const child = treeNodes.get(childId);
      if (child) {
        childPositions.push(child.x);
      }
      childOffsetX += childWidth + this.MIN_SIBLING_SPACING;
    }

    // Position parent at center of children
    if (childPositions.length > 0) {
      const minChildX = Math.min(...childPositions);
      const maxChildX = Math.max(...childPositions);
      node.x = (minChildX + maxChildX) / 2;
    } else {
      node.x = offsetX;
    }

    node.y = node.depth * this.LEVEL_HEIGHT;

    // Return total width used by this subtree (including last child's width)
    const lastChild = node.children.length > 0 ? treeNodes.get(node.children[node.children.length - 1]) : null;
    const lastChildWidth = lastChild ? lastChild.width : 0;
    return (childOffsetX - offsetX - this.MIN_SIBLING_SPACING) + lastChildWidth + this.NODE_PADDING;
  }
}
