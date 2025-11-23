import type {GraphDelta, GraphNode, NodeIdAndFilePath, Position, UpsertNodeAction} from "@/pure/graph";
import {
    createDeleteNodeAction,
    createNewNodeNoParent,
    fromContentChangeToGraphDelta,
    fromCreateChildToUpsertNode
} from "@/pure/graph/graphDelta/uiInteractionsToGraphDeltas.ts";
import type {Core} from 'cytoscape';
import {applyGraphDeltaToUI} from "./applyGraphDeltaToUI.ts";
import {getNodeFromMainToUI} from "@/shell/edge/UI-edge/graph/getNodeFromMainToUI.ts";


export async function createNewChildNodeFromUI(
    parentNodeId: string,
    cy: Core
): Promise<NodeIdAndFilePath> {

    // Get current graph state
    const currentGraph = await window.electronAPI?.main.getGraph() // todo, in memory renderer cache?
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

    await window.electronAPI?.main.applyGraphDeltaToDBAndMem(graphDelta);
    return newNode.relativeFilePathIsID;
}

export async function createNewEmptyOrphanNodeFromUI(
    pos: Position,
    cy: Core
): Promise<NodeIdAndFilePath> {
    const {newNode, graphDelta} = createNewNodeNoParent(pos);
    // Optimistic UI-edge update: immediately add node + edge to cytoscape
    applyGraphDeltaToUI(cy, graphDelta);

    await window.electronAPI?.main.applyGraphDeltaToDBAndMem(graphDelta);

    return newNode.relativeFilePathIsID;
}

export async function modifyNodeContentFromUI(
    nodeId: NodeIdAndFilePath,
    newContent: string,
    cy: Core,
): Promise<void> {

    // Get current graph state
    const currentNode = await getNodeFromMainToUI(nodeId);
    const currentGraph = await window.electronAPI?.main.getGraph();
    if (!currentGraph) {
        console.error("NO GRAPH IN STATE");
        return;
    }

    // Create GraphDelta with updated edges based on new content
    const graphDelta: GraphDelta = fromContentChangeToGraphDelta(currentNode, newContent, currentGraph);

    // Optimistic UI-edge update for edge changes
    applyGraphDeltaToUI(cy, graphDelta);

    await window.electronAPI?.main.applyGraphDeltaToDBAndMem(graphDelta);
}

export async function deleteNodeFromUI(
    nodeId: NodeIdAndFilePath,
    cy: Core
): Promise<void> {
    // Create GraphDelta for deletion
    const graphDelta: GraphDelta = createDeleteNodeAction(nodeId);

    // Optimistic UI-edge update: immediately remove node from cytoscape
    applyGraphDeltaToUI(cy, graphDelta);

    await window.electronAPI?.main.applyGraphDeltaToDBAndMem(graphDelta);
}

