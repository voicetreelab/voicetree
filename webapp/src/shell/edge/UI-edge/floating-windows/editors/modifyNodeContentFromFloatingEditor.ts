import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath, NodeUIMetadata, UpsertNodeDelta} from "@vt/graph-model/pure/graph";
import type {Core} from "cytoscape";
import {fromContentChangeToGraphDelta} from "@vt/graph-model/pure/graph/graphDelta/uiInteractionsToGraphDeltas";
import {parseMarkdownToGraphNode} from "@vt/graph-model/pure/graph/markdown-parsing";
import * as O from 'fp-ts/lib/Option.js';
import {mergeNodeUIMetadata} from "@/shell/edge/UI-edge/graph/handleUIActions";
// Import to make Window.electronAPI type available
import type {} from '@/shell/electron';

export function resolveFolderSaveTarget(nodeId: NodeIdAndFilePath): NodeIdAndFilePath {
    return nodeId.endsWith('/') ? `${nodeId}index.md` as NodeIdAndFilePath : nodeId;
}

export async function modifyNodeContentFromUI(
    nodeId: NodeIdAndFilePath,
    newContent: string,
    _cy: Core,
    updateEditors: boolean = false,
): Promise<void> {
    const currentGraph: Graph | undefined = await window.electronAPI?.main.getGraph();
    if (!currentGraph) {
        console.error("NO GRAPH IN STATE");
        return;
    }

    const effectiveNodeId: NodeIdAndFilePath = resolveFolderSaveTarget(nodeId);
    const existingNode: GraphNode | undefined = currentGraph.nodes[effectiveNodeId];

    let graphDelta: GraphDelta;
    if (existingNode) {
        // Create GraphDelta with previousNode for undo support and recent tabs filtering.
        const graphDeltaFromContent: GraphDelta = fromContentChangeToGraphDelta(existingNode, newContent, currentGraph);

        // Need to merge metadata since fromContentChangeToGraphDelta uses parseMarkdownToGraphNode
        // which doesn't preserve position and other metadata from the original node.
        const upsertAction: GraphDelta[0] = graphDeltaFromContent[0]; // todo avoid assuming array index
        if (upsertAction.type !== 'UpsertNode') {
            throw new Error('Expected UpsertNode action');
        }
        const newNodeFromContentChange: GraphNode = upsertAction.nodeToUpsert;
        console.log('[modifyNodeContent] input length:', newContent.length, '→ parsed contentWithoutYamlOrLinks length:', newNodeFromContentChange.contentWithoutYamlOrLinks.length);

        // Merge metadata: use new values where present, fall back to old values for missing fields (e.g., position)
        const mergedMetadata: NodeUIMetadata = mergeNodeUIMetadata(existingNode.nodeUIMetadata, newNodeFromContentChange.nodeUIMetadata); // todo, suss, doesn't account for every metadata, but spread should handle that fine
        const nodeWithMergedMetadata: GraphNode = {...newNodeFromContentChange, nodeUIMetadata: mergedMetadata};

        graphDelta = [{
            type: 'UpsertNode',
            nodeToUpsert: nodeWithMergedMetadata,
            previousNode: upsertAction.previousNode  // Preserve previousNode from the delta
        }];
    } else {
        const newNode: GraphNode = parseMarkdownToGraphNode(newContent, effectiveNodeId, currentGraph);
        const upsertAction: UpsertNodeDelta = {
            type: 'UpsertNode',
            nodeToUpsert: newNode,
            previousNode: O.none,
        };
        graphDelta = [upsertAction];
    }

    // When called from editor onChange: use MEM + GraphUI + FS only (no editor update to avoid duplication)
    // When called from external sources (workflow injection): also update editors so open editors reflect the change
    if (updateEditors) {
        await window.electronAPI?.main.applyGraphDeltaToDBThroughMemUIAndEditorExposed(graphDelta);
    } else {
        await window.electronAPI?.main.applyGraphDeltaToDBThroughMemAndUIExposed(graphDelta);
    }
}
