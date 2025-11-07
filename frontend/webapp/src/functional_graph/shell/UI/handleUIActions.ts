import type {GraphDelta, GraphNode, NodeId} from "@/functional_graph/pure/types.ts";
import {
    fromContentChangeToGraphDelta,
    fromUICreateChildToUpsertNode
} from "@/functional_graph/pure/graphDelta/uiInteractionsToGraphDeltas.ts";
import type {Core} from 'cytoscape';
import {applyGraphDeltaToUI} from "./applyGraphDeltaToUI.ts";
import type {} from '@/types/electron';
import {getNodeFromUI} from "@/functional_graph/shell/UI/getNodeFromUI.ts"; // Import to load global Window extensions


export async function createNewChildNodeFromUI(
    parentNodeId: string,
    cy: Core
): Promise<void> {

    // Get current graph state
    const currentGraph = await window.electronAPI?.graph.getState() // todo, in memory renderer cache?
    if (!currentGraph) {
        console.error("NO GRAPH IN STATE")
        return;
    }
    // Get parent node from graph
    const parentNode : GraphNode = currentGraph.nodes[parentNodeId];

    // Create GraphDelta (contains both child and updated parent with edge)
    const graphDelta: GraphDelta = fromUICreateChildToUpsertNode(currentGraph, parentNode); //todo this only actually needs parent and grandparent, maybe we can have derived backlinks

    // Optimistic UI update: immediately add node + edge to cytoscape
    applyGraphDeltaToUI(cy, graphDelta);

    await window.electronAPI?.graph.applyGraphDelta(graphDelta);
}

export async function modifyNodeContentFromUI(
    nodeId: NodeId,
    newContent: string,
): Promise<void> {

    // Get current graph state
    const currentNode = await getNodeFromUI(nodeId);

    // Create GraphDelta (contains both child and updated parent with edge)
    const graphDelta: GraphDelta = fromContentChangeToGraphDelta(currentNode, newContent);

    // NO OPTIMISTIC UI update. let fs event handle.
    await window.electronAPI?.graph.applyGraphDelta(graphDelta);
}

