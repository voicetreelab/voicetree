import type {Graph, GraphNode} from "@/pure/graph";
import { createEmptyGraph } from "@/pure/graph/createGraph";

// The ONLY mutable state in the functional architecture for graph data
// Initialized to empty - will be populated when file watching starts
let currentGraph: Graph = createEmptyGraph();

// Getter/setter for controlled access to graph state
export const getGraph: () => Graph = (): Graph => {
    return currentGraph;
};

export const setGraph: (graph: Graph) => void = (graph: Graph): void => {
    currentGraph = graph;
};

export const getNode: (nodeId: string) => GraphNode | undefined = (nodeId: string): GraphNode | undefined => {
    return currentGraph.nodes[nodeId];
};
