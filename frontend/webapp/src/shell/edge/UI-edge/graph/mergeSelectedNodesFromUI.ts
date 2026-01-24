import type {Graph, GraphDelta, NodeIdAndFilePath} from "@/pure/graph";
import type {Core} from "cytoscape";
import {computeMergeGraphDelta} from "@/pure/graph/graph-operations/merge/computeMergeGraphDelta";
import * as O from 'fp-ts/lib/Option.js';

// Import ElectronAPI type for window.electronAPI access
import type {} from "@/shell/electron";

/**
 * Merge selected nodes into a single representative node.
 * - Creates a new representative node at the centroid of merged nodes
 * - Redirects all incoming edges from external nodes to the representative
 * - Deletes all original selected nodes
 */
export async function mergeSelectedNodesFromUI(
    selectedNodeIds: readonly NodeIdAndFilePath[],
    _cy: Core
): Promise<void> {
    if (selectedNodeIds.length < 2) {
        //console.log('[mergeSelectedNodesFromUI] Need at least 2 nodes to merge');
        return;
    }

    // Get current graph state
    const currentGraph: Graph | undefined = await window.electronAPI?.main.getGraph();
    if (!currentGraph) {
        console.error('[mergeSelectedNodesFromUI] NO GRAPH IN STATE');
        return;
    }

    // Get write path for merged node path
    const writePathOption: O.Option<string> | undefined = await window.electronAPI?.main.getWritePath();
    const writePath: string = writePathOption ? O.getOrElse(() => '')(writePathOption) : '';

    // Compute the merge delta (pure function)
    const graphDelta: GraphDelta = computeMergeGraphDelta(selectedNodeIds, currentGraph, writePath);

    if (graphDelta.length === 0) {
        //console.log('[mergeSelectedNodesFromUI] No valid merge delta generated');
        return;
    }

    // Optimistic UI update
    // applyGraphDeltaToUI(cy, graphDelta);

    // Persist to backend
    await window.electronAPI?.main.applyGraphDeltaToDBThroughMemUIAndEditorExposed(graphDelta);
}