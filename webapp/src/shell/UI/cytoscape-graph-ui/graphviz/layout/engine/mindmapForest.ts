import { hierarchy, tree } from 'd3-hierarchy';
import { packComponents } from '@vt/graph-model/spatial';
import type { ComponentSubgraph } from '@vt/graph-model/spatial';

// ─────────────────────────────────────────────────────────────────────────────
// Forest-of-Tidy-Trees layout (the "mindmap" engine).
//
// A VoiceTree vault graph is a FOREST: dozens of disconnected components, the
// vast majority pure trees/chains. This module exploits that directly. Every
// connected component is laid out as its own size-aware d3 tidy tree (rooted at
// its most-likely structural root), then all component boxes are packed into a
// compact rectangle by the shared R-tree `packComponents`. The result is
// deterministic, iteration-free (fast), crossing-free along tree edges, and
// overlap-free by construction (tidy spacing within a tree + R-tree gap between
// trees) — no force simulation, no global repulsion to re-disperse the packing.
//
// Pure: takes node sizes + edges, returns absolute positions. All Cytoscape /
// side-effecting work stays in the caller (runLayoutAdapter).
// ─────────────────────────────────────────────────────────────────────────────

export type ForestNode = { readonly id: string; readonly size: readonly [number, number] };
export type ForestEdge = { readonly source: string; readonly target: string };
export type ForestPosition = { readonly id: string; readonly x: number; readonly y: number };

type GraphComponent = {
  readonly nodeIds: readonly string[];
  readonly edges: readonly ForestEdge[];
};
type SizedTreeDatum = {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly children: readonly SizedTreeDatum[];
};

// Union-find partition of the nodes into connected components over UNDIRECTED
// edges. Component node lists and the component order are sorted by id so the
// whole layout is deterministic regardless of input ordering.
const connectedComponents = (
  nodes: readonly ForestNode[],
  edges: readonly ForestEdge[],
): readonly GraphComponent[] => {
  const parent = new Map<string, string>(nodes.map((node) => [node.id, node.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    let cursor = id;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor) as string;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const nodeIds = new Set<string>(nodes.map((node) => node.id));
  const internalEdges = edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  internalEdges.forEach((edge) => {
    const rootSource = find(edge.source);
    const rootTarget = find(edge.target);
    if (rootSource !== rootTarget) parent.set(rootSource, rootTarget);
  });
  const byRoot = new Map<string, { nodeIds: string[]; edges: ForestEdge[] }>();
  nodes.forEach((node) => {
    const root = find(node.id);
    const bucket = byRoot.get(root) ?? { nodeIds: [], edges: [] };
    bucket.nodeIds.push(node.id);
    byRoot.set(root, bucket);
  });
  internalEdges.forEach((edge) => {
    byRoot.get(find(edge.source))?.edges.push(edge);
  });
  return [...byRoot.values()]
    .map((component): GraphComponent => ({
      nodeIds: [...component.nodeIds].sort((left, right) => left.localeCompare(right)),
      edges: component.edges,
    }))
    .sort((left, right) => (left.nodeIds[0] ?? '').localeCompare(right.nodeIds[0] ?? ''));
};

// The node least likely to be anyone's child — minimum in-degree (a true tree
// root has in-degree 0), tie-broken by id — is hoisted to the top of the tidy
// tree so structure reads root-first, left-to-right.
const chooseRoot = (component: GraphComponent): string => {
  const inDegree = new Map<string, number>(component.nodeIds.map((id) => [id, 0]));
  component.edges.forEach((edge) => inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1));
  return [...component.nodeIds].sort((left, right) =>
    (inDegree.get(left) as number) - (inDegree.get(right) as number) || left.localeCompare(right),
  )[0];
};

// A BFS spanning tree of the component, rooted at chooseRoot. Non-tree edges
// (cross-links / cycle closures) are dropped from the hierarchy — they are
// still drawn by Cytoscape, just routed over the tidy layout rather than
// distorting it. Pure trees/chains keep every edge.
const spanningTreeDatum = (
  component: GraphComponent,
  sizeById: ReadonlyMap<string, readonly [number, number]>,
): SizedTreeDatum => {
  const adjacency = new Map<string, string[]>(component.nodeIds.map((id) => [id, []]));
  component.edges.forEach((edge) => {
    adjacency.get(edge.source)?.push(edge.target);
    adjacency.get(edge.target)?.push(edge.source);
  });
  adjacency.forEach((neighbors) => neighbors.sort((left, right) => left.localeCompare(right)));
  const visited = new Set<string>();
  const build = (id: string): SizedTreeDatum => {
    visited.add(id);
    const [width, height] = sizeById.get(id) ?? [24, 24];
    const children = (adjacency.get(id) ?? [])
      .filter((neighbor) => !visited.has(neighbor))
      .map((neighbor): SizedTreeDatum | null => (visited.has(neighbor) ? null : build(neighbor)))
      .filter((child): child is SizedTreeDatum => child !== null);
    return { id, width, height, children };
  };
  return build(chooseRoot(component));
};

// The screen-x (depth axis) coordinate of each depth level, spaced so adjacent
// levels clear their own half-widths plus the gap. Using the PER-DEPTH max card
// width (not one global max) keeps tiny-circle levels tight while still clearing
// the rare wide editor card — compact without ever overlapping across depths.
const depthCentersByLevel = (
  maxWidthByDepth: ReadonlyMap<number, number>,
  maxDepth: number,
  gap: number,
): ReadonlyMap<number, number> => {
  const centers = new Map<number, number>();
  let cursor = 0;
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    if (depth > 0) {
      const previousWidth = maxWidthByDepth.get(depth - 1) ?? 0;
      const currentWidth = maxWidthByDepth.get(depth) ?? 0;
      cursor += previousWidth / 2 + gap + currentWidth / 2;
    }
    centers.set(depth, cursor);
  }
  return centers;
};

// Lay out one component as a size-aware horizontal tidy tree. Siblings spread
// along screen-y with a per-pair gap that clears their two half-heights; depth
// grows along screen-x at per-depth spacing (see depthCentersByLevel) — so no
// two boxes in the tree can overlap. Returns local coordinates (caller packs).
const layoutComponentTree = (
  datum: SizedTreeDatum,
  gap: number,
): readonly ForestPosition[] => {
  const positioned = tree<SizedTreeDatum>()
    .nodeSize([1, 1])
    .separation((left, right) => (left.data.height + right.data.height) / 2 + gap)(hierarchy(datum));
  const nodes = positioned.descendants();
  const maxWidthByDepth = new Map<number, number>();
  nodes.forEach((node) => maxWidthByDepth.set(node.depth, Math.max(maxWidthByDepth.get(node.depth) ?? 0, node.data.width)));
  const maxDepth = Math.max(...nodes.map((node) => node.depth));
  const depthCenters = depthCentersByLevel(maxWidthByDepth, maxDepth, gap);
  return nodes.map((node): ForestPosition => ({
    id: node.data.id,
    x: depthCenters.get(node.depth) ?? 0, // depth → screen x (root at left)
    y: node.x, // sibling axis → screen y
  }));
};

/**
 * Lay out the whole graph as a forest of tidy trees and pack the trees into a
 * compact rectangle. Deterministic and pure: identical inputs → identical
 * positions. Edges only inform connectivity + tree structure; their geometry is
 * implied by the node boxes, so packing uses node boxes alone.
 */
export const computeForestLayout = (
  nodes: readonly ForestNode[],
  edges: readonly ForestEdge[],
  gap: number,
): readonly ForestPosition[] => {
  const sizeById = new Map<string, readonly [number, number]>(nodes.map((node) => [node.id, node.size]));
  const components = connectedComponents(nodes, edges);
  const localByComponent = components.map((component) =>
    layoutComponentTree(spanningTreeDatum(component, sizeById), gap),
  );
  const subgraphs: ComponentSubgraph[] = localByComponent.map((positions) => ({
    nodes: positions.map((position) => {
      const [width, height] = sizeById.get(position.id) ?? [24, 24];
      return { x: position.x, y: position.y, width, height };
    }),
    edges: [],
  }));
  const { shifts } = packComponents(subgraphs);
  return localByComponent.flatMap((positions, index): readonly ForestPosition[] => {
    const shift = shifts[index] ?? { dx: 0, dy: 0 };
    return positions.map((position): ForestPosition => ({
      id: position.id,
      x: position.x + shift.dx,
      y: position.y + shift.dy,
    }));
  });
};
