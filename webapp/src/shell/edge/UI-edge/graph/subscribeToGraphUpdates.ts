/**
 * Graph subscription effect - subscribes to graph updates from main process
 * Extracted from VoiceTreeGraphView to separate concerns
 */
import type {Core} from 'cytoscape';
import type {GraphDelta, UpsertNodeDelta} from '@vt/graph-model/graph';
import type {ProjectedGraph} from '@vt/graph-state/contract';
import type {ElectronAPI} from '@/shell/electron';
import {applyGraphDeltaToUI} from './applyGraphDeltaToUI';
import {clearCytoscapeState} from './clearCytoscapeState';
import {extractRecentNodesFromDelta} from '@vt/graph-model/graph';
import {closeAllEditors} from '@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD';

import {closeAllTerminals} from '@/shell/edge/UI-edge/floating-windows/terminals/closeTerminal';
import {
    setLoadingState,
    setEmptyStateVisible
} from '@/shell/edge/UI-edge/state/GraphViewUIStore';
import {markRendererLoadTiming} from '@/shell/edge/UI-edge/diagnostics/loadTiming';
import {
    updateRecentNodeHistoryFromDelta,
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

    if (!electronAPI?.graph?.onGraphUpdate) {
        console.error('[subscribeToGraphUpdates] electronAPI not available, skipping graph subscription');
        return null;
    }

    const cy: Core = navigationService.getCy();
    let disposed: boolean = false;

    const handleProjectedGraph: (graph: ProjectedGraph) => void = (graph: ProjectedGraph): void => {
        markRendererLoadTiming('renderer:projected-graph-received', {nodeCount: graph.nodes.length});
        setLoadingState(false);
        setEmptyStateVisible(false);
        markRendererLoadTiming('renderer:loading-cleared');

        applyGraphDeltaToUI(cy, graph);

        updateNavigatorVisibility();
    };

    const handleGraphDelta: (delta: GraphDelta) => void = (delta: GraphDelta): void => {
        markRendererLoadTiming('renderer:graph-delta-received', {deltaLength: delta.length});

        const lastUpsertedNode: UpsertNodeDelta | undefined = extractRecentNodesFromDelta(delta)[0];
        if (lastUpsertedNode) {
            navigationService.setLastCreatedNodeId(lastUpsertedNode.nodeToUpsert.absoluteFilePathIsID);
        }

        searchService.updateSearchDataIncremental(delta);

        scheduleIdleWork(() => {
            updateRecentNodeHistoryFromDelta(delta);
        }, 500);
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

    const cleanupUpdate: () => void = electronAPI.graph.onGraphUpdate(handleGraphDelta);
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
        cleanupUpdate();
        cleanupProjected();
        cleanupClear();
    };
}
