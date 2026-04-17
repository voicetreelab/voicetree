import type {Core} from "cytoscape";
import {syncLargeGraphPerformanceMode} from "@/shell/UI/cytoscape-graph-ui/services/largegraphPerformance";
import {applyGraphDeltaToUI} from './applyGraphDeltaToUI';
import {
    getLoadedRoots,
    dispatchUnloadRoot,
    subscribeLoadedRoots,
} from '@vt/graph-state';

/**
 * Dispatch UnloadRoot for every currently-loaded root, then project the
 * resulting graph deltas (DeleteNode operations) onto cytoscape.
 *
 * This replaces the former direct-element-removal pattern: root state is now
 * authoritative in loadedRootsStore, and cy is cleared as a projection of the
 * UnloadRoot delta — satisfying V-L2-3 (no inferred root state from cy).
 *
 * If the renderer's loadedRootsStore has not yet been populated (e.g. before
 * the main-process IPC bridge is wired in a later BF), the dispatch is a
 * no-op and cy will not be cleared here.
 */
export function clearCytoscapeState(cy: Core): void {
    const roots: string[] = [...getLoadedRoots()];

    const unsub: () => void = subscribeLoadedRoots((delta) => {
        if (delta.graph) {
            applyGraphDeltaToUI(cy, delta.graph);
        }
    });

    for (const root of roots) {
        dispatchUnloadRoot(root);
    }

    unsub();
    syncLargeGraphPerformanceMode(cy);
}
