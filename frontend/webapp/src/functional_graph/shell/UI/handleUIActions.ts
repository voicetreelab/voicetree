import type {GraphDelta} from "@/functional_graph/pure/types.ts";
import {fromUICreateChildToUpsertNode} from "@/functional_graph/pure/graphDelta/uiInteractionsToGraphDeltas.ts";
import type {Core} from 'cytoscape';
import {applyGraphDeltaToUI} from "./applyGraphDeltaToUI.ts";
import type {} from '@/types/electron'; // Import to load global Window extensions


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
    const parentNode = currentGraph.nodes[parentNodeId];

    // Create GraphDelta (contains both child and updated parent with edge)
    const graphDelta: GraphDelta = fromUICreateChildToUpsertNode(currentGraph, parentNode);

    // Optimistic UI update: immediately add node + edge to cytoscape
    applyGraphDeltaToUI(cy, graphDelta);

    console.log('[ContextMenuService] Applied optimistic update for new child node');

    await window.electronAPI?.graph.applyGraphDelta(graphDelta);
}

