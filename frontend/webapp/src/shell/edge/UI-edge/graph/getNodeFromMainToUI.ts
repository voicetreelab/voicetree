import type {Graph, GraphNode, NodeIdAndFilePath} from "@/pure/graph";
import {nodeIdToFilePathWithExtension} from "@/pure/graph/markdown-parsing";

export async function getNodeFromMainToUI(nodeId: string): Promise<GraphNode> {
    const currentGraph: Graph = await window.electronAPI?.main.getGraph() // todo just getNode()
    if (!currentGraph) {
        console.error("NO GRAPH IN STATE")
        throw Error("NO GRAPH IN STATE")
    }
    return currentGraph.nodes[nodeId];
}

export async function getFilePathForNode(nodeId: NodeIdAndFilePath): Promise<string | undefined> {
    const status: { readonly isWatching: boolean; readonly directory: string | undefined; } = await window.electronAPI?.main.getWatchStatus();
    const watchedDirectory: string | undefined = status?.directory;
    if (!watchedDirectory) {
        console.warn('[FloatingWindowManager] No watched directory available');
        return undefined;
    }

    const filename: string = nodeIdToFilePathWithExtension(nodeId);
    return `${watchedDirectory}/${filename}`;
}