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

/**
 * Get the absolute file path for a node.
 *
 * Since the multivault refactor, node IDs are absolute paths.
 * This function just ensures the .md extension is present.
 */
export function getFilePathForNode(nodeId: NodeIdAndFilePath): string {
    return nodeIdToFilePathWithExtension(nodeId);
}