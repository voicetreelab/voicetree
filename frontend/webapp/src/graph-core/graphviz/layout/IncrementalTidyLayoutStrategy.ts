/**
 * IncrementalTidyLayoutStrategy: Efficient partial relayout for online tree building
 *
 * Based on the Tidy Tree algorithm with support for incremental updates.
 * When a node changes (resize, add child, delete child), only the affected
 * portions of the tree are re-laid out.
 *
 * Key insight from the blog:
 * - Only ancestors' bounding boxes change when a node is modified
 * - Siblings need thread pointer updates but their internal layouts stay the same
 * - We only need to relayout the immediate parent's children
 *
 * Time complexity: O(d) where d is the depth of the changed node
 */

import type {
  PositioningStrategy,
  PositioningContext,
  PositioningResult,
  Position,
  NodeInfo
} from './types';

// Extended node with tidy layout data
interface TidyData {
  extremeLeft: LayoutNode | null;
  extremeRight: LayoutNode | null;
  shiftAcceleration: number;
  shiftChange: number;
  modifierToSubtree: number;
  modifierExtremeLeft: number;
  modifierExtremeRight: number;
  threadLeft: LayoutNode | null;
  threadRight: LayoutNode | null;
  modifierThreadLeft: number;
  modifierThreadRight: number;
}

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  relativeX: number;
  relativeY: number;
  width: number;
  height: number;
  depth: number;
  children: LayoutNode[];
  parent: LayoutNode | null;
  tidy: TidyData | null;
}

// Linked list for tracking y-coordinates
class LinkedYList {
  constructor(
    public index: number,
    public bottom: number,
    public next: LinkedYList | null = null
  ) {}

  update(minY: number, index: number): LinkedYList {
    let current: LinkedYList | null = this;
    while (current !== null && minY >= current.bottom) {
      current = current.next;
    }
    return new LinkedYList(index, minY, current);
  }
}

// Contour for tracking left/right edges
class Contour {
  current!: LayoutNode | null;
  modifierSum!: number;

  constructor(
    public isLeft: boolean,
    node: LayoutNode
  ) {
    this.current = node;
    this.modifierSum = node.tidy?.modifierToSubtree ?? 0;
  }

  isNone(): boolean {
    return this.current === null;
  }

  left(): number {
    if (!this.current) return 0;
    return this.modifierSum + this.current.relativeX - this.current.width / 2;
  }

  right(): number {
    if (!this.current) return 0;
    return this.modifierSum + this.current.relativeX + this.current.width / 2;
  }

  bottom(): number {
    if (!this.current) return 0;
    return this.current.y + this.current.height;
  }

  next(): void {
    if (!this.current || !this.current.tidy) return;

    if (this.isLeft) {
      if (this.current.children.length > 0) {
        this.current = this.current.children[0];
        this.modifierSum += this.current.tidy?.modifierToSubtree ?? 0;
      } else {
        this.modifierSum += this.current.tidy.modifierThreadLeft;
        this.current = this.current.tidy.threadLeft;
      }
    } else {
      if (this.current.children.length > 0) {
        this.current = this.current.children[this.current.children.length - 1];
        this.modifierSum += this.current.tidy?.modifierToSubtree ?? 0;
      } else {
        this.modifierSum += this.current.tidy.modifierThreadRight;
        this.current = this.current.tidy.threadRight;
      }
    }
  }
}

export class IncrementalTidyLayoutStrategy implements PositioningStrategy {
  name = 'incremental-tidy-layout';

  private readonly PARENT_CHILD_MARGIN = 100;   // Vertical spacing between parent and children
  private readonly PEER_MARGIN = 60;           // Horizontal spacing between siblings

  // Cache of layout nodes for incremental updates
  private layoutNodesCache = new Map<string, LayoutNode>();
  private rootsCache: LayoutNode[] = [];

  position(context: PositioningContext): PositioningResult {
    const positions = new Map<string, Position>();
    const allNodes = [...context.nodes, ...context.newNodes];

    if (allNodes.length === 0) {
      return { positions };
    }

    // Check if this is an incremental update (only new nodes)
    const isIncremental = context.newNodes.length > 0 && context.nodes.length > 0;

    if (isIncremental) {
      // Use partial relayout
      console.log(`[IncrementalTidy] Partial relayout for ${context.newNodes.length} new nodes`);
      return this.partialRelayout(context);
    } else {
      // Full layout
      console.log(`[IncrementalTidy] Full layout for ${allNodes.length} nodes`);
      return this.fullLayout(context);
    }
  }

  private fullLayout(context: PositioningContext): PositioningResult {
    const positions = new Map<string, Position>();
    const allNodes = [...context.nodes, ...context.newNodes];

    // Build tree structure
    this.layoutNodesCache = this.buildTree(allNodes);
    this.rootsCache = this.findRoots(this.layoutNodesCache, allNodes);

    if (this.rootsCache.length === 0) {
      console.warn('[IncrementalTidy] No roots found');
      return { positions };
    }

    // Layout each root tree
    let forestOffsetX = 0;
    const TREE_SPACING = 80;

    for (const root of this.rootsCache) {
      this.layout(root);

      const treeNodes = this.collectTreeNodes(root);
      if (treeNodes.length > 0) {
        const minX = Math.min(...treeNodes.map(n => n.x));
        const maxX = Math.max(...treeNodes.map(n => n.x));
        const maxWidth = Math.max(...treeNodes.map(n => n.width));
        const treeWidth = maxX - minX + maxWidth;

        const shiftAmount = forestOffsetX - minX;
        for (const node of treeNodes) {
          node.x += shiftAmount;
        }

        forestOffsetX += treeWidth + TREE_SPACING;
      }
    }

    // Convert to positions
    this.layoutNodesCache.forEach((layoutNode, id) => {
      positions.set(id, { x: layoutNode.x, y: layoutNode.y });
    });

    return { positions };
  }

  private partialRelayout(context: PositioningContext): PositioningResult {
    const positions = new Map<string, Position>();

    // Add new nodes to cache
    for (const nodeInfo of context.newNodes) {
      if (!this.layoutNodesCache.has(nodeInfo.id)) {
        const layoutNode: LayoutNode = {
          id: nodeInfo.id,
          x: 0,
          y: 0,
          relativeX: 0,
          relativeY: 0,
          width: nodeInfo.size.width,
          height: nodeInfo.size.height,
          depth: 0,
          children: [],
          parent: null,
          tidy: null
        };
        this.layoutNodesCache.set(nodeInfo.id, layoutNode);
      }
    }

    // Build parent-child relationships for new nodes
    for (const nodeInfo of context.newNodes) {
      const layoutNode = this.layoutNodesCache.get(nodeInfo.id)!;

      if (nodeInfo.parentId) {
        const parentLayoutNode = this.layoutNodesCache.get(nodeInfo.parentId);
        if (parentLayoutNode) {
          layoutNode.parent = parentLayoutNode;
          if (!parentLayoutNode.children.includes(layoutNode)) {
            parentLayoutNode.children.push(layoutNode);
          }
        }
      }
    }

    // Perform partial relayout for each changed node
    context.newNodes.forEach(nodeInfo => {
      const changedNode = this.layoutNodesCache.get(nodeInfo.id);
      if (changedNode) {
        this.relayout(changedNode);
      }
    });

    // Update absolute positions with second walk
    for (const root of this.rootsCache) {
      this.secondWalk(root, 0);
    }

    // Convert to positions
    this.layoutNodesCache.forEach((layoutNode, id) => {
      positions.set(id, { x: layoutNode.x, y: layoutNode.y });
    });

    return { positions };
  }

  /**
   * Partial relayout algorithm from the blog:
   * Walk up from changed node, invalidating sibling threads and relaying parent's children
   */
  private relayout(changedNode: LayoutNode): void {
    let node: LayoutNode | null = changedNode;

    while (node && node.parent) {
      // Invalidate thread pointers for all siblings
      for (const sibling of node.parent.children) {
        const rightBottom = this.getRightBottomNode(sibling);
        if (rightBottom.tidy) {
          rightBottom.tidy.threadRight = null;
          rightBottom.tidy.modifierThreadRight = 0;
        }

        const leftBottom = this.getLeftBottomNode(sibling);
        if (leftBottom.tidy) {
          leftBottom.tidy.threadLeft = null;
          leftBottom.tidy.modifierThreadLeft = 0;
        }
      }

      // Relayout this node's parent's children
      this.layoutSubtree(node.parent);

      // Move up to parent
      node = node.parent;
    }
  }

  /**
   * Layout a subtree (just this node's immediate children)
   */
  private layoutSubtree(node: LayoutNode): void {
    if (node.children.length === 0) {
      this.setExtreme(node);
      return;
    }

    // Initialize node
    this.initNode(node);
    for (const child of node.children) {
      this.initNode(child);
    }

    // Set Y positions for children
    this.setY(node);
    for (const child of node.children) {
      this.setY(child);
    }

    // Run first walk just on this node's children
    this.firstWalk(node);
  }

  private layout(root: LayoutNode): void {
    this.preOrderTraversal(root, (node) => this.initNode(node));
    this.setYRecursive(root);
    this.firstWalk(root);
    this.secondWalk(root, 0);
  }

  private buildTree(nodes: NodeInfo[]): Map<string, LayoutNode> {
    const layoutNodes = new Map<string, LayoutNode>();
    const nodeIds = new Set(nodes.map(n => n.id));

    for (const node of nodes) {
      layoutNodes.set(node.id, {
        id: node.id,
        x: 0,
        y: 0,
        relativeX: 0,
        relativeY: 0,
        width: node.size.width,
        height: node.size.height,
        depth: 0,
        children: [],
        parent: null,
        tidy: null
      });
    }

    for (const node of nodes) {
      const layoutNode = layoutNodes.get(node.id)!;

      if (node.parentId && nodeIds.has(node.parentId)) {
        const parentLayoutNode = layoutNodes.get(node.parentId);
        if (parentLayoutNode) {
          layoutNode.parent = parentLayoutNode;
          parentLayoutNode.children.push(layoutNode);
        }
      }
    }

    return layoutNodes;
  }

  private findRoots(layoutNodes: Map<string, LayoutNode>, nodes: NodeInfo[]): LayoutNode[] {
    const roots: LayoutNode[] = [];

    for (const node of nodes) {
      const layoutNode = layoutNodes.get(node.id);
      if (layoutNode && layoutNode.parent === null) {
        roots.push(layoutNode);
      }
    }

    if (roots.length === 0 && nodes.length > 0) {
      const firstNode = layoutNodes.get(nodes[0].id);
      if (firstNode) roots.push(firstNode);
    }

    return roots;
  }

  private initNode(node: LayoutNode): void {
    node.tidy = {
      extremeLeft: null,
      extremeRight: null,
      shiftAcceleration: 0,
      shiftChange: 0,
      modifierToSubtree: 0,
      modifierExtremeLeft: 0,
      modifierExtremeRight: 0,
      threadLeft: null,
      threadRight: null,
      modifierThreadLeft: 0,
      modifierThreadRight: 0
    };
    node.x = 0;
    node.y = 0;
    node.relativeX = 0;
    node.relativeY = 0;
  }

  private setYRecursive(root: LayoutNode): void {
    this.preOrderTraversal(root, (node) => this.setY(node));
  }

  private setY(node: LayoutNode): void {
    if (node.parent) {
      const parentBottom = node.parent.y + node.parent.height;
      node.y = parentBottom + this.PARENT_CHILD_MARGIN;
    } else {
      node.y = 0;
    }
  }

  private firstWalk(node: LayoutNode): void {
    if (node.children.length === 0) {
      this.setExtreme(node);
      return;
    }

    this.firstWalk(node.children[0]);
    const firstExtremeRight = this.getExtremeRight(node.children[0]);
    let yList: LinkedYList = new LinkedYList(
      0,
      firstExtremeRight.y + firstExtremeRight.height
    );

    for (let i = 1; i < node.children.length; i++) {
      const child = node.children[i];
      this.firstWalk(child);

      const childExtremeLeft = this.getExtremeLeft(child);
      const maxY = childExtremeLeft.y + childExtremeLeft.height;

      yList = this.separate(node, i, yList);
      yList = yList.update(maxY, i);
    }

    this.positionRoot(node);
    this.setExtreme(node);
  }

  private separate(node: LayoutNode, childIndex: number, yList: LinkedYList): LinkedYList {
    const leftContour = new Contour(false, node.children[childIndex - 1]);
    const rightContour = new Contour(true, node.children[childIndex]);

    let currentYList: LinkedYList | null = yList;

    while (!leftContour.isNone() && !rightContour.isNone()) {
      if (currentYList && leftContour.bottom() > currentYList.bottom) {
        currentYList = currentYList.next;
      }

      const dist = leftContour.right() - rightContour.left() + this.PEER_MARGIN;
      if (dist > 0) {
        rightContour.modifierSum += dist;
        this.moveSubtree(node, childIndex, currentYList?.index ?? 0, dist);
      }

      const leftBottom = leftContour.bottom();
      const rightBottom = rightContour.bottom();

      if (leftBottom <= rightBottom) {
        leftContour.next();
      }
      if (leftBottom >= rightBottom) {
        rightContour.next();
      }
    }

    if (leftContour.isNone() && !rightContour.isNone()) {
      this.setLeftThread(node, childIndex, rightContour.current!, rightContour.modifierSum);
    } else if (!leftContour.isNone() && rightContour.isNone()) {
      this.setRightThread(node, childIndex, leftContour.current!, leftContour.modifierSum);
    }

    return currentYList ?? yList;
  }

  private setLeftThread(node: LayoutNode, currentIndex: number, target: LayoutNode, modifier: number): void {
    const first = node.children[0];
    const current = node.children[currentIndex];

    const diff = modifier
      - first.tidy!.modifierExtremeLeft
      - first.tidy!.modifierToSubtree;

    const extremeLeft = this.getExtremeLeft(first);
    extremeLeft.tidy!.threadLeft = target;
    extremeLeft.tidy!.modifierThreadLeft = diff;

    first.tidy!.extremeLeft = current.tidy!.extremeLeft;
    first.tidy!.modifierExtremeLeft = current.tidy!.modifierExtremeLeft
      + current.tidy!.modifierToSubtree
      - first.tidy!.modifierToSubtree;
  }

  private setRightThread(node: LayoutNode, currentIndex: number, target: LayoutNode, modifier: number): void {
    const current = node.children[currentIndex];
    const prev = node.children[currentIndex - 1];

    const diff = modifier
      - current.tidy!.modifierExtremeRight
      - current.tidy!.modifierToSubtree;

    const extremeRight = this.getExtremeRight(current);
    extremeRight.tidy!.threadRight = target;
    extremeRight.tidy!.modifierThreadRight = diff;

    current.tidy!.extremeRight = prev.tidy!.extremeRight;
    current.tidy!.modifierExtremeRight = prev.tidy!.modifierExtremeRight
      + prev.tidy!.modifierToSubtree
      - current.tidy!.modifierToSubtree;
  }

  private moveSubtree(node: LayoutNode, currentIndex: number, fromIndex: number, distance: number): void {
    const child = node.children[currentIndex];
    child.tidy!.modifierToSubtree += distance;

    if (fromIndex !== currentIndex - 1) {
      const indexDiff = currentIndex - fromIndex;
      node.children[fromIndex + 1].tidy!.shiftAcceleration += distance / indexDiff;
      node.children[currentIndex].tidy!.shiftAcceleration -= distance / indexDiff;
      node.children[currentIndex].tidy!.shiftChange -= distance - distance / indexDiff;
    }
  }

  private positionRoot(node: LayoutNode): void {
    const first = node.children[0];
    const last = node.children[node.children.length - 1];

    const firstChildPos = first.relativeX + first.tidy!.modifierToSubtree;
    const lastChildPos = last.relativeX + last.tidy!.modifierToSubtree;

    node.relativeX = (firstChildPos + lastChildPos) / 2;
    node.tidy!.modifierToSubtree = -node.relativeX;
  }

  private setExtreme(node: LayoutNode): void {
    if (!node.tidy) return;

    if (node.children.length === 0) {
      node.tidy.extremeLeft = node;
      node.tidy.extremeRight = node;
      node.tidy.modifierExtremeLeft = 0;
      node.tidy.modifierExtremeRight = 0;
    } else {
      const first = node.children[0];
      const last = node.children[node.children.length - 1];

      node.tidy.extremeLeft = first.tidy!.extremeLeft;
      node.tidy.modifierExtremeLeft = first.tidy!.modifierToSubtree + first.tidy!.modifierExtremeLeft;

      node.tidy.extremeRight = last.tidy!.extremeRight;
      node.tidy.modifierExtremeRight = last.tidy!.modifierToSubtree + last.tidy!.modifierExtremeRight;
    }
  }

  private getExtremeLeft(node: LayoutNode): LayoutNode {
    return node.tidy?.extremeLeft ?? node;
  }

  private getExtremeRight(node: LayoutNode): LayoutNode {
    return node.tidy?.extremeRight ?? node;
  }

  private getRightBottomNode(node: LayoutNode): LayoutNode {
    let current = node;
    while (current.children.length > 0) {
      current = current.children[current.children.length - 1];
    }
    return current;
  }

  private getLeftBottomNode(node: LayoutNode): LayoutNode {
    let current = node;
    while (current.children.length > 0) {
      current = current.children[0];
    }
    return current;
  }

  private secondWalk(node: LayoutNode, modSum: number): void {
    modSum += node.tidy?.modifierToSubtree ?? 0;
    node.x = node.relativeX + modSum;

    this.addChildSpacing(node);

    for (const child of node.children) {
      this.secondWalk(child, modSum);
    }
  }

  private addChildSpacing(node: LayoutNode): void {
    let speed = 0;
    let delta = 0;

    for (const child of node.children) {
      if (!child.tidy) continue;

      speed += child.tidy.shiftAcceleration;
      delta += speed + child.tidy.shiftChange;
      child.tidy.modifierToSubtree += delta;
      child.relativeX += delta;

      child.tidy.shiftAcceleration = 0;
      child.tidy.shiftChange = 0;
    }
  }

  private preOrderTraversal(node: LayoutNode, fn: (node: LayoutNode) => void): void {
    fn(node);
    for (const child of node.children) {
      this.preOrderTraversal(child, fn);
    }
  }

  private collectTreeNodes(root: LayoutNode): LayoutNode[] {
    const nodes: LayoutNode[] = [];
    this.preOrderTraversal(root, (node) => nodes.push(node));
    return nodes;
  }
}
