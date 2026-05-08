import type {Core} from "cytoscape";
import {syncLargeGraphPerformanceMode} from "@/shell/UI/cytoscape-graph-ui/services/largegraphPerformance";
import {applyGraphDeltaToUI} from './applyGraphDeltaToUI';
import { emptyState } from '@vt/graph-state/emptyState';
import { project } from '@vt/graph-state/project';
import {
    getLoadedRoots,
    dispatchUnloadRoot,
} from '@vt/graph-state/state/loadedRootsStore';

/**
 * Dispatch UnloadRoot for every currently-loaded root, then project the
 * empty State and reconcile cytoscape against it. BF-L5-202b replaces the
 * delta-shim path with a direct `project(state)` reconcile, consistent with
 * the rest of the render pipeline.
 */
export function clearCytoscapeState(cy: Core): void {
    const roots: string[] = [...getLoadedRoots()];
    for (const root of roots) {
        dispatchUnloadRoot(root);
    }

    applyGraphDeltaToUI(cy, project(emptyState()));

    syncLargeGraphPerformanceMode(cy);
}
