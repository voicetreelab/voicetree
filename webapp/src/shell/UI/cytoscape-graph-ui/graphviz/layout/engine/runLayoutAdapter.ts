import type { CollectionReturnValue, Core, EdgeSingular, NodeSingular } from 'cytoscape';
import { ComboCombinedLayout, ForceAtlas2Layout } from '@antv/layout';
import { hierarchy, tree } from 'd3-hierarchy';
import type { HierarchyPointNode } from 'd3-hierarchy';
import {
  removeRectangularOverlaps,
  type OverlapRect,
} from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/engine/removeRectangularOverlaps';
import ColaLayout from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/cola-engine/cola';
import { computeColaAndAnimate } from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/cola-engine/computeColaAndAnimate';
import type { AutoLayoutOptions, LayoutConfig } from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/auto/autoLayoutTypes';
import { DEFAULT_OPTIONS } from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/auto/autoLayoutTypes';
type LayoutMode = 'full' | 'local';
type RunLayoutAdapterOptions = {
  readonly cy: Core;
  readonly eles: CollectionReturnValue;
  readonly config: LayoutConfig;
  readonly mode: LayoutMode;
  readonly movableNodes?: CollectionReturnValue;
  readonly fixedNodeIds?: ReadonlySet<string>;
  readonly localAnimationDuration?: number;
};
type LayoutNodeData = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly parentId?: string | null;
  readonly isCombo?: boolean;
  readonly fx?: number;
  readonly fy?: number;
  readonly data: { readonly size: readonly [number, number] };
};
type LayoutEdgeData = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly data: { readonly weight: number };
};
type LayoutGraph = {
  readonly nodes: readonly LayoutNodeData[];
  readonly edges: readonly LayoutEdgeData[];
};
type TreeDatum = {
  readonly id: string;
  readonly children: readonly TreeDatum[];
};
type PositionedNode = { readonly id: string; readonly x: number; readonly y: number };
const finiteOr = (value: number, fallback: number): number => Number.isFinite(value) ? value : fallback;
const numericOption = (value: unknown, fallback: number): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
);
const elementCenter = (eles: CollectionReturnValue): readonly [number, number] => {
  const bb = eles.nodes().boundingBox({ includeLabels: false, includeOverlays: false, includeEdges: false });
  return [finiteOr((bb.x1 + bb.x2) / 2, 0), finiteOr((bb.y1 + bb.y2) / 2, 0)];
};
const labelInclusiveSize = (node: NodeSingular): readonly [number, number] => {
  const bb = node.boundingBox({ includeLabels: true, includeOverlays: false, includeEdges: false });
  return [Math.max(1, finiteOr(bb.w, 1)), Math.max(1, finiteOr(bb.h, 1))];
};
const nodeDataSize = (
  node: { readonly data?: { readonly size?: readonly [number, number] }; readonly size?: readonly number[] },
): readonly [number, number] => {
  const size = node.data?.size ?? node.size;
  return [
    typeof size?.[0] === 'number' && Number.isFinite(size[0]) ? size[0] : 24,
    typeof size?.[1] === 'number' && Number.isFinite(size[1]) ? size[1] : 24,
  ];
};
const duplicatePositionKey = (x: number, y: number): string => `${x}:${y}`;
const spreadDuplicatePosition = (x: number, y: number, duplicateIndex: number): readonly [number, number] => {
  if (duplicateIndex === 0) return [x, y];
  const angle = duplicateIndex * 2.399963229728653;
  const radius = 8 * Math.sqrt(duplicateIndex);
  return [x + Math.cos(angle) * radius, y + Math.sin(angle) * radius];
};
const toAntvGraph = (eles: CollectionReturnValue, fixedNodeIds: ReadonlySet<string>): LayoutGraph => {
  const nodeIds: Set<string> = new Set<string>(eles.nodes().map((node: NodeSingular) => node.id()));
  const parentIds: Set<string> = new Set<string>();
  eles.nodes().forEach((node: NodeSingular): void => {
    const parentId = node.data('parent');
    if (typeof parentId === 'string' && nodeIds.has(parentId)) parentIds.add(parentId);
  });
  const duplicatePositionCounts = new Map<string, number>();
  const nodes: LayoutNodeData[] = eles.nodes().map((node: NodeSingular): LayoutNodeData => {
    const position = node.position();
    const fixed = fixedNodeIds.has(node.id()) || node.locked();
    const key = duplicatePositionKey(position.x, position.y);
    const duplicateIndex = duplicatePositionCounts.get(key) ?? 0;
    duplicatePositionCounts.set(key, duplicateIndex + 1);
    const [x, y] = fixed ? [position.x, position.y] : spreadDuplicatePosition(position.x, position.y, duplicateIndex);
    const parentId = node.data('parent');
    const validParentId = typeof parentId === 'string' && nodeIds.has(parentId) ? parentId : null;
    return {
      id: node.id(),
      x,
      y,
      ...(validParentId ? { parentId: validParentId } : {}),
      ...(parentIds.has(node.id()) || node.isParent() ? { isCombo: true } : {}),
      ...(fixed ? { fx: position.x, fy: position.y } : {}),
      data: { size: labelInclusiveSize(node) },
    };
  });
  const edges: LayoutEdgeData[] = eles.edges()
    .filter((edge: EdgeSingular): boolean => nodeIds.has(edge.source().id()) && nodeIds.has(edge.target().id()))
    .map((edge: EdgeSingular): LayoutEdgeData => ({
      id: edge.id(),
      source: edge.source().id(),
      target: edge.target().id(),
      data: { weight: 1 },
    }));
  return { nodes, edges };
};
const movableNodeIds = (
  graphNodes: readonly LayoutNodeData[],
  fixedNodeIds: ReadonlySet<string>,
  movableNodes?: CollectionReturnValue,
): ReadonlySet<string> => {
  const graphNodeIds = new Set<string>(graphNodes.map((node) => node.id));
  const ids = movableNodes
    ? movableNodes.nodes().map((node: NodeSingular) => node.id()).filter((id: string) => graphNodeIds.has(id))
    : graphNodes.map((node) => node.id);
  return new Set<string>(ids.filter((id: string) => !fixedNodeIds.has(id)));
};
const stripContainment = (graph: LayoutGraph): LayoutGraph => ({
  nodes: graph.nodes.map((node): LayoutNodeData => ({
    id: node.id,
    x: node.x,
    y: node.y,
    ...(node.fx !== undefined ? { fx: node.fx } : {}),
    ...(node.fy !== undefined ? { fy: node.fy } : {}),
    data: node.data,
  })),
  edges: graph.edges,
});
const applyAntvPositions = (
  cy: Core,
  layout: { readonly forEachNode: (callback: (node: { id: string | number; x: number; y: number }) => void) => void },
  allowedNodeIds: ReadonlySet<string>,
): void => {
  cy.batch(() => {
    layout.forEachNode((node): void => {
      const id: string = String(node.id);
      if (!allowedNodeIds.has(id) || !Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
      const cyNode = cy.getElementById(id);
      if (cyNode.length === 0 || cyNode.locked()) return;
      cyNode.position({ x: node.x, y: node.y });
    });
  });
};
const applyLayoutEnginePositions = (
  cy: Core,
  positionedNodes: readonly PositionedNode[],
  allowedNodeIds: ReadonlySet<string>,
): void => {
  cy.batch(() => {
    positionedNodes.forEach((positioned): void => {
      if (!allowedNodeIds.has(positioned.id)) return;
      const cyNode = cy.getElementById(positioned.id);
      if (cyNode.length === 0 || cyNode.locked()) return;
      cyNode.position({ x: positioned.x, y: positioned.y });
    });
  });
};
// Overlap finisher for the point-mass engines (ForceAtlas2 / ComboCombined).
// Those engines place nodes by simulated repulsion of dimensionless points, so
// their output has overlapping rectangular cards. We resolve that here with a
// hard rectangular non-overlap projection (VPSC) rather than enabling FA2's own
// preventOverlap (which would silently force its O(n^2) all-pairs path and is
// only circular anyway). Movable nodes minimise displacement, preserving the
// engine's global structure; fixed/locked nodes stay put and act as obstacles.
const finishOverlaps = (
  cy: Core,
  graphNodes: readonly LayoutNodeData[],
  movableIds: ReadonlySet<string>,
  fixedNodeIds: ReadonlySet<string>,
  spacing: number,
): void => {
  const rects = graphNodes
    .map((node): OverlapRect | null => {
      const cyNode = cy.getElementById(node.id);
      if (cyNode.length === 0 || cyNode.isParent()) return null;
      const position = cyNode.position();
      if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;
      const [width, height] = node.data.size;
      const movable = movableIds.has(node.id) && !fixedNodeIds.has(node.id) && !cyNode.locked();
      return { id: node.id, x: position.x, y: position.y, width, height, movable };
    })
    .filter((rect): rect is OverlapRect => rect !== null);
  if (rects.length < 2) return;
  const resolved = removeRectangularOverlaps(rects, spacing);
  applyLayoutEnginePositions(cy, resolved.filter((position) => movableIds.has(position.id)), movableIds);
};
// FA2 settles into a dimensionless point cloud whose equilibrium edge length is
// only ~sqrt(kr·deg^2) px — orders of magnitude below the node cards, so the raw
// output is a blob that the VPSC finisher then packs at minimum gap. This bridges
// that scale gap: uniformly scale the movable nodes about the layout centroid so
// the MEDIAN edge reaches `targetEdgeLength`, restoring a card-relative scale
// before the finisher does its non-overlap touch-up. A uniform scale preserves
// FA2's relational structure exactly. Caller must only invoke this on a fully
// free layout (no pinned nodes) — scaling about a centroid is invalid when some
// nodes are anchored, since it would move free nodes relative to the fixed ones.
const scaleToTargetEdgeLength = (
  cy: Core,
  graph: LayoutGraph,
  movableIds: ReadonlySet<string>,
  targetEdgeLength: number,
): void => {
  if (targetEdgeLength <= 0 || graph.edges.length === 0) return;
  const positionOf = (id: string): { readonly x: number; readonly y: number } | null => {
    const node = cy.getElementById(id);
    if (node.length === 0) return null;
    const position = node.position();
    return Number.isFinite(position.x) && Number.isFinite(position.y) ? position : null;
  };
  const edgeLengths = graph.edges
    .map((edge): number => {
      const source = positionOf(edge.source);
      const target = positionOf(edge.target);
      return source && target ? Math.hypot(target.x - source.x, target.y - source.y) : 0;
    })
    .filter((length): boolean => length > 1e-6)
    .sort((left, right) => left - right);
  if (edgeLengths.length === 0) return;
  const medianEdge = edgeLengths[Math.floor(edgeLengths.length / 2)];
  const scale = targetEdgeLength / medianEdge;
  if (!Number.isFinite(scale) || scale <= 0 || Math.abs(scale - 1) < 0.05) return;
  const centers = graph.nodes
    .map((node) => positionOf(node.id))
    .filter((position): position is { readonly x: number; readonly y: number } => position !== null);
  if (centers.length === 0) return;
  const centerX = centers.reduce((sum, position) => sum + position.x, 0) / centers.length;
  const centerY = centers.reduce((sum, position) => sum + position.y, 0) / centers.length;
  const scaled = graph.nodes
    .filter((node) => movableIds.has(node.id))
    .map((node): PositionedNode | null => {
      const position = positionOf(node.id);
      return position
        ? { id: node.id, x: centerX + (position.x - centerX) * scale, y: centerY + (position.y - centerY) * scale }
        : null;
    })
    .filter((position): position is PositionedNode => position !== null);
  applyLayoutEnginePositions(cy, scaled, movableIds);
};
const runForceAtlas2 = async ({
  cy,
  eles,
  config,
  mode,
  fixedNodeIds = new Set<string>(),
  movableNodes,
}: RunLayoutAdapterOptions): Promise<void> => {
  const graph = stripContainment(toAntvGraph(eles, fixedNodeIds));
  if (graph.nodes.length === 0) return;
  const fa2 = config.forceatlas2;
  const center = elementCenter(eles);
  const layout = new ForceAtlas2Layout({
    center: [center[0], center[1]],
    width: Math.max(1, cy.width()),
    height: Math.max(1, cy.height()),
    barnesHut: true,
    preventOverlap: false,
    prune: false,
    maxIteration: fa2.maxIteration > 0 ? fa2.maxIteration : (graph.nodes.length < 100 ? 120 : 250),
    kg: fa2.kg,
    kr: fa2.kr,
    ks: fa2.ks,
    nodeSize: nodeDataSize,
  });
  await layout.execute(graph);
  const movableIds = movableNodeIds(graph.nodes, fixedNodeIds, movableNodes);
  applyAntvPositions(cy, layout, movableIds);
  // Only rescale a fully-free full layout; a pinned local layout is anchored to
  // its fixed neighbours and must keep their established scale.
  if (mode === 'full' && fixedNodeIds.size === 0) {
    scaleToTargetEdgeLength(cy, graph, movableIds, fa2.edgeLength);
  }
  finishOverlaps(cy, graph.nodes, movableIds, fixedNodeIds, Math.max(0, fa2.spacing));
  layout.destroy();
};
const rootComboIdFor = (
  node: LayoutNodeData,
  nodeById: ReadonlyMap<string, LayoutNodeData>,
): string | null => {
  let parentId = node.parentId ?? null;
  let rootParentId: string | null = null;
  const visited = new Set<string>([node.id]);
  while (parentId && nodeById.has(parentId) && !visited.has(parentId)) {
    visited.add(parentId);
    rootParentId = parentId;
    parentId = nodeById.get(parentId)?.parentId ?? null;
  }
  return rootParentId;
};
const flattenComboHierarchy = (graph: LayoutGraph): LayoutGraph => {
  const nodeById = new Map<string, LayoutNodeData>(graph.nodes.map((node) => [node.id, node]));
  const rootComboIds = new Set<string>();
  graph.nodes.forEach((node): void => {
    const rootComboId = rootComboIdFor(node, nodeById);
    if (rootComboId) rootComboIds.add(rootComboId);
  });
  return {
    nodes: graph.nodes.map((node): LayoutNodeData => {
      if (rootComboIds.has(node.id)) return { ...node, parentId: null, isCombo: true };
      return { ...node, parentId: rootComboIdFor(node, nodeById), isCombo: undefined };
    }),
    edges: graph.edges,
  };
};
const runComboCombined = async ({
  cy,
  eles,
  config,
  fixedNodeIds = new Set<string>(),
  movableNodes,
}: RunLayoutAdapterOptions): Promise<void> => {
  const graph = flattenComboHierarchy(toAntvGraph(eles, fixedNodeIds));
  if (graph.nodes.length === 0) return;
  const center = elementCenter(eles);
  const nodeSpacing = numericOption(config.cola.nodeSpacing, 120);
  const layout = new ComboCombinedLayout({
    center: [center[0], center[1]],
    width: Math.max(1, cy.width()),
    height: Math.max(1, cy.height()),
    nodeSize: nodeDataSize,
    comboPadding: Math.max(24, nodeSpacing / 3),
    comboSpacing: Math.max(60, nodeSpacing),
    layout: (comboId: string | null) => comboId
      ? { type: 'force-atlas2', barnesHut: true, preventOverlap: false, maxIteration: 80 }
      : { type: 'force-atlas2', barnesHut: true, preventOverlap: false, maxIteration: 160 },
    node: (datum: LayoutNodeData) => ({
      id: datum.id,
      x: datum.x,
      y: datum.y,
      parentId: datum.parentId,
      isCombo: datum.isCombo,
    }),
  });
  await layout.execute(graph);
  const movableIds = movableNodeIds(graph.nodes, fixedNodeIds, movableNodes);
  applyAntvPositions(cy, layout, movableIds);
  finishOverlaps(cy, graph.nodes, movableIds, fixedNodeIds, Math.max(16, nodeSpacing / 6));
  layout.destroy();
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
  nodes: readonly LayoutNodeData[],
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
const runMindmap = async ({
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
const runFullWebcola = ({
  cy,
  eles,
  config,
}: RunLayoutAdapterOptions): Promise<void> => new Promise((resolve) => {
  const colaOpts: AutoLayoutOptions = config.cola;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layout: any = new (ColaLayout as any)({
    cy,
    eles,
    animate: colaOpts.animate,
    randomize: false,
    avoidOverlap: colaOpts.avoidOverlap,
    handleDisconnected: colaOpts.handleDisconnected,
    convergenceThreshold: colaOpts.convergenceThreshold,
    maxSimulationTime: colaOpts.maxSimulationTime,
    unconstrIter: colaOpts.unconstrIter,
    userConstIter: colaOpts.userConstIter,
    allConstIter: colaOpts.allConstIter,
    nodeSpacing: colaOpts.nodeSpacing,
    edgeLength: colaOpts.edgeLength,
    edgeSymDiffLength: colaOpts.edgeSymDiffLength,
    edgeJaccardLength: colaOpts.edgeJaccardLength,
    centerGraph: false,
    fit: false,
    nodeDimensionsIncludeLabels: true,
  });
  layout.one('layoutstop', resolve);
  layout.run();
});
const runLocalWebcola = ({
  cy,
  eles,
  config,
  movableNodes,
  localAnimationDuration = 0,
}: RunLayoutAdapterOptions): Promise<void> => new Promise((resolve) => {
  computeColaAndAnimate({
    cy,
    eles,
    randomize: false,
    avoidOverlap: true,
    handleDisconnected: false,
    convergenceThreshold: 1.5,
    maxSimulationTime: 1000,
    unconstrIter: 25,
    userConstIter: 25,
    allConstIter: 25,
    nodeSpacing: 120,
    edgeLength: config.cola.edgeLength ?? DEFAULT_OPTIONS.edgeLength,
    centerGraph: false,
    fit: false,
    nodeDimensionsIncludeLabels: true,
  }, (movableNodes ?? eles.nodes()) as CollectionReturnValue, localAnimationDuration, resolve);
});
const runWebcola = (options: RunLayoutAdapterOptions): Promise<void> => (
  options.mode === 'local' ? runLocalWebcola(options) : runFullWebcola(options)
);
export const runLayoutAdapter = async (options: RunLayoutAdapterOptions): Promise<void> => {
  switch (options.config.engine) {
    case 'webcola': return runWebcola(options);
    case 'combocombined': return runComboCombined(options);
    case 'mindmap': return runMindmap(options);
    case 'forceatlas2': return runForceAtlas2(options);
  }
};
