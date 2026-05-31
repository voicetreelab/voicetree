// Mindmap engine: lays out the largest rooted tree with d3's tidy-tree algorithm
// and drops the remaining components into a grid below it. Deterministic and
// iteration-free. Shares graph extraction + position write-back with the other
// engines via layoutAdapterCommon.

import { hierarchy, tree } from 'd3-hierarchy';
import type { HierarchyPointNode } from 'd3-hierarchy';
import {
  type AntvNodeData,
  type PositionedNode,
  type RunLayoutAdapterOptions,
  applyLayoutEnginePositions,
  elementCenter,
  movableNodeIds,
  numericOption,
  toAntvGraph,
} from './layoutAdapterCommon';

type TreeDatum = {
  readonly id: string;
  readonly children: readonly TreeDatum[];
};

const wouldCreateCycle = (
  childId: string,
  parentId: string,
  parentById: ReadonlyMap<string, string>,
): boolean => {
  let current: string | undefined = parentId;
  const visited = new Set<string>();
  while (current !== undefined) {
    if (current === childId) return true;
    if (visited.has(current)) return true;
    visited.add(current);
    current = parentById.get(current);
  }
  return false;
};

const buildTreeChildren = (
  nodes: readonly AntvNodeData[],
): { readonly roots: readonly string[]; readonly childrenById: ReadonlyMap<string, readonly string[]> } => {
  const nodeIds = new Set<string>(nodes.map((node) => node.id));
  const parentById = new Map<string, string>();
  nodes
    .filter((node) => node.parentId && nodeIds.has(node.parentId))
    .sort((left, right) => left.id.localeCompare(right.id))
    .forEach((node): void => {
      const parentId = node.parentId;
      if (!parentId || wouldCreateCycle(node.id, parentId, parentById)) return;
      parentById.set(node.id, parentId);
    });
  const childrenById = new Map<string, string[]>();
  parentById.forEach((parentId, childId): void => {
    const children = childrenById.get(parentId) ?? [];
    children.push(childId);
    childrenById.set(parentId, children);
  });
  childrenById.forEach((children): void => {
    children.sort((left, right) => left.localeCompare(right));
  });
  const roots = nodes
    .map((node) => node.id)
    .filter((id) => !parentById.has(id))
    .sort((left, right) => left.localeCompare(right));
  return { roots, childrenById };
};

const treeDatumFor = (id: string, childrenById: ReadonlyMap<string, readonly string[]>): TreeDatum => ({
  id,
  children: (childrenById.get(id) ?? []).map((childId) => treeDatumFor(childId, childrenById)),
});

const treeSize = (datum: TreeDatum): number => (
  1 + datum.children.reduce((sum, child) => sum + treeSize(child), 0)
);

const descendantsOf = (datum: TreeDatum): ReadonlySet<string> => {
  const ids = new Set<string>();
  const visit = (node: TreeDatum): void => {
    ids.add(node.id);
    node.children.forEach(visit);
  };
  visit(datum);
  return ids;
};

const chooseLargestTree = (
  roots: readonly string[],
  childrenById: ReadonlyMap<string, readonly string[]>,
): TreeDatum | null => roots
  .map((rootId) => treeDatumFor(rootId, childrenById))
  .sort((left, right) => treeSize(right) - treeSize(left) || left.id.localeCompare(right.id))[0] ?? null;

const layoutOrphanGrid = (
  orphanIds: readonly string[],
  centerX: number,
  startY: number,
  columnGap: number,
  rowGap: number,
): readonly PositionedNode[] => {
  if (orphanIds.length === 0) return [];
  const columns = Math.max(1, Math.ceil(Math.sqrt(orphanIds.length)));
  return orphanIds.map((id, index): PositionedNode => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      id,
      x: centerX + (column - (columns - 1) / 2) * columnGap,
      y: startY + row * rowGap,
    };
  });
};

export const runMindmap = async ({
  cy,
  eles,
  config,
  fixedNodeIds = new Set<string>(),
  movableNodes,
}: RunLayoutAdapterOptions): Promise<void> => {
  const graph = toAntvGraph(eles, fixedNodeIds);
  if (graph.nodes.length === 0) return;
  const { roots, childrenById } = buildTreeChildren(graph.nodes);
  const mainTree = chooseLargestTree(roots, childrenById);
  if (!mainTree) return;
  const center = elementCenter(eles);
  const siblingGap = Math.max(80, numericOption(config.cola.nodeSpacing, 120));
  const depthGap = Math.max(180, numericOption(config.cola.edgeLength, 350));
  const positionedTree = tree<TreeDatum>().nodeSize([siblingGap, depthGap])(hierarchy(mainTree));
  const descendants = positionedTree.descendants();
  const minTreeY = Math.min(...descendants.map((node: HierarchyPointNode<TreeDatum>) => node.x));
  const maxTreeY = Math.max(...descendants.map((node: HierarchyPointNode<TreeDatum>) => node.x));
  const treeMiddleY = (minTreeY + maxTreeY) / 2;
  const treePositions: readonly PositionedNode[] = descendants.map((node): PositionedNode => ({
    id: node.data.id,
    x: center[0] + node.y,
    y: center[1] + node.x - treeMiddleY,
  }));
  const mainTreeIds = descendantsOf(mainTree);
  const orphanIds = graph.nodes
    .map((node) => node.id)
    .filter((id) => !mainTreeIds.has(id))
    .sort((left, right) => left.localeCompare(right));
  const treeBottom = Math.max(...treePositions.map((node) => node.y));
  const orphanPositions = layoutOrphanGrid(orphanIds, center[0], treeBottom + siblingGap * 2, depthGap, siblingGap);
  applyLayoutEnginePositions(
    cy,
    [...treePositions, ...orphanPositions],
    movableNodeIds(graph.nodes, fixedNodeIds, movableNodes),
  );
};
