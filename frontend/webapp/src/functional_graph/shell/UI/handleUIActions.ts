import type {
    GraphDelta,
    GraphNode,
    NodeId,
    Position,
    UpsertNodeAction
} from "@/functional_graph/pure/types.ts";
import {
    fromContentChangeToGraphDelta,
    fromUICreateChildToUpsertNode,
    createDeleteNodeAction
} from "@/functional_graph/pure/graphDelta/uiInteractionsToGraphDeltas.ts";
import type {Core} from 'cytoscape';
import {applyGraphDeltaToUI} from "./applyGraphDeltaToUI.ts";
import type {} from '@/types/electron';
import {getNodeFromUI} from "@/functional_graph/shell/UI/getNodeFromUI.ts";
import * as O from "fp-ts/Option";


export async function createNewChildNodeFromUI(
    parentNodeId: string,
    cy: Core
): Promise<NodeId> {

    // Get current graph state
    const currentGraph = await window.electronAPI?.graph.getState() // todo, in memory renderer cache?
    if (!currentGraph) {
        console.error("NO GRAPH IN STATE")
        return "-1"; //todo cleaner
    }
    // Get parent node from graph
    const parentNode : GraphNode = currentGraph.nodes[parentNodeId];

    // Create GraphDelta (contains both child and updated parent with edge)
    const graphDelta: GraphDelta = fromUICreateChildToUpsertNode(currentGraph, parentNode); //todo this only actually needs parent and grandparent, maybe we can have derived backlinks
    const newNode : GraphNode = (graphDelta[0] as UpsertNodeAction).nodeToUpsert;

    // Optimistic UI update: immediately add node + edge to cytoscape
    applyGraphDeltaToUI(cy, graphDelta);

    await window.electronAPI?.graph.applyGraphDelta(graphDelta);
    return newNode.relativeFilePathIsID;
}

function randomChars(number: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: number }, () =>
        chars.charAt(Math.floor(Math.random() * chars.length))
    ).join('');
}

export async function createNewEmptyOrphanNodeFromUI(
    pos: Position,
    cy: Core
): Promise<NodeId> {
    const newNode: GraphNode = {
        relativeFilePathIsID: Date.now().toString() + randomChars(3), // file with current date time + 3 random characters , //todo doesn't guarantee uniqueness, but tis good enough
        outgoingEdges: [],
        content: '# New Node',
        nodeUIMetadata: {
            color: O.none,
            position: O.of(pos)
        },
    }
    const graphDelta : GraphDelta = [
        {
            type: 'UpsertNode',
            nodeToUpsert: newNode
        },
        ]
    // Optimistic UI update: immediately add node + edge to cytoscape
    applyGraphDeltaToUI(cy, graphDelta);

    await window.electronAPI?.graph.applyGraphDelta(graphDelta);

    return newNode.relativeFilePathIsID;
}

export async function modifyNodeContentFromUI(
    nodeId: NodeId,
    newContent: string,
    cy?: Core,
): Promise<void> {

    // Get current graph state
    const currentNode = await getNodeFromUI(nodeId);
    const currentGraph = await window.electronAPI?.graph.getState();
    if (!currentGraph) {
        console.error("NO GRAPH IN STATE");
        return;
    }

    // Create GraphDelta with updated edges based on new content
    const graphDelta: GraphDelta = fromContentChangeToGraphDelta(currentNode, newContent, currentGraph);

    // Optimistic UI update for edge changes (if cy provided)
    if (cy) {
        applyGraphDeltaToUI(cy, graphDelta);
    }

    await window.electronAPI?.graph.applyGraphDelta(graphDelta);
}

export async function deleteNodeFromUI(
    nodeId: NodeId,
    cy: Core
): Promise<void> {
    // Create GraphDelta for deletion
    const graphDelta: GraphDelta = createDeleteNodeAction(nodeId);

    // Optimistic UI update: immediately remove node from cytoscape
    applyGraphDeltaToUI(cy, graphDelta);

    await window.electronAPI?.graph.applyGraphDelta(graphDelta);
}

