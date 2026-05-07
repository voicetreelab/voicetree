import type { Graph, GraphNode } from '@vt/graph-model/graph';
import { createEmptyGraph } from '@vt/graph-model/graph';

let currentGraph: Graph = createEmptyGraph();

export const getGraph: () => Graph = (): Graph => currentGraph;

export const setGraph: (graph: Graph) => void = (graph: Graph): void => {
    currentGraph = graph;
};

export const getNode: (nodeId: string) => GraphNode | undefined = (nodeId: string): GraphNode | undefined => {
    return currentGraph.nodes[nodeId];
};
