// Import for global Window.electronAPI type declaration
import type {} from '@/shell/electron';
import type {
    Graph,
    GraphDelta,
    GraphNode,
    NodeIdAndFilePath,
    NodeUIMetadata,
    Position,
    UpsertNodeDelta
} from "@/pure/graph";
import {
    createDeleteNodesAction,
    createNewNodeNoParent,
    fromCreateChildToUpsertNode,
    fromContentChangeToGraphDelta
} from "@/pure/graph/graphDelta/uiInteractionsToGraphDeltas";
import type {Core} from 'cytoscape';
import {getNodeFromMainToUI} from "@/shell/edge/UI-edge/graph/getNodeFromMainToUI";
import {updateFloatingEditors} from "@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD";
import * as O from 'fp-ts/lib/Option.js';

/**
 * Merges new metadata with old metadata, preferring new values when they are "present".
 * - For Option types: use new if Some, otherwise keep old
 * - For optional fields (undefined): use new if defined, otherwise keep old
 * - For Map: use new if non-empty, otherwise keep old
 * NOTE: title is NOT stored in metadata - it's derived via getNodeTitle(node) when needed
 */
function mergeNodeUIMetadata(oldMeta: NodeUIMetadata, newMeta: NodeUIMetadata): NodeUIMetadata {
    return {
        color: O.isSome(newMeta.color) ? newMeta.color : oldMeta.color,
        position: O.isSome(newMeta.position) ? newMeta.position : oldMeta.position,
        additionalYAMLProps: newMeta.additionalYAMLProps.size > 0 ? newMeta.additionalYAMLProps : oldMeta.additionalYAMLProps,
        isContextNode: newMeta.isContextNode ?? oldMeta.isContextNode,
        containedNodeIds: newMeta.containedNodeIds ?? oldMeta.containedNodeIds,
    };
}


export async function createNewChildNodeFromUI(
    parentNodeId: string,
    cy: Core
): Promise<NodeIdAndFilePath> {

    // Get current graph state
    const currentGraph: Graph = await window.electronAPI?.main.getGraph() // todo, in memory renderer cache?
    if (!currentGraph) {
        console.error("NO GRAPH IN STATE")
        return "-1"; //todo cleaner
    }
    // Get parent node from graph
    const parentNode: GraphNode = currentGraph.nodes[parentNodeId];

    // Create GraphDelta (contains both child and updated parent with edge)
    const graphDelta: GraphDelta = fromCreateChildToUpsertNode(currentGraph, parentNode); //todo this only actually needs parent and grandparent, maybe we can have derived backlinks
    const newNode: GraphNode = (graphDelta[0] as UpsertNodeDelta).nodeToUpsert;

    // GRAPH UI CHANGE path: update editor passively BEFORE writing to FS
    // This ensures parent editor gets the wikilink before FS write (which will be skipped on read-back)
    updateFloatingEditors(cy, graphDelta);

    await window.electronAPI?.main.applyGraphDeltaToDBThroughMem(graphDelta);
    return newNode.relativeFilePathIsID;
}

export async function createNewEmptyOrphanNodeFromUI(
    pos: Position,
    _cy: Core
): Promise<NodeIdAndFilePath> {
    const {newNode, graphDelta} = createNewNodeNoParent(pos);

    await window.electronAPI?.main.applyGraphDeltaToDBThroughMem(graphDelta);

    return newNode.relativeFilePathIsID;
}

export async function modifyNodeContentFromUI(
    nodeId: NodeIdAndFilePath,
    newContent: string,
    _cy: Core,
): Promise<void> {

    // Get current graph state
    const currentNode: GraphNode = await getNodeFromMainToUI(nodeId);
    const currentGraph: Graph = await window.electronAPI?.main.getGraph();
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
    const mergedMetadata: NodeUIMetadata = mergeNodeUIMetadata(currentNode.nodeUIMetadata, newNodeFromContentChange.nodeUIMetadata);
    const nodeWithMergedMetadata: GraphNode = {...newNodeFromContentChange, nodeUIMetadata: mergedMetadata};

    const graphDelta: GraphDelta = [{
        type: 'UpsertNode',
        nodeToUpsert: nodeWithMergedMetadata,
        previousNode: upsertAction.previousNode  // Preserve previousNode from the delta
    }];

    // Editor path: MEM + GraphUI + FS, editors updated via broadcast but deduplication prevents loop
    await window.electronAPI?.main.applyGraphDeltaToDBThroughMem(graphDelta);
}

/**
 * Deletes multiple nodes in a single delta for atomic undo.
 */
export async function deleteNodesFromUI(
    nodeIds: ReadonlyArray<NodeIdAndFilePath>,
    _cy: Core
): Promise<void> {
    // Fetch all nodes in parallel for undo support
    const nodesToDelete: Array<{nodeId: string; deletedNode: GraphNode}> = await Promise.all(
        nodeIds.map(async (nodeId) => ({
            nodeId,
            deletedNode: await getNodeFromMainToUI(nodeId)
        }))
    );

    // Create single GraphDelta for all deletions
    const graphDelta: GraphDelta = createDeleteNodesAction(nodesToDelete);

    await window.electronAPI?.main.applyGraphDeltaToDBThroughMem(graphDelta);
}

