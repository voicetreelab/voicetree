/**
 * Graph subscription effect - subscribes to graph updates from main process
 * Extracted from VoiceTreeGraphView to separate concerns
 */
import type {Core} from 'cytoscape';
import type {ProjectedGraph} from '@vt/graph-state/contract';
import type {HostAPI} from '@/shell/hostApi';
import {applyGraphDeltaToUI} from '@/shell/edge/UI-edge/graph/actions/applyGraphDeltaToUI';
import {clearCytoscapeState} from './clearCytoscapeState';
import {closeAllEditors, updateFloatingEditorsFromProjectedGraph} from '@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD';

import {closeAllTerminals} from '@/shell/edge/UI-edge/floating-windows/terminals/closeTerminal';
import {
    setLoadingState,
    setEmptyStateVisible
} from '@/shell/edge/UI-edge/state/stores/GraphViewUIStore';
import {markRendererLoadTiming} from '@/shell/edge/UI-edge/diagnostics/loadTiming';
import {
    updateRecentNodeHistoryFromProjectedGraph,
    clearRecentNodeHistory
} from '@/shell/edge/UI-edge/state/stores/RecentNodeHistoryStore';
import {publishLatestProjectedGraph} from '@/shell/edge/UI-edge/state/stores/LatestProjectedGraphStore';
import type {GraphNavigationService} from './navigation/GraphNavigationService';
import type {SearchService} from '@/shell/UI/views/graph-view/SearchService';
import {scheduleIdleWork} from '@/utils/scheduleIdleWork';

/**
 * Subscribe to graph delta updates from main process via hostAPI.
 * Returns a cleanup function to unsubscribe.
 */
export function subscribeToGraphUpdates(
    navigationService: GraphNavigationService,
    searchService: SearchService,
    updateNavigatorVisibility: () => void
): (() => void) | null {
    const hostAPI: HostAPI | undefined = window.hostAPI;

    if (!hostAPI?.graph?.onProjectedGraphUpdate || !hostAPI.graph.getCurrentProjectedGraph) {
        console.error('[subscribeToGraphUpdates] projected graph API not available, skipping graph subscription');
        return null;
    }

    const cy: Core = navigationService.getCy();
    let lastProjectedGraph: ProjectedGraph | null = null;
    let searchUpdateRaf: number | null = null;

    const scheduleSearchUpdate = (): void => {
        if (searchUpdateRaf !== null) return;

        searchUpdateRaf = requestAnimationFrame(() => {
            searchUpdateRaf = null;
            searchService.updateSearchData();
        });
    };

    const handleProjectedGraph: (graph: ProjectedGraph) => void = (graph: ProjectedGraph): void => {
        setLoadingState(false);
        setEmptyStateVisible(false);
        markRendererLoadTiming('renderer:loading-cleared');

        applyGraphDeltaToUI(cy, graph);
        publishLatestProjectedGraph(graph);
        scheduleSearchUpdate();

        // Floating editors don't ride applyGraphDeltaToUI — that path only
        // syncs Cytoscape. Without this call, an external file change (FS
        // watcher → daemon → SSE → ProjectedGraph) never reaches an open
        // CodeMirror editor, so a focused mid-typing editor stays stale.
        updateFloatingEditorsFromProjectedGraph(cy, graph, lastProjectedGraph);
        lastProjectedGraph = graph;

        const recentNodeIds: readonly string[] = graph.recentNodeIds;
        if (recentNodeIds.length > 0) {
            navigationService.setLastCreatedNodeId(recentNodeIds[0]);
            scheduleIdleWork(() => {
                updateRecentNodeHistoryFromProjectedGraph(graph);
            }, 500);
        }

        updateNavigatorVisibility();
    };

    const handleGraphClear: () => void = (): void => {
        setLoadingState(true, 'Loading Voicetree...');

        closeAllTerminals(cy);
        clearCytoscapeState(cy);
        closeAllEditors(cy);
        clearRecentNodeHistory();
        searchService.updateSearchData();

        setEmptyStateVisible(true);
    };

    const cleanupProjected: () => void = hostAPI.graph.onProjectedGraphUpdate?.(handleProjectedGraph) ?? ((): void => {});
    const cleanupClear: () => void = hostAPI.graph.onGraphClear?.(handleGraphClear) ?? ((): void => {});
    let isSubscribed: boolean = true;

    void hostAPI.graph.getCurrentProjectedGraph()
        .then((graph: ProjectedGraph): void => {
            if (!isSubscribed) return;
            handleProjectedGraph(graph);
        })
        .catch((error: unknown): void => {
            if (!isSubscribed) return;
            console.error('[subscribeToGraphUpdates] failed to fetch current projected graph', error);
        });

    return (): void => {
        if (searchUpdateRaf !== null) {
            cancelAnimationFrame(searchUpdateRaf);
            searchUpdateRaf = null;
        }

        isSubscribed = false;
        cleanupProjected();
        cleanupClear();
    };
}
