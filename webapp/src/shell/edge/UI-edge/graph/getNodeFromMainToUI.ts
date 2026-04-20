import type {GraphNode, NodeIdAndFilePath} from "@vt/graph-model/pure/graph";
import {nodeIdToFilePathWithExtension} from "@vt/graph-model/pure/graph/markdown-parsing";
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

export async function getNodeFromMainToUIOrNull(nodeId: string): Promise<GraphNode | null> {
    const node: GraphNode | undefined = await window.electronAPI?.main.getNode(nodeId);
    return node ?? null;
}

/**
 * Get the absolute file path for a node.
 *
 * Since the multivault refactor, node IDs are absolute paths.
 * This function just ensures the .md extension is present.
 */
export function getFilePathForNode(nodeId: NodeIdAndFilePath): string {
    return nodeIdToFilePathWithExtension(nodeId);
}
