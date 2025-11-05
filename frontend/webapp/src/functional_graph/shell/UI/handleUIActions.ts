import type {Graph, GraphDelta, Node} from "@/functional_graph/pure/types.ts";
import {fromUICreateChildToUpsertNode} from "@/functional_graph/pure/uiInteractionsToGraphDeltas.ts";
import type {Core} from 'cytoscape';


function applyDeltaToUI(cy: Core, delta: GraphDelta, parentNodeId: string): Node {
    // Delta contains [childNode, updatedParentNode]
    const childNodeAction = delta[0];
    if (childNodeAction.type !== 'UpsertNode') {
        throw new Error('Expected UpsertNode action for child');
    }

    const newNode = childNodeAction.nodeToUpsert;
    const newNodePosition = newNode.nodeUIMetadata.position;

    cy.batch(() => {
        // Add the new node
        cy.add({
            group: 'nodes' as const,
            data: {
                id: newNode.idAndFilePath,
                label: newNode.idAndFilePath,
                content: newNode.content,
                summary: ''
            },
            position: {
                x: newNodePosition.x,
                y: newNodePosition.y
            }
        });

        // Add edge from parent to new child
        cy.add({
            group: 'edges' as const,
            data: {
                id: `${parentNodeId}-${newNode.idAndFilePath}`,
                source: parentNodeId,
                target: newNode.idAndFilePath
            }
        });
    });

    return newNode;
}

export async function createNewChildNodeFromUI(
    parentNodeId: string,
    cy: Core
): Promise<void> {

    // Get current graph state
    const currentGraph: Graph = await window.electronAPI?.graph.getState() // todo, in memory renderer cache?

    // Get parent node from graph
    const parentNode = currentGraph.nodes[parentNodeId];

    // Create GraphDelta (contains both child and updated parent with edge)
    const graphDelta: GraphDelta = fromUICreateChildToUpsertNode(currentGraph, parentNode);

    // Optimistic UI update: immediately add node + edge to cytoscape
    const newNode = applyDeltaToUI(cy, graphDelta, parentNodeId);

    console.log('[ContextMenuService] Applied optimistic update for new child node:', newNode.idAndFilePath);

    await window.electronAPI?.graph.applyGraphDelta(graphDelta);
}

