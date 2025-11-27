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
    const vaultPath: string | undefined = status?.directory;
    if (!vaultPath) {
        console.warn('[FloatingWindowManager] No vault path available');
        return undefined;
    }

    const filename: string = nodeIdToFilePathWithExtension(nodeId);
    return `${vaultPath}/${filename}`;
}