import type {GraphNode, NodeIdAndFilePath} from "@vt/graph-model/graph";
import {nodeIdToFilePathWithExtension} from "@vt/graph-model/markdown";
// Import to make Window.hostAPI type available
import type {} from '@/shell/hostApi';

export async function getNodeFromMainToUI(nodeId: string): Promise<GraphNode> {
    const node: GraphNode | undefined = await window.hostAPI?.main.getNode(nodeId);
    if (!node) {
        console.error("NODE NOT FOUND IN GRAPH:", nodeId);
        throw Error(`NODE NOT FOUND IN GRAPH: ${nodeId}`);
    }
    return node;
}

export async function getNodeFromMainToUIOrNull(nodeId: string): Promise<GraphNode | null> {
    const node: GraphNode | undefined = await window.hostAPI?.main.getNode(nodeId);
    return node ?? null;
}

/**
 * Get the absolute file path for a node.
 *
 * Since the multiproject refactor, node IDs are absolute paths.
 * This function just ensures the .md extension is present.
 */
export function getFilePathForNode(nodeId: NodeIdAndFilePath): string {
    return nodeIdToFilePathWithExtension(nodeId);
}
