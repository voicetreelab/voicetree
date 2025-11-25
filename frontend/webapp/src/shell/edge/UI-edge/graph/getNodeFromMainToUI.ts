import type {GraphNode, NodeIdAndFilePath} from "@/pure/graph";
import {nodeIdToFilePathWithExtension} from "@/pure/graph/markdown-parsing";

export async function getNodeFromMainToUI(nodeId: string): Promise<GraphNode> {
    const currentGraph = await window.electronAPI?.main.getGraph() // todo just getNode()
    if (!currentGraph) {
        console.error("NO GRAPH IN STATE")
        throw Error("NO GRAPH IN STATE")
    }
    return currentGraph.nodes[nodeId];
}

export async function getFilePathForNode(nodeId: NodeIdAndFilePath): Promise<string | undefined> {
    const status = await window.electronAPI?.main.getWatchStatus();
    const vaultPath = status?.directory;
    if (!vaultPath) {
        console.warn('[FloatingWindowManager] No vault path available');
        return undefined;
    }

    const filename = nodeIdToFilePathWithExtension(nodeId);
    return `${vaultPath}/${filename}`;
}