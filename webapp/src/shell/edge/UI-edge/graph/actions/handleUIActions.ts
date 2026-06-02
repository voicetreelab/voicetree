// Import for global Window.hostAPI type declaration
import type {
    Graph,
    GraphDelta,
    GraphNode,
    NodeIdAndFilePath,
    NodeUIMetadata,
    Position,
    Size,
    UpsertNodeDelta
} from "@vt/graph-model/graph";
import {
    createNewNodeNoParent,
    fromCreateChildToUpsertNode
} from "@vt/graph-model/graph";
import {deleteNodeSimple} from "@vt/graph-model/graph";
import {applyGraphDeltaToGraph} from "@vt/graph-model/graph";
import type {Core} from 'cytoscape';
import {
    updateFloatingEditors,
} from "@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD";
import {flushEditorForNode} from "@/shell/edge/UI-edge/floating-windows/editors/flushEditorForNode";
import {getEditorId} from "@/shell/edge/UI-edge/floating-windows/anchoring/types";
import {getEditorByNodeId} from "@/shell/edge/UI-edge/state/stores/EditorStore";
import {vanillaFloatingWindowInstances} from "@/shell/edge/UI-edge/state/stores/UIAppState";
import * as O from 'fp-ts/lib/Option.js';
import {calculateNodePosition} from "@vt/graph-model/spatial";
import {buildSpatialIndexFromGraph} from "@vt/graph-model/spatial";
import type {SpatialIndex} from "@vt/graph-model/spatial";
import {requestAutoPinOnCreation} from "@/shell/edge/UI-edge/graph/actions/applyGraphDeltaToUI";
import {createGraph} from "@vt/graph-model/graph";
import {parseMarkdownToGraphNode} from "@vt/graph-model/markdown";

/**
 * Merges new metadata with old metadata, preferring new values when they are "present".
 * - For Option types: use new if Some, otherwise keep old
 * - For optional fields (undefined): use new if defined, otherwise keep old
 * - For additionalYAMLProps: use new if non-empty, otherwise keep old
 * NOTE: title is NOT stored in metadata - it's derived via getNodeTitle(node) when needed
 */
export function mergeNodeUIMetadata(oldMeta: NodeUIMetadata, newMeta: NodeUIMetadata): NodeUIMetadata {
    const newSize: O.Option<Size> = newMeta.size ?? O.none;
    const oldSize: O.Option<Size> = oldMeta.size ?? O.none;
    return {
        color: O.isSome(newMeta.color) ? newMeta.color : oldMeta.color,
        position: O.isSome(newMeta.position) ? newMeta.position : oldMeta.position,
        // Size carries through exactly like position: a present (Some) new value
        // wins, otherwise the old value is preserved.
        size: O.isSome(newSize) ? newSize : oldSize,
        additionalYAMLProps: Object.keys(newMeta.additionalYAMLProps).length > 0 ? newMeta.additionalYAMLProps : oldMeta.additionalYAMLProps,
        isContextNode: newMeta.isContextNode ?? oldMeta.isContextNode,
        containedNodeIds: newMeta.containedNodeIds ?? oldMeta.containedNodeIds,
    };
}

function getOpenEditorContent(nodeId: NodeIdAndFilePath): string | null {
    const editorOption = getEditorByNodeId(nodeId);
    if (O.isNone(editorOption)) return null;

    const editorInstance: unknown = vanillaFloatingWindowInstances.get(getEditorId(editorOption.value));
    return editorInstance
        && typeof editorInstance === 'object'
        && 'getValue' in editorInstance
        && typeof editorInstance.getValue === 'function'
        ? editorInstance.getValue()
        : null;
}

function mergeOpenEditorContentIntoNode(
    node: GraphNode,
    graph: Graph,
): GraphNode {
    const editorContent: string | null = getOpenEditorContent(node.absoluteFilePathIsID);
    if (editorContent === null) return node;

    const parsedNode: GraphNode = parseMarkdownToGraphNode(editorContent, node.absoluteFilePathIsID, graph);
    return {
        ...parsedNode,
        nodeUIMetadata: mergeNodeUIMetadata(node.nodeUIMetadata, parsedNode.nodeUIMetadata),
    };
}

export async function createNewChildNodeFromUI(
    parentNodeId: string,
    cy: Core,
    spatialIndex?: SpatialIndex
): Promise<NodeIdAndFilePath> {

    await flushEditorForNode(parentNodeId as NodeIdAndFilePath);

    // Get current graph state
    const currentGraph: Graph | undefined = await window.hostAPI?.main.getGraph() // todo, in memory renderer cache?
    if (!currentGraph) {
        console.error("NO GRAPH IN STATE")
        return "-1"; //todo cleaner
    }
    const graphParentNode: GraphNode | undefined = currentGraph.nodes[parentNodeId];
    const parentNode: GraphNode | undefined = graphParentNode ?? await window.hostAPI?.main.getNode(parentNodeId);
    if (!parentNode) {
        console.error(`Cannot create child node: parent node not found (${parentNodeId})`);
        return "-1";
    }

    const graphForChildCreationBase: Graph = graphParentNode
        ? currentGraph
        : createGraph({
            ...currentGraph.nodes,
            [parentNodeId]: parentNode,
        });
    const freshParentNode: GraphNode = mergeOpenEditorContentIntoNode(parentNode, graphForChildCreationBase);
    const graphForChildCreation: Graph = createGraph({
        ...graphForChildCreationBase.nodes,
        [parentNodeId]: freshParentNode,
    });

    const spatialIndexToUse: SpatialIndex = spatialIndex ?? buildSpatialIndexFromGraph(graphForChildCreation);
    const position: Position = O.getOrElse(() => ({x: 0, y: 0}))(calculateNodePosition(graphForChildCreation, spatialIndexToUse, parentNodeId));

    // Create GraphDelta (contains both child and updated parent with edge)
    const graphDelta: GraphDelta = fromCreateChildToUpsertNode(graphForChildCreation, freshParentNode, "# ", undefined, O.some(position));
    const newNode: GraphNode = (graphDelta[0] as UpsertNodeDelta).nodeToUpsert;

    // GRAPH UI CHANGE path: update editor passively BEFORE writing to FS
    // This ensures parent editor gets the wikilink before FS write (which will be skipped on read-back)
    updateFloatingEditors(cy, graphDelta);

    // Register pending auto-pin so the new node opens in edit mode
    // when applyGraphDeltaToUI processes the delta from the IPC broadcast
    requestAutoPinOnCreation(newNode.absoluteFilePathIsID);

    await window.hostAPI?.main.applyGraphDeltaToDBThroughMemUIAndEditorExposed(graphDelta);

    return newNode.absoluteFilePathIsID;
}

export async function createNewEmptyOrphanNodeFromUI(
    pos: Position,
): Promise<NodeIdAndFilePath> {
    // Get write path (absolute) for new node creation
    const writeFolderPathOption: O.Option<string> | undefined = await window.hostAPI?.main.getWriteFolderPath();
    const writeFolderPath: string = writeFolderPathOption ? O.getOrElse(() => '')(writeFolderPathOption) : '';

    // Get current graph for collision detection
    const currentGraph: Graph | undefined = await window.hostAPI?.main.getGraph();
    if (!currentGraph) {
        console.error("NO GRAPH IN STATE");
        throw new Error("Cannot create node: graph not available");
    }

    const {newNode, graphDelta} = createNewNodeNoParent(pos, writeFolderPath, currentGraph);

    // Register pending auto-pin so the new node opens in edit mode
    requestAutoPinOnCreation(newNode.absoluteFilePathIsID);

    await window.hostAPI?.main.applyGraphDeltaToDBThroughMemUIAndEditorExposed(graphDelta);

    return newNode.absoluteFilePathIsID;
}

/**
 * Deletes multiple nodes in a single delta for atomic undo.
 * Simply removes nodes and cleans up parent edges — no transitive edge healing.
 *
 * When deleting multiple connected nodes, we process deletions iteratively
 * so each deletion sees the result of previous ones (for correct parent edge cleanup).
 */
export async function deleteNodesFromUI(
    nodeIds: ReadonlyArray<NodeIdAndFilePath>,
    cy: Core
): Promise<void> {
    const currentGraph: Graph | undefined = await window.hostAPI?.main.getGraph()
    if (!currentGraph) {
        console.error("NO GRAPH IN STATE")
        return
    }

    const nodeIdsToDelete: ReadonlySet<NodeIdAndFilePath> = new Set(nodeIds)

    let allDeltas: GraphDelta = []
    let workingGraph: Graph = currentGraph

    for (const nodeId of nodeIds) {
        if (!workingGraph.nodes[nodeId]) {
            continue
        }

        const delta: GraphDelta = deleteNodeSimple(workingGraph, nodeId)

        workingGraph = applyGraphDeltaToGraph(workingGraph, delta)

        // Filter out UpsertNodes for nodes we're also deleting
        const filteredDeltas: GraphDelta = delta.filter(nodeDelta => {
            if (nodeDelta.type === 'UpsertNode') {
                if (nodeIdsToDelete.has(nodeDelta.nodeToUpsert.absoluteFilePathIsID)) {
                    return false
                }
            }
            return true
        })
        allDeltas = [...allDeltas, ...filteredDeltas]
    }

    const finalDelta: GraphDelta = deduplicateDelta(allDeltas)

    for (const nodeId of nodeIdsToDelete) {
        cy.remove(cy.getElementById(nodeId))
    }

    await window.hostAPI?.main.applyGraphDeltaToDBThroughMemUIAndEditorExposed(finalDelta);

    for (const nodeId of nodeIdsToDelete) {
        cy.remove(cy.getElementById(nodeId))
    }
}

/**
 * Deduplicate a delta by keeping only the last occurrence of each node operation.
 * For UpsertNode: keep the last upsert (most up-to-date edges)
 * For DeleteNode: keep only one delete per node
 */
function deduplicateDelta(delta: GraphDelta): GraphDelta {
    const lastUpsertByNodeId: Map<NodeIdAndFilePath, UpsertNodeDelta> = new Map()
    const deleteNodeIds: Set<NodeIdAndFilePath> = new Set()

    for (const nodeDelta of delta) {
        if (nodeDelta.type === 'DeleteNode') {
            deleteNodeIds.add(nodeDelta.nodeId)
        } else if (nodeDelta.type === 'UpsertNode') {
            lastUpsertByNodeId.set(nodeDelta.nodeToUpsert.absoluteFilePathIsID, nodeDelta)
        }
    }

    // Build final delta: deletes first, then upserts
    const deleteDeltas: GraphDelta = Array.from(deleteNodeIds)
        .map(nodeId => delta.find(d => d.type === 'DeleteNode' && d.nodeId === nodeId))
        .filter((d): d is typeof delta[number] => d !== undefined)

    const upsertDeltas: GraphDelta = Array.from(lastUpsertByNodeId.values())

    return [...deleteDeltas, ...upsertDeltas]
}
