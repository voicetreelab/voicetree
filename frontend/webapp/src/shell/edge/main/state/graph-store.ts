import type {Graph} from "@/pure/graph";

// The ONLY mutable state in the functional architecture for graph data
// Initialized to empty - will be populated when file watching starts
let currentGraph: Graph = { nodes: {} };

// Getter/setter for controlled access to graph state
export const getGraph: () => Graph = (): Graph => {
    return currentGraph;
};

export const setGraph: (graph: Graph) => void = (graph: Graph): void => {
    currentGraph = graph;
};
