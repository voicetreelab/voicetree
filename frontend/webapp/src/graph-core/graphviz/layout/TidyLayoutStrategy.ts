/**
 * TidyLayoutStrategy: High-performance tidy tree layout algorithm
 *
 * Based on the O(n) algorithm by van der Ploeg (2014) for drawing non-layered tidy trees.
 * Reference: https://www.zxch3n.com/tidy/tidy/
 *
 * This implementation follows the aesthetic rules for tidy tree visualization:
 * 1. No overlapped nodes
 * 2. No crossed lines
 * 3. A node's children should stay on the same line
 * 4. Parents should be centered over their children
 * 5. A subtree should be drawn the same way regardless of where it occurs
 * 6. Nodes are ordered correctly
 * 7. Symmetric drawings produce mirror images
 */

import type {
  PositioningStrategy,
  PositioningContext,
  PositioningResult,
  Position,
  NodeInfo
} from '@/graph-core/graphviz/layout/types';

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

// Linked list for tracking y-coordinates and subtree indices
class LinkedYList {
  constructor(
    public index: number,
    public bottom: number,
    public next: LinkedYList | null = null
  ) {}

  update(minY: number, index: number): LinkedYList {
    // Walk the list to find where this new entry should be inserted
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let current: LinkedYList | null = this;
    while (current !== null && minY >= current.bottom) {
      current = current.next;
    }
    return new LinkedYList(index, minY, current);
  }

  pop(): LinkedYList | null {
    return this.next;
  }
}

// Contour for tracking left/right edges of subtrees
class Contour {
  current: LayoutNode | null;
  modifierSum: number;

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

export class TidyLayoutStrategy implements PositioningStrategy {
  name = 'tidy-layout';

  private readonly PARENT_CHILD_MARGIN = 150;  // Vertical spacing between parent and children
  private readonly PEER_MARGIN = 100;          // Horizontal spacing between siblings
  private readonly isLayered = false;          // Non-layered layout

  position(context: PositioningContext): PositioningResult {
    const positions = new Map<string, Position>();

    if (context.newNodes.length === 0) {
      return { positions };
    }

    console.log(`[TidyLayout] Positioning ${context.newNodes.length} nodes`);

    // Build tree structure from node links
    const layoutNodes = this.buildTree(context.newNodes);

    // Debug: Analyze tree structure
    this.debugTreeStructure(layoutNodes);

    // Find root nodes (nodes with no parents)
    const roots = this.findRoots(layoutNodes, context.newNodes);

    if (roots.length === 0) {
      console.warn('[TidyLayout] No roots found');
      return { positions };
    }

    console.log(`[TidyLayout] Found ${roots.length} root nodes:`, roots.map(r => r.id));

    // Layout each root tree with horizontal spacing between them
    let forestOffsetX = 0;
    const TREE_SPACING = 400; // Spacing between separate trees in forest

    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      this.layout(root);

      // Calculate tree width (find min and max x positions)
      const treeNodes = this.collectTreeNodes(root);
      console.log(`[TidyLayout] Tree ${i} (root: ${root.id}) has ${treeNodes.length} nodes`);

      if (treeNodes.length > 0) {
        const minX = Math.min(...treeNodes.map(n => n.x));
        const maxX = Math.max(...treeNodes.map(n => n.x));
        const maxWidth = Math.max(...treeNodes.map(n => n.width));
        const treeWidth = maxX - minX + maxWidth; // Add node width to get true tree width

        console.log(`[TidyLayout] Tree ${i}: minX=${minX.toFixed(1)}, maxX=${maxX.toFixed(1)}, width=${treeWidth.toFixed(1)}`);

        // Shift tree to forestOffsetX
        const shiftAmount = forestOffsetX - minX;
        for (const node of treeNodes) {
          node.x += shiftAmount;
        }

        console.log(`[TidyLayout] Tree ${i} shifted by ${shiftAmount.toFixed(1)} to start at ${forestOffsetX.toFixed(1)}`);

        // Update offset for next tree
        forestOffsetX += treeWidth + TREE_SPACING;
      }
    }

    // Convert layout positions to result map
    for (const [id, layoutNode] of layoutNodes) {
      positions.set(id, { x: layoutNode.x, y: layoutNode.y });
    }

    console.log(`[TidyLayout] Positioned ${positions.size} nodes`);

    return { positions };
  }

  private buildTree(nodes: NodeInfo[]): Map<string, LayoutNode> {
    const layoutNodes = new Map<string, LayoutNode>();
    const nodeIds = new Set(nodes.map(n => n.id));

    // Create all layout nodes first
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

    // First pass: count incoming edges to detect DAG
    const incomingEdges = new Map<string, number>();
    for (const node of nodes) {
      for (const childId of node.linkedNodeIds) {
        if (childId === node.id) continue;
        if (!nodeIds.has(childId)) continue;
        incomingEdges.set(childId, (incomingEdges.get(childId) || 0) + 1);
      }
    }

    const nodesWithMultipleParents = Array.from(incomingEdges.entries()).filter(([, count]) => count > 1);
    if (nodesWithMultipleParents.length > 0) {
      console.log(`[TidyLayout] DAG detected: ${nodesWithMultipleParents.length} nodes have multiple parents`);
      console.log(`[TidyLayout] Sample nodes with multiple parents:`, nodesWithMultipleParents.slice(0, 5).map(([id, count]) => `${id}(${count})`));
    } else {
      console.log(`[TidyLayout] No DAG detected - all nodes have at most one parent`);
    }

    // Build parent-child relationships based on linkedNodeIds
    // For nodes with multiple parents, only the FIRST parent is kept (to create a tree)
    let totalLinkedIds = 0;
    let skippedSelfRefs = 0;
    let skippedMissing = 0;
    let parentChildPairs = 0;

    for (const node of nodes) {
      const layoutNode = layoutNodes.get(node.id)!;
      totalLinkedIds += node.linkedNodeIds.length;

      for (const childId of node.linkedNodeIds) {
        // Skip self-references
        if (childId === node.id) {
          skippedSelfRefs++;
          continue;
        }

        if (!nodeIds.has(childId)) {
          skippedMissing++;
          console.log(`[TidyLayout] Node ${node.id} links to ${childId} which is not in the node set`);
          continue;
        }

        const childLayoutNode = layoutNodes.get(childId);
        if (!childLayoutNode) continue;

        // Add child relationship
        layoutNode.children.push(childLayoutNode);
        parentChildPairs++;

        // Only set parent if not already set (keep FIRST parent, not last)
        if (childLayoutNode.parent === null) {
          childLayoutNode.parent = layoutNode;
        }
      }
    }

    console.log(`[TidyLayout] Build tree stats: ${totalLinkedIds} total links, ${skippedSelfRefs} self-refs, ${skippedMissing} missing, ${parentChildPairs} parent-child pairs created`);

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

    // If no roots found (cycle), pick the first node
    if (roots.length === 0 && nodes.length > 0) {
      const firstNode = layoutNodes.get(nodes[0].id);
      if (firstNode) {
        roots.push(firstNode);
      }
    }

    return roots;
  }

  private layout(root: LayoutNode): void {
    // Initialize all nodes
    this.preOrderTraversal(root, (node) => {
      this.initNode(node);
    });

    // Set y positions
    this.setYRecursive(root);

    // First walk: determine relative x positions
    this.firstWalk(root);

    // Second walk: finalize absolute positions
    this.secondWalk(root, 0);
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
    this.preOrderTraversal(root, (node) => {
      this.setY(node);
    });
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

    // Layout first child
    this.firstWalk(node.children[0]);
    const firstExtremeRight = this.getExtremeRight(node.children[0]);
    let yList: LinkedYList | null = new LinkedYList(
      0,
      firstExtremeRight.y + firstExtremeRight.height
    );

    // Layout remaining children and separate them
    for (let i = 1; i < node.children.length; i++) {
      const child = node.children[i];
      this.firstWalk(child);

      const childExtremeLeft = this.getExtremeLeft(child);
      const maxY = childExtremeLeft.y + childExtremeLeft.height;
      const [distance, collideIndex] = this.separate(node, i, yList!);

      child.tidy!.modifierToSubtree = distance;
      child.relativeX = distance;

      this.distributeExtra(node, collideIndex, i, distance);

      yList = yList!.update(maxY, i);
    }

    this.positionRoot(node);
    this.setExtreme(node);
  }

  private separate(node: LayoutNode, childIndex: number, yList: LinkedYList): [number, number] {
    const leftContour = new Contour(false, node.children[childIndex - 1]);
    const rightContour = new Contour(true, node.children[childIndex]);

    let maxDistance = 0;
    let collideIndex = 0;
    let currentYList: LinkedYList | null = yList;

    while (!leftContour.isNone() && !rightContour.isNone()) {
      // Update yList index as we traverse
      if (currentYList && leftContour.bottom() > currentYList.bottom) {
        currentYList = currentYList.next;
      }

      const distance = leftContour.right() - rightContour.left() + this.PEER_MARGIN;
      if (distance > maxDistance) {
        maxDistance = distance;
        collideIndex = currentYList?.index ?? 0;
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

    // Set threads for contour merging
    if (leftContour.isNone() && !rightContour.isNone()) {
      this.setLeftThread(node, childIndex, rightContour.current!, rightContour.modifierSum);
    } else if (!leftContour.isNone() && rightContour.isNone()) {
      this.setRightThread(node, childIndex, leftContour.current!, leftContour.modifierSum);
    }

    return [maxDistance, collideIndex];
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

  private distributeExtra(node: LayoutNode, fromIndex: number, toIndex: number, distance: number): void {
    if (toIndex === fromIndex + 1) {
      return;
    }

    const indexDiff = toIndex - fromIndex;
    node.children[fromIndex + 1].tidy!.shiftAcceleration += distance / indexDiff;
    node.children[toIndex].tidy!.shiftAcceleration -= distance / indexDiff;
    node.children[toIndex].tidy!.shiftChange -= distance - distance / indexDiff;
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

  private postOrderTraversal(node: LayoutNode, fn: (node: LayoutNode) => void): void {
    for (const child of node.children) {
      this.postOrderTraversal(child, fn);
    }
    fn(node);
  }

  private collectTreeNodes(root: LayoutNode): LayoutNode[] {
    const nodes: LayoutNode[] = [];
    this.preOrderTraversal(root, (node) => {
      nodes.push(node);
    });
    return nodes;
  }

  private debugTreeStructure(layoutNodes: Map<string, LayoutNode>): void {
    console.log(`[TidyLayout Debug] Total nodes: ${layoutNodes.size}`);

    // Count nodes by number of children
    const childrenCounts = new Map<number, number>();
    let orphans = 0;
    let nodesWithParent = 0;
    let nodesWithChildren = 0;

    for (const [, node] of layoutNodes) {
      const childCount = node.children.length;
      const hasParent = node.parent !== null;

      childrenCounts.set(childCount, (childrenCounts.get(childCount) || 0) + 1);

      if (hasParent) {
        nodesWithParent++;
      }

      if (childCount > 0) {
        nodesWithChildren++;
      }

      if (!hasParent && childCount === 0) {
        orphans++;
      }
    }

    console.log(`[TidyLayout Debug] Nodes with parent: ${nodesWithParent}`);
    console.log(`[TidyLayout Debug] Nodes with children: ${nodesWithChildren}`);
    console.log(`[TidyLayout Debug] Orphan nodes (no parent, no children): ${orphans}`);
    console.log(`[TidyLayout Debug] Nodes by child count:`, Array.from(childrenCounts.entries()).sort((a, b) => a[0] - b[0]));

    // Find potential connected components by traversing from each root
    const visited = new Set<string>();
    const components: LayoutNode[][] = [];

    for (const [id, node] of layoutNodes) {
      if (visited.has(id)) continue;
      if (node.parent !== null) continue; // Not a root

      // This is a root node - collect its entire tree
      const component: LayoutNode[] = [];
      this.preOrderTraversal(node, (n) => {
        visited.add(n.id);
        component.push(n);
      });

      components.push(component);
    }

    console.log(`[TidyLayout Debug] Connected components: ${components.length}`);
    console.log(`[TidyLayout Debug] Component sizes:`, components.map(c => c.length));
    console.log(`[TidyLayout Debug] Component roots:`, components.map(c => c[0].id));
  }
}
