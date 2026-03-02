// Import for global Window.electronAPI type declaration
import type {
    Graph,
    GraphDelta,
    GraphNode,
    NodeIdAndFilePath,
    NodeUIMetadata,
    Position,
    UpsertNodeDelta
} from "@/pure/graph";
import {
    createNewNodeNoParent,
    fromCreateChildToUpsertNode
} from "@/pure/graph/graphDelta/uiInteractionsToGraphDeltas";
import {deleteNodeSimple} from "@/pure/graph/graph-operations/removeNodeMaintainingTransitiveEdges";
import {applyGraphDeltaToGraph} from "@/pure/graph/graphDelta/applyGraphDeltaToGraph";
import type {Core} from 'cytoscape';
import {
    updateFloatingEditors,
} from "@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD";
import * as O from 'fp-ts/lib/Option.js';
import {calculateNodePosition} from "@/pure/graph/positioning/calculateInitialPosition";
import {buildSpatialIndexFromGraph} from "@/pure/graph/positioning/spatialAdapters";
import type {SpatialIndex} from "@/pure/graph/spatial";
import {requestAutoPinOnCreation} from "@/shell/edge/UI-edge/graph/applyGraphDeltaToUI";

/**
 * Merges new metadata with old metadata, preferring new values when they are "present".
 * - For Option types: use new if Some, otherwise keep old
 * - For optional fields (undefined): use new if defined, otherwise keep old
 * - For Map: use new if non-empty, otherwise keep old
 * NOTE: title is NOT stored in metadata - it's derived via getNodeTitle(node) when needed
 */
export function mergeNodeUIMetadata(oldMeta: NodeUIMetadata, newMeta: NodeUIMetadata): NodeUIMetadata {
    return {
        color: O.isSome(newMeta.color) ? newMeta.color : oldMeta.color,
        position: O.isSome(newMeta.position) ? newMeta.position : oldMeta.position,
        additionalYAMLProps: newMeta.additionalYAMLProps.size > 0 ? newMeta.additionalYAMLProps : oldMeta.additionalYAMLProps,
        isContextNode: newMeta.isContextNode ?? oldMeta.isContextNode,
        containedNodeIds: newMeta.containedNodeIds ?? oldMeta.containedNodeIds,
    };
}


export async function createNewChildNodeFromUI(
    parentNodeId: string,
    cy: Core,
    spatialIndex?: SpatialIndex
): Promise<NodeIdAndFilePath> {

    // Get current graph state
    const currentGraph: Graph | undefined = await window.electronAPI?.main.getGraph() // todo, in memory renderer cache?
    if (!currentGraph) {
        console.error("NO GRAPH IN STATE")
        return "-1"; //todo cleaner
    }
    // Get parent node from graph
    const parentNode: GraphNode = currentGraph.nodes[parentNodeId];

    const spatialIndexToUse: SpatialIndex = spatialIndex ?? buildSpatialIndexFromGraph(currentGraph);
    const position: Position = O.getOrElse(() => ({x: 0, y: 0}))(calculateNodePosition(currentGraph, spatialIndexToUse, parentNodeId));

    // Create GraphDelta (contains both child and updated parent with edge)
    const graphDelta: GraphDelta = fromCreateChildToUpsertNode(currentGraph, parentNode, "# ", undefined, O.some(position));
    const newNode: GraphNode = (graphDelta[0] as UpsertNodeDelta).nodeToUpsert;

    // GRAPH UI CHANGE path: update editor passively BEFORE writing to FS
    // This ensures parent editor gets the wikilink before FS write (which will be skipped on read-back)
    updateFloatingEditors(cy, graphDelta);

    // Register pending auto-pin so the new node opens in edit mode
    // when applyGraphDeltaToUI processes the delta from the IPC broadcast
    requestAutoPinOnCreation(newNode.absoluteFilePathIsID);

    await window.electronAPI?.main.applyGraphDeltaToDBThroughMemUIAndEditorExposed(graphDelta);

    return newNode.absoluteFilePathIsID;
}

export async function createNewEmptyOrphanNodeFromUI(
    pos: Position,
): Promise<NodeIdAndFilePath> {
    // Get write path (absolute) for new node creation
    const writePathOption: O.Option<string> | undefined = await window.electronAPI?.main.getWritePath();
    const writePath: string = writePathOption ? O.getOrElse(() => '')(writePathOption) : '';

    // Get current graph for collision detection
    const currentGraph: Graph | undefined = await window.electronAPI?.main.getGraph();
    if (!currentGraph) {
        console.error("NO GRAPH IN STATE");
        throw new Error("Cannot create node: graph not available");
    }

    const {newNode, graphDelta} = createNewNodeNoParent(pos, writePath, currentGraph);

    // Register pending auto-pin so the new node opens in edit mode
    requestAutoPinOnCreation(newNode.absoluteFilePathIsID);

    await window.electronAPI?.main.applyGraphDeltaToDBThroughMemUIAndEditorExposed(graphDelta);

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
    _cy: Core
): Promise<void> {
    const currentGraph: Graph | undefined = await window.electronAPI?.main.getGraph()
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

    await window.electronAPI?.main.applyGraphDeltaToDBThroughMemUIAndEditorExposed(finalDelta);
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

