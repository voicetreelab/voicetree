import type {GraphNode} from "@/functional/pure/graph/types.ts";

export async function getNodeFromUI(nodeId: string): Promise<GraphNode> {
    const currentGraph = await window.electronAPI?.graph.getState() // todo just getNode()
    if (!currentGraph) {
        console.error("NO GRAPH IN STATE")
        throw Error("NO GRAPH IN STATE")
    }
    return currentGraph.nodes[nodeId];
}