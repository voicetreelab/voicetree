import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath, NodeUIMetadata, Position, UpsertNodeAction} from "@/pure/graph";
import {
    createDeleteNodeAction,
    createNewNodeNoParent,
    fromCreateChildToUpsertNode
} from "@/pure/graph/graphDelta/uiInteractionsToGraphDeltas";
import type {Core} from 'cytoscape';
import {applyGraphDeltaToUI} from "./applyGraphDeltaToUI";
import {parseMarkdownToGraphNode} from "@/pure/graph/markdown-parsing";
import {getNodeFromMainToUI} from "@/shell/edge/UI-edge/graph/getNodeFromMainToUI";
import * as O from 'fp-ts/lib/Option.js';

/**
 * Merges new metadata with old metadata, preferring new values when they are "present".
 * - For Option types: use new if Some, otherwise keep old
 * - For optional fields (undefined): use new if defined, otherwise keep old
 * - For title (always present): always use new
 * - For Map: use new if non-empty, otherwise keep old
 */
function mergeNodeUIMetadata(oldMeta: NodeUIMetadata, newMeta: NodeUIMetadata): NodeUIMetadata {
    return {
        title: newMeta.title, // title is always computed from content, always use new
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
    const currentGraph: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").Graph = await window.electronAPI?.main.getGraph() // todo, in memory renderer cache?
    if (!currentGraph) {
        console.error("NO GRAPH IN STATE")
        return "-1"; //todo cleaner
    }
    // Get parent node from graph
    const parentNode: GraphNode = currentGraph.nodes[parentNodeId];

    // Create GraphDelta (contains both child and updated parent with edge)
    const graphDelta: GraphDelta = fromCreateChildToUpsertNode(currentGraph, parentNode); //todo this only actually needs parent and grandparent, maybe we can have derived backlinks
    const newNode: GraphNode = (graphDelta[0] as UpsertNodeAction).nodeToUpsert;

    // Optimistic UI-edge update: immediately add node + edge to cytoscape
    applyGraphDeltaToUI(cy, graphDelta);

    await window.electronAPI?.main.applyGraphDeltaToDBThroughMem(graphDelta);
    return newNode.relativeFilePathIsID;
}

export async function createNewEmptyOrphanNodeFromUI(
    pos: Position,
    cy: Core
): Promise<NodeIdAndFilePath> {
    const {newNode, graphDelta} = createNewNodeNoParent(pos);
    // Optimistic UI-edge update: immediately add node + edge to cytoscape
    applyGraphDeltaToUI(cy, graphDelta);

    await window.electronAPI?.main.applyGraphDeltaToDBThroughMem(graphDelta);

    return newNode.relativeFilePathIsID;
}

function nodeToDelta(graphNode: GraphNode) : GraphDelta {
    return [{type: 'UpsertNode', nodeToUpsert: graphNode}];
}

export async function modifyNodeContentFromUI(
    nodeId: NodeIdAndFilePath,
    newContent: string,
    cy: Core,
): Promise<void> {

    // // Get current graph state
    const currentNode: GraphNode = await getNodeFromMainToUI(nodeId);
    const currentGraph: Graph = await window.electronAPI?.main.getGraph();
    if (!currentGraph) {
        console.error("NO GRAPH IN STATE");
        return;
    }

    // Create GraphDelta with updated edges based on new content
    const newNodeFromContentChange : GraphNode = parseMarkdownToGraphNode(newContent, nodeId, currentGraph)

    // Merge metadata: use new values where present, fall back to old values for missing fields (e.g., position)
    const mergedMetadata: NodeUIMetadata = mergeNodeUIMetadata(currentNode.nodeUIMetadata, newNodeFromContentChange.nodeUIMetadata);
    const nodeWithMergedMetadata : GraphNode = {...newNodeFromContentChange, nodeUIMetadata: mergedMetadata};

    const graphDelta : GraphDelta = nodeToDelta(nodeWithMergedMetadata)

    // Optimistic UI-edge update for edge changes
    applyGraphDeltaToUI(cy, graphDelta);

    await window.electronAPI?.main.applyGraphDeltaToDBThroughMem(graphDelta);
}

export async function deleteNodeFromUI(
    nodeId: NodeIdAndFilePath,
    cy: Core
): Promise<void> {
    // Create GraphDelta for deletion
    const graphDelta: GraphDelta = createDeleteNodeAction(nodeId);

    // Optimistic UI-edge update: immediately remove node from cytoscape
    applyGraphDeltaToUI(cy, graphDelta);

    await window.electronAPI?.main.applyGraphDeltaToDBThroughMem(graphDelta);
}

