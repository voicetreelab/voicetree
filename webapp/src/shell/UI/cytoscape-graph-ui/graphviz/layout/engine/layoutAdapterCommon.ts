// Shared types + helpers for the layout-engine adapters (runLayoutAdapter and
// the per-engine modules). Kept engine-agnostic: graph extraction from the live
// Cytoscape collection, the movable-node set, and the position write-back. Each
// concrete engine (ForceAtlas2 / ComboCombined / mindmap / WebCoLA) composes
// these with its own backend-specific logic.

import type { CollectionReturnValue, Core, EdgeSingular, NodeSingular } from 'cytoscape';

export type LayoutMode = 'full' | 'local';

export type RunLayoutAdapterOptions = {
  readonly cy: Core;
  readonly eles: CollectionReturnValue;
  readonly config: import('@/shell/UI/cytoscape-graph-ui/graphviz/layout/auto/autoLayoutTypes').LayoutConfig;
  readonly mode: LayoutMode;
  readonly movableNodes?: CollectionReturnValue;
  readonly fixedNodeIds?: ReadonlySet<string>;
  readonly localAnimationDuration?: number;
};

export type AntvNodeData = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly parentId?: string | null;
  readonly isCombo?: boolean;
  readonly fx?: number;
  readonly fy?: number;
  readonly data: { readonly size: readonly [number, number] };
};

export type AntvEdgeData = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly data: { readonly weight: number };
};

export type AntvGraph = {
  readonly nodes: readonly AntvNodeData[];
  readonly edges: readonly AntvEdgeData[];
};

export type PositionedNode = { readonly id: string; readonly x: number; readonly y: number };

export const finiteOr = (value: number, fallback: number): number => Number.isFinite(value) ? value : fallback;

export const numericOption = (value: unknown, fallback: number): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
);

export const elementCenter = (eles: CollectionReturnValue): readonly [number, number] => {
  const bb = eles.nodes().boundingBox({ includeLabels: false, includeOverlays: false, includeEdges: false });
  return [finiteOr((bb.x1 + bb.x2) / 2, 0), finiteOr((bb.y1 + bb.y2) / 2, 0)];
};

export const labelInclusiveSize = (node: NodeSingular): readonly [number, number] => {
  const bb = node.boundingBox({ includeLabels: true, includeOverlays: false, includeEdges: false });
  return [Math.max(1, finiteOr(bb.w, 1)), Math.max(1, finiteOr(bb.h, 1))];
};

export const nodeDataSize = (
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

export const toAntvGraph = (eles: CollectionReturnValue, fixedNodeIds: ReadonlySet<string>): AntvGraph => {
  const nodeIds: Set<string> = new Set<string>(eles.nodes().map((node: NodeSingular) => node.id()));
  const parentIds: Set<string> = new Set<string>();
  eles.nodes().forEach((node: NodeSingular): void => {
    const parentId = node.data('parent');
    if (typeof parentId === 'string' && nodeIds.has(parentId)) parentIds.add(parentId);
  });
  const duplicatePositionCounts = new Map<string, number>();
  const nodes: AntvNodeData[] = eles.nodes().map((node: NodeSingular): AntvNodeData => {
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
  const edges: AntvEdgeData[] = eles.edges()
    .filter((edge: EdgeSingular): boolean => nodeIds.has(edge.source().id()) && nodeIds.has(edge.target().id()))
    .map((edge: EdgeSingular): AntvEdgeData => ({
      id: edge.id(),
      source: edge.source().id(),
      target: edge.target().id(),
      data: { weight: 1 },
    }));
  return { nodes, edges };
};

export const movableNodeIds = (
  graphNodes: readonly AntvNodeData[],
  fixedNodeIds: ReadonlySet<string>,
  movableNodes?: CollectionReturnValue,
): ReadonlySet<string> => {
  const graphNodeIds = new Set<string>(graphNodes.map((node) => node.id));
  const ids = movableNodes
    ? movableNodes.nodes().map((node: NodeSingular) => node.id()).filter((id: string) => graphNodeIds.has(id))
    : graphNodes.map((node) => node.id);
  return new Set<string>(ids.filter((id: string) => !fixedNodeIds.has(id)));
};

export const applyAntvPositions = (
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

export const applyLayoutEnginePositions = (
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
