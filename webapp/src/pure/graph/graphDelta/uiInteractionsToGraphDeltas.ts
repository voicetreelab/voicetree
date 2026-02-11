import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath, Position} from '@/pure/graph'
import {CONTEXT_NODES_FOLDER} from '@/pure/graph'
import {calculateInitialPositionForChild} from "@/pure/graph/positioning/calculateInitialPosition";
import {DEFAULT_EDGE_LENGTH} from "@/pure/graph/positioning/angularPositionSeeding";
import {addOutgoingEdge} from "@/pure/graph/graph-operations/graph-edge-operations";
import * as O from "fp-ts/lib/Option.js";
// TODO: parseMarkdownToGraphNode uses gray-matter which requires Node.js Buffer - move parsing to main process
import {parseMarkdownToGraphNode} from "@/pure/graph/markdown-parsing/parse-markdown-to-node";
import {ensureUniqueNodeId} from "@/pure/graph/ensureUniqueNodeId";

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
    const parentPathWithoutCtxNodes: string = parentNode.absoluteFilePathIsID.replace(ctxNodesFolderPattern, '$1')
    return parentPathWithoutCtxNodes.replace(/\.md$/, '') + '_' + parentNode.outgoingEdges.length + ".md"
}

// human
// Creates a new child node and returns deltas for both the child and updated parent
export function fromCreateChildToUpsertNode(
    graph: Graph,
    parentNode: GraphNode,
    newNodeContent: string = "# ",
    newFilePathIsID: NodeIdAndFilePath = generateChildNodeId(parentNode),
): GraphDelta {
    // Ensure the node ID is unique by appending _2, _3, etc. if collision exists
    const existingIds: ReadonlySet<string> = new Set(Object.keys(graph.nodes))
    const uniqueNodeId: NodeIdAndFilePath = ensureUniqueNodeId(newFilePathIsID, existingIds)

    // Parse the content to extract metadata (including isContextNode from frontmatter)
    const parsedNode: GraphNode = parseMarkdownToGraphNode(newNodeContent, uniqueNodeId, graph)

    // Create the new node, merging parsed metadata with calculated position
    const newNode: GraphNode = {
        absoluteFilePathIsID: uniqueNodeId,
        outgoingEdges: parsedNode.outgoingEdges,
        contentWithoutYamlOrLinks: parsedNode.contentWithoutYamlOrLinks,
        nodeUIMetadata: {
            ...parsedNode.nodeUIMetadata,
            // Use calculated position (not specified by content)
            position: calculateInitialPositionForChild(parentNode, graph, undefined, DEFAULT_EDGE_LENGTH),
        },
    }

    // Create updated parent node with edge to new child
    const updatedParentNode: GraphNode = addOutgoingEdge(parentNode, newNode.absoluteFilePathIsID)

    //console.log("new node / parent node", newNode.absoluteFilePathIsID, parentNode.absoluteFilePathIsID)

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
    const previousNode: O.Option<GraphNode> = O.fromNullable(graph.nodes[node.absoluteFilePathIsID])
    // Extract wikilinks from new content and update outgoingEdges
    // This ensures markdown is the source of truth for edges
    const nodeUpdated: GraphNode = parseMarkdownToGraphNode(content, node.absoluteFilePathIsID, graph)
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
export function createDeleteNodesAction(nodesToDelete: ReadonlyArray<{readonly nodeId: string; readonly deletedNode?: GraphNode}>): GraphDelta {
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

/**
 * Creates a new node without a parent at the specified position.
 * Node IDs are absolute paths to simplify path handling throughout the codebase.
 *
 * @param pos - Position where the node should be placed
 * @param writePath - Absolute path to the write directory (where new nodes are created)
 * @param graph - Current graph state (for uniqueness check)
 */
export function createNewNodeNoParent(pos: Position, writePath: string, graph: Graph): { readonly newNode: GraphNode; readonly graphDelta: GraphDelta; } {
    const randomId: string = Date.now().toString() + randomChars(3) + ".md"
    // Node ID is the absolute path to the file
    const candidateId: string = writePath ? `${writePath}/${randomId}` : randomId
    // Ensure unique even with timestamp+random (defensive check)
    const existingIds: ReadonlySet<string> = new Set(Object.keys(graph.nodes))
    const nodeId: string = ensureUniqueNodeId(candidateId, existingIds)
    const newNode: GraphNode = {
        absoluteFilePathIsID: nodeId,
        outgoingEdges: [],
        contentWithoutYamlOrLinks: '# ',
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