import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath, NodeUIMetadata} from "@/pure/graph";
import type {Core} from "cytoscape";
import {getNodeFromMainToUI} from "@/shell/edge/UI-edge/graph/getNodeFromMainToUI";
import {fromContentChangeToGraphDelta} from "@/pure/graph/graphDelta/uiInteractionsToGraphDeltas";
import {mergeNodeUIMetadata} from "@/shell/edge/UI-edge/graph/handleUIActions";
// Import to make Window.electronAPI type available
import type {} from '@/shell/electron';

export async function modifyNodeContentFromUI(
    nodeId: NodeIdAndFilePath,
    newContent: string,
    _cy: Core,
): Promise<void> {

    // Get current graph state
    const currentNode: GraphNode = await getNodeFromMainToUI(nodeId);
    const currentGraph: Graph | undefined = await window.electronAPI?.main.getGraph();
    if (!currentGraph) {
        console.error("NO GRAPH IN STATE");
        return;
    }

    // Create GraphDelta with previousNode for undo support and recent tabs filtering
    const graphDeltaFromContent: GraphDelta = fromContentChangeToGraphDelta(currentNode, newContent, currentGraph);

    // Need to merge metadata since fromContentChangeToGraphDelta uses parseMarkdownToGraphNode
    // which doesn't preserve position and other metadata from the original node
    const upsertAction: GraphDelta[0] = graphDeltaFromContent[0]; //todo avoid assuming array index
    if (upsertAction.type !== 'UpsertNode') {
        throw new Error('Expected UpsertNode action');
    }
    const newNodeFromContentChange: GraphNode = upsertAction.nodeToUpsert;

    // Merge metadata: use new values where present, fall back to old values for missing fields (e.g., position)
    const mergedMetadata: NodeUIMetadata = mergeNodeUIMetadata(currentNode.nodeUIMetadata, newNodeFromContentChange.nodeUIMetadata); // todo, suss, doesn't account for every metadata, but spread should handle that fine
    const nodeWithMergedMetadata: GraphNode = {...newNodeFromContentChange, nodeUIMetadata: mergedMetadata};

    const graphDelta: GraphDelta = [{
        type: 'UpsertNode',
        nodeToUpsert: nodeWithMergedMetadata,
        previousNode: upsertAction.previousNode  // Preserve previousNode from the delta
    }];

    // Editor path: MEM + GraphUI + FS, editors updated via broadcast but deduplication prevents loop
    await window.electronAPI?.main.applyGraphDeltaToDBThroughMemAndUIExposed(graphDelta);
}