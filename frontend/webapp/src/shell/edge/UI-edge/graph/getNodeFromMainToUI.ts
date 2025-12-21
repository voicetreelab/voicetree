import type {GraphNode, NodeIdAndFilePath} from "@/pure/graph";
import {nodeIdToFilePathWithExtension} from "@/pure/graph/markdown-parsing";
// Import to make Window.electronAPI type available
import type {} from '@/shell/electron';

export async function getNodeFromMainToUI(nodeId: string): Promise<GraphNode> {
    const node: GraphNode | undefined = await window.electronAPI?.main.getNode(nodeId);
    if (!node) {
        console.error("NODE NOT FOUND IN GRAPH:", nodeId);
        throw Error(`NODE NOT FOUND IN GRAPH: ${nodeId}`);
    }
    return node;
}

export async function getFilePathForNode(nodeId: NodeIdAndFilePath): Promise<string | undefined> {
    const status: { readonly isWatching: boolean; readonly directory: string | undefined; } | undefined = await window.electronAPI?.main.getWatchStatus();
    const watchedDirectory: string | undefined = status?.directory;
    if (!watchedDirectory) {
        console.warn('[FloatingWindowManager] No watched directory available');
        return undefined;
    }

    const filename: string = nodeIdToFilePathWithExtension(nodeId);
    return `${watchedDirectory}/${filename}`;
}