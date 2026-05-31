import type { CollectionReturnValue, Core } from 'cytoscape';
import { ComboCombinedLayout, ForceAtlas2Layout } from '@antv/layout';
import type { GraphData, NodeData } from '@antv/layout';
import {
  removeRectangularOverlaps,
  type OverlapRect,
} from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/engine/removeRectangularOverlaps';
import ColaLayout from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/cola-engine/cola';
import { computeColaAndAnimate } from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/cola-engine/computeColaAndAnimate';
import type { AutoLayoutOptions } from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/auto/autoLayoutTypes';
import { DEFAULT_OPTIONS } from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/auto/autoLayoutTypes';
import {
  type AntvGraph,
  type AntvNodeData,
  type PositionedNode,
  type RunLayoutAdapterOptions,
  applyAntvPositions,
  applyLayoutEnginePositions,
  elementCenter,
  movableNodeIds,
  nodeDataSize,
  numericOption,
  toAntvGraph,
} from './layoutAdapterCommon';
import { runMindmap } from './mindmapLayout';

const stripContainment = (graph: AntvGraph): AntvGraph => ({
  nodes: graph.nodes.map((node): AntvNodeData => ({
    id: node.id,
    x: node.x,
    y: node.y,
    ...(node.fx !== undefined ? { fx: node.fx } : {}),
    ...(node.fy !== undefined ? { fy: node.fy } : {}),
    data: node.data,
  })),
  edges: graph.edges,
});
// Overlap finisher for the point-mass engines (ForceAtlas2 / ComboCombined).
// Those engines place nodes by simulated repulsion of dimensionless points, so
// their output has overlapping rectangular cards. We resolve that here with a
// hard rectangular non-overlap projection (VPSC) rather than enabling FA2's own
// preventOverlap (which would silently force its O(n^2) all-pairs path and is
// only circular anyway). Movable nodes minimise displacement, preserving the
// engine's global structure; fixed/locked nodes stay put and act as obstacles.
const finishOverlaps = (
  cy: Core,
  graphNodes: readonly AntvNodeData[],
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
  graph: AntvGraph,
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
  await layout.execute(graph as unknown as GraphData);
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
  node: AntvNodeData,
  nodeById: ReadonlyMap<string, AntvNodeData>,
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
const flattenComboHierarchy = (graph: AntvGraph): AntvGraph => {
  const nodeById = new Map<string, AntvNodeData>(graph.nodes.map((node) => [node.id, node]));
  const rootComboIds = new Set<string>();
  graph.nodes.forEach((node): void => {
    const rootComboId = rootComboIdFor(node, nodeById);
    if (rootComboId) rootComboIds.add(rootComboId);
  });
  return {
    nodes: graph.nodes.map((node): AntvNodeData => {
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
    layout: (comboId: string | number | null) => comboId
      ? { type: 'force-atlas2', barnesHut: true, preventOverlap: false, maxIteration: 80 }
      : { type: 'force-atlas2', barnesHut: true, preventOverlap: false, maxIteration: 160 },
    node: (datum: NodeData) => ({
      id: datum.id as string,
      x: datum.x as number,
      y: datum.y as number,
      parentId: datum.parentId as string | null | undefined,
      isCombo: datum.isCombo as boolean | undefined,
    }),
  });
  await layout.execute(graph as unknown as GraphData);
  const movableIds = movableNodeIds(graph.nodes, fixedNodeIds, movableNodes);
  applyAntvPositions(cy, layout, movableIds);
  finishOverlaps(cy, graph.nodes, movableIds, fixedNodeIds, Math.max(16, nodeSpacing / 6));
  layout.destroy();
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
    // Layout-then-pack: lay out every component in place (no grid-stacking) and
    // let runFullUltimateLayout's R-tree pack own disconnected-component
    // separation. cola's own handleDisconnected tiles components into a very tall
    // column, which the pack would then have to undo — so disable it here.
    handleDisconnected: false,
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
