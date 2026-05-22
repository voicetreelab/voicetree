import type {Core} from "cytoscape";
import {syncLargeGraphPerformanceMode} from "@/shell/UI/cytoscape-graph-ui/services/animation/largegraphPerformance";
import {applyGraphDeltaToUI} from '@/shell/edge/UI-edge/graph/actions/applyGraphDeltaToUI';
import { emptyState } from '@vt/graph-state/emptyState';
import { project } from '@vt/graph-state/project';

/**
 * Project the empty State and reconcile cytoscape against it.
 */
export function clearCytoscapeState(cy: Core): void {
    applyGraphDeltaToUI(cy, project(emptyState()));

    syncLargeGraphPerformanceMode(cy);
}
