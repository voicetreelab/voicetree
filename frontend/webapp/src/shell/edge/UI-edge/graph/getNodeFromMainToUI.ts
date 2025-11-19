import type {GraphNode} from "@/pure/graph";

export async function getNodeFromMainToUI(nodeId: string): Promise<GraphNode> {
    const currentGraph = await window.electronAPI?.main.getGraph() // todo just getNode()
    if (!currentGraph) {
        console.error("NO GRAPH IN STATE")
        throw Error("NO GRAPH IN STATE")
    }
    return currentGraph.nodes[nodeId];
}