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
    if (minY < this.bottom) {
      return new LinkedYList(index, minY, this);
    }

    let node: LinkedYList | null = this.next;
    while (node !== null && minY >= node.bottom) {
      node = node.next;
    }
    return new LinkedYList(index, minY, node);
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

    // On first run (cache empty), delegate to full layout
    if (this.rootsCache.length === 0) {
      console.log('[IncrementalTidy] First run, performing full layout');
      return this.fullLayout(context);
    }

    const changedLayoutNodes: LayoutNode[] = [];

    for (const nodeInfo of context.newNodes) {
      let layoutNode = this.layoutNodesCache.get(nodeInfo.id);

      if (!layoutNode) {
        layoutNode = {
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

      layoutNode.width = nodeInfo.size.width;
      layoutNode.height = nodeInfo.size.height;

      if (!layoutNode.tidy) {
        this.initNode(layoutNode);
      }

      if (nodeInfo.parentId) {
        const parentLayoutNode = this.layoutNodesCache.get(nodeInfo.parentId);
        if (parentLayoutNode) {
          layoutNode.parent = parentLayoutNode;
          if (!parentLayoutNode.children.includes(layoutNode)) {
            parentLayoutNode.children.push(layoutNode);
          }
        } else {
          console.warn(`[IncrementalTidy] Parent ${nodeInfo.parentId} not found for ${nodeInfo.id}; treating as root`);
        }
      } else {
        console.warn(`[IncrementalTidy] No parentId for new node ${nodeInfo.id}; treating as root`);
      }

      changedLayoutNodes.push(layoutNode);
    }

    for (const node of changedLayoutNodes) {
      if (node.parent) {
        const parent = node.parent;
        const siblings = parent.children.filter(child => child !== node);
        console.log(`[IncrementalTidy] Placing ${node.id} under ${parent.id}. Sibling count: ${siblings.length}`);
        const parentRight = siblings.length > 0
          ? Math.max(...siblings.map(child => child.x + child.width / 2))
          : parent.x;

        const newCenter = Math.max(parentRight, parent.x) + this.PEER_MARGIN + node.width / 2;
        node.x = newCenter;
        node.relativeX = node.x - parent.x;
        node.y = parent.y + parent.height + this.PARENT_CHILD_MARGIN;
        node.relativeY = node.y - parent.y;

        positions.set(node.id, { x: node.x, y: node.y });
      } else {
        if (!this.rootsCache.includes(node)) {
          this.rootsCache.push(node);
        }
        const existingRoots = this.rootsCache.filter(root => root !== node);
        const rightMostRoot = existingRoots.length > 0
          ? Math.max(...existingRoots.map(root => root.x + root.width / 2))
          : 0;
        const newCenter = rightMostRoot + this.PEER_MARGIN + node.width / 2;
        node.x = newCenter;
        node.relativeX = node.x;
        node.y = 0;
        node.relativeY = 0;
        positions.set(node.id, { x: node.x, y: node.y });
      }
    }

    return { positions };
  }

  /**
   * Build set of all nodes that need relayout: changed nodes + all their ancestors
   */
  private buildAffectedSet(changedNodes: LayoutNode[]): Set<string> {
    const affected = new Set<string>();

    for (const node of changedNodes) {
      let current: LayoutNode | null = node;
      while (current) {
        affected.add(current.id);
        if (!current.tidy) {
          this.initNode(current);
        }
        this.invalidateExtremeThreads(current);
        current = current.parent;
      }
    }

    return affected;
  }

  /**
   * Filtered first walk: only process nodes in the affected set
   * Unchanged subtrees are treated as rigid black boxes
   */
  private firstWalkWithFilter(node: LayoutNode, affectedSet: Set<string>): void {
    // If this node isn't affected, skip it entirely
    if (!affectedSet.has(node.id)) {
      this.invalidateExtremeThreads(node);
      return;
    }

    if (node.children.length === 0) {
      this.setExtreme(node);
      return;
    }

    // Recursively process children (will skip unaffected ones)
    this.firstWalkWithFilter(node.children[0], affectedSet);

    const firstExtremeRight = this.getExtremeRight(node.children[0]);
    let yList: LinkedYList = new LinkedYList(
      0,
      firstExtremeRight.y + firstExtremeRight.height
    );

    for (let i = 1; i < node.children.length; i++) {
      const child = node.children[i];
      if (child.tidy) {
        child.tidy.modifierToSubtree = -child.relativeX;
      }
      this.firstWalkWithFilter(child, affectedSet);

      const childExtremeLeft = this.getExtremeLeft(child);
      const maxY = childExtremeLeft.y + childExtremeLeft.height;

      yList = this.separate(node, i, yList);
      yList = yList.update(maxY, i);
    }

    this.positionRoot(node);
    this.setExtreme(node);
  }

  /**
   * Filtered second walk: update positions starting from roots
   * Only traverse into affected subtrees
   */
  private secondWalkWithFilter(node: LayoutNode, modSum: number, affectedSet: Set<string>): void {
    modSum += node.tidy?.modifierToSubtree ?? 0;
    const newX = node.relativeX + modSum;
    const isAffected = affectedSet.has(node.id);

    if (!isAffected && Math.abs(newX - node.x) < 1e-6) {
      return;
    }

    node.x = newX;

    this.addChildSpacing(node);

    for (const child of node.children) {
      this.secondWalkWithFilter(child, modSum, affectedSet);
    }
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

  private invalidateExtremeThreads(node: LayoutNode): void {
    if (!node.tidy) return;
    this.setExtreme(node);

    const extremeLeft = this.getExtremeLeft(node);
    if (extremeLeft.tidy) {
      extremeLeft.tidy.threadLeft = null;
      extremeLeft.tidy.threadRight = null;
      extremeLeft.tidy.modifierThreadLeft = 0;
      extremeLeft.tidy.modifierThreadRight = 0;
    }

    const extremeRight = this.getExtremeRight(node);
    if (extremeRight.tidy) {
      extremeRight.tidy.threadLeft = null;
      extremeRight.tidy.threadRight = null;
      extremeRight.tidy.modifierThreadLeft = 0;
      extremeRight.tidy.modifierThreadRight = 0;
    }
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
      // NOTE: Do NOT add delta to relativeX - it's already in modifierToSubtree
      // child.relativeX += delta; // ❌ BUG - causes double-counting

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
