import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath, Position} from '..'
import {CONTEXT_NODES_FOLDER} from '../constants'
import {calculateInitialPositionForChild} from '../positioning/placement/calculateInitialPosition';
import {DEFAULT_EDGE_LENGTH} from '../positioning/placement/angularPositionSeeding';
import {addOutgoingEdge} from '../graph-operations/transforms/graph-edge-operations';
import * as O from "fp-ts/lib/Option.js";
// TODO: parseMarkdownToGraphNode uses gray-matter which requires Node.js Buffer - move parsing to main process
import {parseMarkdownToGraphNode} from '../markdown-parsing/parse-markdown-to-node';
import {ensureUniqueNodeId} from '../nodes/ensureUniqueNodeId';
import {stableIdSuffix} from '../nodes/stableIdSuffix';

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
    positionOverride?: O.Option<Position>,
): GraphDelta {
    // Ensure the node ID is unique by appending _2, _3, etc. if collision exists
    const existingIds: ReadonlySet<string> = new Set(Object.keys(graph.nodes))
    const uniqueNodeId: NodeIdAndFilePath = ensureUniqueNodeId(newFilePathIsID, existingIds)

    // Parse the content to extract metadata (including isContextNode from frontmatter)
    const parsedNode: GraphNode = parseMarkdownToGraphNode(newNodeContent, uniqueNodeId, graph)

    // Create the new node, merging parsed metadata with calculated position
    const newNode: GraphNode = {
        kind: 'leaf',
        absoluteFilePathIsID: uniqueNodeId,
        outgoingEdges: parsedNode.outgoingEdges,
        contentWithoutYamlOrLinks: parsedNode.contentWithoutYamlOrLinks,
        nodeUIMetadata: {
            ...parsedNode.nodeUIMetadata,
            // Use override if provided, otherwise calculate from pure graph data
            position: positionOverride ?? calculateInitialPositionForChild(parentNode, graph, undefined, DEFAULT_EDGE_LENGTH),
        },
    }

    // Create updated parent node with edge to new child
    const updatedParentNode: GraphNode = addOutgoingEdge(parentNode, newNode.absoluteFilePathIsID)

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


/**
 * Creates a new parentless node.
 *
 * @param pos - Optional explicit position (UI drag/click sites pass this).
 *              Omit on agent-spawn sites; the daemon's
 *              resolveInitialPositionsForDelta fills in a free-slot position
 *              at apply-time, keeping authoring impurity-free.
 * @param writeFolder - Absolute path to the write directory.
 * @param graph - Current graph state (for unique-ID generation).
 */
export function createNewNodeNoParent(pos: Position | undefined, writeFolder: string, graph: Graph): { readonly newNode: GraphNode; readonly graphDelta: GraphDelta; } {
    const suffix: string = stableIdSuffix([
        writeFolder,
        pos ? String(pos.x) : 'no-pos',
        pos ? String(pos.y) : 'no-pos',
        ...Object.keys(graph.nodes).sort(),
    ])
    const candidateFileName: string = `node_${suffix}.md`
    const candidateId: string = writeFolder ? `${writeFolder}/${candidateFileName}` : candidateFileName
    const existingIds: ReadonlySet<string> = new Set(Object.keys(graph.nodes))
    const nodeId: string = ensureUniqueNodeId(candidateId, existingIds)
    const newNode: GraphNode = {
        kind: 'leaf',
        absoluteFilePathIsID: nodeId,
        outgoingEdges: [],
        contentWithoutYamlOrLinks: '# ',
        nodeUIMetadata: {
            color: O.none,
            position: pos ? O.of(pos) : O.none,
            additionalYAMLProps: {},
            isContextNode: false
        },
    }
    const graphDelta: GraphDelta = [
        {
            type: 'UpsertNode',
            nodeToUpsert: newNode,
            previousNode: O.none
        },
    ]
    return {newNode, graphDelta};
}
