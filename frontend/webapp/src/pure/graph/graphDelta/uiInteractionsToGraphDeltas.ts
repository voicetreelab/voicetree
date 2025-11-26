import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath, Position} from '@/pure/graph'
import {calculateInitialPositionForChild} from "@/pure/graph/positioning/calculateInitialPosition";
import {addOutgoingEdge} from "@/pure/graph/graph-operations /graph-edge-operations";
import * as O from "fp-ts/lib/Option.js";
import {parseMarkdownToGraphNode} from "@/pure/graph/markdown-parsing/parse-markdown-to-node";

/**
 * Pure action creator functions.
 *
 * These functions are PURE - they have no side effects and always
 * return the same output for the same input.
 *
 * They create well-formed action objects that can be sent to the main process.
 */

// human
// Creates a new child node and returns deltas for both the child and updated parent
export function fromCreateChildToUpsertNode(
    graph: Graph,
    parentNode: GraphNode,
    newNodeContent: string = "# new",
    newFilePathIsID: NodeIdAndFilePath = parentNode.relativeFilePathIsID + '_' + parentNode.outgoingEdges.length + ".md", //todo doesn't guarantee uniqueness, but tis good enough
): GraphDelta {
    // Parse the content to extract metadata (including isContextNode from frontmatter)
    const parsedNode: GraphNode = parseMarkdownToGraphNode(newNodeContent, newFilePathIsID, graph)

    // Create the new node, merging parsed metadata with calculated position
    const newNode: GraphNode = {
        relativeFilePathIsID: newFilePathIsID,
        outgoingEdges: parsedNode.outgoingEdges,
        contentWithoutYamlOrLinks: parsedNode.contentWithoutYamlOrLinks,
        nodeUIMetadata: {
            ...parsedNode.nodeUIMetadata,
            // Use calculated position (not specified by content)
            position: calculateInitialPositionForChild(parentNode, graph, undefined, 200),
        },
    }

    // Create updated parent node with edge to new child
    const updatedParentNode: GraphNode = addOutgoingEdge(parentNode, newNode.relativeFilePathIsID)

    console.log("new node / parent node", newNode.relativeFilePathIsID, parentNode.relativeFilePathIsID)

    // Return deltas for both the new child and the updated parent
    return [
        {
            type: 'UpsertNode',
            nodeToUpsert: newNode
        },
        {
            type: 'UpsertNode',
            nodeToUpsert: updatedParentNode
        }
    ]
}


export function fromContentChangeToGraphDelta(
    node: GraphNode,
    content: string,
    graph: Graph,
): GraphDelta {
    // Extract wikilinks from new content and update outgoingEdges
    // This ensures markdown is the source of truth for edges
    const nodeUpdated: GraphNode = parseMarkdownToGraphNode(content, node.relativeFilePathIsID, graph)
    // todo review if this new logic works
    return [{
        type: 'UpsertNode',
        nodeToUpsert: nodeUpdated
    }]
}

/**
 * Creates a DeleteNode action.
 *
 * @param nodeId - ID of the node to delete
 * @returns A GraphDelta with the DeleteNode action
 */
export function createDeleteNodeAction(nodeId: string): GraphDelta {
    return [{
        type: 'DeleteNode',
        nodeId
    }]
}

//todo switch between the three (?)


function randomChars(number: number): string {
    const chars: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz" = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    return Array.from({length: number}, () =>
        chars.charAt(Math.floor(Math.random() * chars.length))
    ).join('');
}

export function createNewNodeNoParent(pos: Position) {
    const newNode: GraphNode = {
        relativeFilePathIsID: Date.now().toString() + randomChars(3) + ".md", // file with current date time + 3 random characters , //todo doesn't guarantee uniqueness, but tis good enough
        outgoingEdges: [],
        contentWithoutYamlOrLinks: '# New',
        nodeUIMetadata: {
            title: 'New',
            color: O.none,
            position: O.of(pos),
            additionalYAMLProps: new Map(),
            isContextNode: false
        },
    }
    const graphDelta: GraphDelta = [
        {
            type: 'UpsertNode',
            nodeToUpsert: newNode
        },
    ]
    return {newNode, graphDelta};
}