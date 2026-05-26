import type { CollectionReturnValue, Core, EdgeSingular, NodeSingular } from 'cytoscape';
import { ForceAtlas2Layout } from '@antv/layout';
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
  readonly fx?: number;
  readonly fy?: number;
  readonly data: {
    readonly size: readonly [number, number];
  };
};

type LayoutEdgeData = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly data: {
    readonly weight: number;
  };
};

const finiteOr = (value: number, fallback: number): number => Number.isFinite(value) ? value : fallback;

const elementCenter = (eles: CollectionReturnValue): readonly [number, number] => {
  const bb = eles.nodes().boundingBox({ includeLabels: false, includeOverlays: false, includeEdges: false });
  return [
    finiteOr((bb.x1 + bb.x2) / 2, 0),
    finiteOr((bb.y1 + bb.y2) / 2, 0),
  ];
};

const elementSize = (node: NodeSingular): readonly [number, number] => [
  Math.max(1, finiteOr(node.outerWidth(), 1)),
  Math.max(1, finiteOr(node.outerHeight(), 1)),
];

const toAntvGraph = (
  eles: CollectionReturnValue,
  fixedNodeIds: ReadonlySet<string>,
): { readonly nodes: readonly LayoutNodeData[]; readonly edges: readonly LayoutEdgeData[] } => {
  const nodeIds: Set<string> = new Set<string>(eles.nodes().map((node: NodeSingular) => node.id()));
  const nodes: LayoutNodeData[] = eles.nodes().map((node: NodeSingular): LayoutNodeData => {
    const position = node.position();
    const fixed = fixedNodeIds.has(node.id()) || node.locked();
    return {
      id: node.id(),
      x: position.x,
      y: position.y,
      ...(fixed ? { fx: position.x, fy: position.y } : {}),
      data: { size: elementSize(node) },
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

const applyAntvPositions = (
  cy: Core,
  layout: ForceAtlas2Layout,
  allowedNodeIds: ReadonlySet<string>,
): void => {
  cy.batch(() => {
    layout.forEachNode((node): void => {
      const id: string = String(node.id);
      if (!allowedNodeIds.has(id)) return;
      const cyNode = cy.getElementById(id);
      if (cyNode.length === 0 || cyNode.locked()) return;
      cyNode.position({ x: node.x, y: node.y });
    });
  });
};

const runForceAtlas2 = async ({
  cy,
  eles,
  fixedNodeIds = new Set<string>(),
}: RunLayoutAdapterOptions): Promise<void> => {
  const graph = toAntvGraph(eles, fixedNodeIds);
  if (graph.nodes.length === 0) return;

  const center = elementCenter(eles);
  const layout = new ForceAtlas2Layout({
    center: [center[0], center[1]],
    width: Math.max(1, cy.width()),
    height: Math.max(1, cy.height()),
    barnesHut: true,
    preventOverlap: false,
    prune: false,
    maxIteration: graph.nodes.length < 100 ? 120 : 250,
    kg: 1,
    kr: 5,
    ks: 0.1,
    nodeSize: (node: LayoutNodeData): readonly [number, number] => node.data.size,
  });

  await layout.execute(graph);
  applyAntvPositions(cy, layout, new Set<string>(graph.nodes.map((node) => node.id)));
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
  }, movableNodes ?? eles.nodes(), localAnimationDuration, resolve);
});

const runWebcola = (options: RunLayoutAdapterOptions): Promise<void> => (
  options.mode === 'local' ? runLocalWebcola(options) : runFullWebcola(options)
);

export const runLayoutAdapter = async (options: RunLayoutAdapterOptions): Promise<void> => {
  if (options.config.engine === 'webcola') {
    await runWebcola(options);
    return;
  }
  await runForceAtlas2(options);
};
