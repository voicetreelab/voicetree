import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath, Position} from '@/pure/graph'
import {CONTEXT_NODES_FOLDER} from '@/pure/graph'
import {calculateInitialPositionForChild} from "@/pure/graph/positioning/calculateInitialPosition";
import {addOutgoingEdge} from "@/pure/graph/graph-operations/graph-edge-operations";
import * as O from "fp-ts/lib/Option.js";
// TODO: parseMarkdownToGraphNode uses gray-matter which requires Node.js Buffer - move parsing to main process
import {parseMarkdownToGraphNode} from "@/pure/graph/markdown-parsing/parse-markdown-to-node";

/**
 * Pure action creator functions.
 *
 * These functions are PURE - they have no side effects and always
 * return the same output for the same input.
 *
 * They create well-formed action objects that can be sent to the main process.
 */

/**
 * Generates a child node ID from the parent node's path.
 * Strips ctx-nodes/ folder from the path so children of context nodes
 * are placed in the regular folder structure, not in ctx-nodes/.
 *
 * @example
 * // Regular node - child stays in same folder
 * generateChildNodeId({ relativeFilePathIsID: 'tuesday/node.md', outgoingEdges: [] })
 * // => 'tuesday/node_0.md'
 *
 * @example
 * // Context node - child is placed OUTSIDE ctx-nodes/
 * generateChildNodeId({ relativeFilePathIsID: 'tuesday/ctx-nodes/context.md', outgoingEdges: [] })
 * // => 'tuesday/context_0.md'
 *
 * @example
 * // Root-level ctx-nodes - child goes to root
 * generateChildNodeId({ relativeFilePathIsID: 'ctx-nodes/context.md', outgoingEdges: [] })
 * // => 'context_0.md'
 */
export function generateChildNodeId(parentNode: GraphNode): NodeIdAndFilePath {
    // Strip ctx-nodes/ from path so children of context nodes don't end up in ctx-nodes/
    // Matches both "ctx-nodes/..." and ".../ctx-nodes/..."
    const ctxNodesFolderPattern: RegExp = new RegExp(`(^|/)${CONTEXT_NODES_FOLDER}/`, 'g')
    const parentPathWithoutCtxNodes: string = parentNode.relativeFilePathIsID.replace(ctxNodesFolderPattern, '$1')
    return parentPathWithoutCtxNodes.replace(/\.md$/, '') + '_' + parentNode.outgoingEdges.length + ".md"
}

// human
// Creates a new child node and returns deltas for both the child and updated parent
export function fromCreateChildToUpsertNode(
    graph: Graph,
    parentNode: GraphNode,
    newNodeContent: string = "# new",
    newFilePathIsID: NodeIdAndFilePath = generateChildNodeId(parentNode),
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
            position: calculateInitialPositionForChild(parentNode, graph, undefined, 100),
        },
    }

    // Create updated parent node with edge to new child
    const updatedParentNode: GraphNode = addOutgoingEdge(parentNode, newNode.relativeFilePathIsID)

    console.log("new node / parent node", newNode.relativeFilePathIsID, parentNode.relativeFilePathIsID)

    // Return deltas for both the new child and the updated parent
    return [
        {
            type: 'UpsertNode',
            nodeToUpsert: newNode,
            previousNode: O.none  // New node - no previous state
        },
        {
            type: 'UpsertNode',
            nodeToUpsert: updatedParentNode,
            previousNode: O.some(parentNode)  // Capture parent's state before edge was added
        }
    ]
}


export function fromContentChangeToGraphDelta(
    node: GraphNode,
    content: string,
    graph: Graph,
): GraphDelta {
    // Look up current state from graph for previousNode
    const previousNode: O.Option<GraphNode> = O.fromNullable(graph.nodes[node.relativeFilePathIsID])
    // Extract wikilinks from new content and update outgoingEdges
    // This ensures markdown is the source of truth for edges
    const nodeUpdated: GraphNode = parseMarkdownToGraphNode(content, node.relativeFilePathIsID, graph)
    // todo review if this new logic works
    return [{
        type: 'UpsertNode',
        nodeToUpsert: nodeUpdated,
        previousNode  // Capture what it was before
    }]
}

/**
 * Creates DeleteNode actions for multiple nodes in a single delta.
 * This enables atomic undo for batch deletions.
 *
 * @param nodesToDelete - Array of {nodeId, deletedNode} pairs
 * @returns A single GraphDelta containing all delete actions
 */
export function createDeleteNodesAction(nodesToDelete: ReadonlyArray<{nodeId: string; deletedNode?: GraphNode}>): GraphDelta {
    return nodesToDelete.map(({nodeId, deletedNode}) => ({
        type: 'DeleteNode' as const,
        nodeId,
        deletedNode: O.fromNullable(deletedNode)
    }))
}

//todo switch between the three (?)


function randomChars(number: number): string {
    const chars: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz" = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    return Array.from({length: number}, () =>
        chars.charAt(Math.floor(Math.random() * chars.length))
    ).join('');
}

export function createNewNodeNoParent(pos: Position, vaultSuffix: string): { readonly newNode: GraphNode; readonly graphDelta: GraphDelta; } {
    const randomId: string = Date.now().toString() + randomChars(3) + ".md"
    // Node ID must include vault suffix so path.join(watchedDirectory, nodeId) produces correct absolute path
    const nodeId: string = vaultSuffix ? `${vaultSuffix}/${randomId}` : randomId
    const newNode: GraphNode = {
        relativeFilePathIsID: nodeId,
        outgoingEdges: [],
        contentWithoutYamlOrLinks: '# New',
        nodeUIMetadata: {
            // NOTE: title is derived via getNodeTitle from contentWithoutYamlOrLinks
            color: O.none,
            position: O.of(pos),
            additionalYAMLProps: new Map(),
            isContextNode: false
        },
    }
    const graphDelta: GraphDelta = [
        {
            type: 'UpsertNode',
            nodeToUpsert: newNode,
            previousNode: O.none  // New node - no previous state
        },
    ]
    return {newNode, graphDelta};
}