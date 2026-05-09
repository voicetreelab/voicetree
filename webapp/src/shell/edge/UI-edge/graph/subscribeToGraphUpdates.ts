/**
 * Graph subscription effect - subscribes to graph updates from main process
 * Extracted from VoiceTreeGraphView to separate concerns
 */
import type {Core} from 'cytoscape';
import type {ProjectedGraph} from '@vt/graph-state/contract';
import type {ElectronAPI} from '@/shell/electron';
import {applyGraphDeltaToUI} from './applyGraphDeltaToUI';
import {clearCytoscapeState} from './clearCytoscapeState';
import {closeAllEditors, updateFloatingEditorsFromProjectedGraph} from '@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD';

import {closeAllTerminals} from '@/shell/edge/UI-edge/floating-windows/terminals/closeTerminal';
import {
    setLoadingState,
    setEmptyStateVisible
} from '@/shell/edge/UI-edge/state/GraphViewUIStore';
import {markRendererLoadTiming} from '@/shell/edge/UI-edge/diagnostics/loadTiming';
import {
    updateRecentNodeHistoryFromProjectedGraph,
    clearRecentNodeHistory
} from '@/shell/edge/UI-edge/state/RecentNodeHistoryStore';
import type {GraphNavigationService} from './navigation/GraphNavigationService';
import type {SearchService} from '@/shell/UI/views/SearchService';
import {scheduleIdleWork} from '@/utils/scheduleIdleWork';

/**
 * Subscribe to graph delta updates from main process via electronAPI.
 * Returns a cleanup function to unsubscribe.
 */
export function subscribeToGraphUpdates(
    navigationService: GraphNavigationService,
    searchService: SearchService,
    updateNavigatorVisibility: () => void
): (() => void) | null {
    const electronAPI: ElectronAPI | undefined = window.electronAPI;

    if (!electronAPI?.graph?.onProjectedGraphUpdate) {
        console.error('[subscribeToGraphUpdates] projected graph API not available, skipping graph subscription');
        return null;
    }

    const cy: Core = navigationService.getCy();
    let disposed: boolean = false;
    let lastProjectedGraph: ProjectedGraph | null = null;

    const handleProjectedGraph: (graph: ProjectedGraph) => void = (graph: ProjectedGraph): void => {
        markRendererLoadTiming('renderer:projected-graph-received', {nodeCount: graph.nodes.length});
        setLoadingState(false);
        setEmptyStateVisible(false);
        markRendererLoadTiming('renderer:loading-cleared');

        applyGraphDeltaToUI(cy, graph);
        searchService.updateSearchData();

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

    const cleanupProjected: () => void = electronAPI.graph.onProjectedGraphUpdate?.(handleProjectedGraph) ?? ((): void => {});
    const cleanupClear: () => void = electronAPI.graph.onGraphClear?.(handleGraphClear) ?? ((): void => {});

    void (async () => {
        const graph: ProjectedGraph | undefined = await electronAPI.main.getProjectedGraph?.();
        if (disposed || !graph || graph.nodes.length === 0) return;
        handleProjectedGraph(graph);
    })().catch((error: unknown) => {
        console.error('[subscribeToGraphUpdates] Failed to hydrate initial projected graph:', error);
    });

    return (): void => {
        disposed = true;
        cleanupProjected();
        cleanupClear();
    };
}
