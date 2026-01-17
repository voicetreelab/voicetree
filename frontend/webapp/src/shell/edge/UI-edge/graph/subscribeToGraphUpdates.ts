/**
 * Graph subscription effect - subscribes to graph delta updates from main process
 * Extracted from VoiceTreeGraphView to separate concerns
 */
import type {Core} from 'cytoscape';
import type {GraphDelta, UpsertNodeDelta} from '@/pure/graph';
import type {ElectronAPI} from '@/shell/electron';
import {applyGraphDeltaToUI} from './applyGraphDeltaToUI';
import {clearCytoscapeState} from './clearCytoscapeState';
import {extractRecentNodesFromDelta} from '@/pure/graph/recentNodeHistoryV2';
import {renderRecentNodeTabsV2} from '@/shell/UI/views/RecentNodeTabsBar';
import {closeAllEditors} from '@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD';
import {closeAllTerminals} from '@/shell/edge/UI-edge/floating-windows/terminals/spawnTerminalWithCommandFromUI';
import {
    setLoadingState,
    setEmptyStateVisible
} from '@/shell/edge/UI-edge/state/GraphViewUIStore';
import {
    updateRecentNodeHistoryFromDelta,
    clearRecentNodeHistory
} from '@/shell/edge/UI-edge/state/RecentNodeHistoryStore';
import type {RecentNodeHistory} from '@/pure/graph/recentNodeHistoryV2';
import type {GraphNavigationService} from './navigation/GraphNavigationService';
import type {SearchService} from '@/shell/UI/views/SearchService';

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

    const handleGraphDelta: (delta: GraphDelta) => void = (delta: GraphDelta): void => {
        console.log('[subscribeToGraphUpdates] Received graph delta, length:', delta.length);

        setLoadingState(false);
        setEmptyStateVisible(false);

        // applyGraphDeltaToUI handles auto-pinning editors for new external nodes
        applyGraphDeltaToUI(cy, delta);

        // Track last created node for "fit to last node" hotkey (Space)
        const lastUpsertedNode: UpsertNodeDelta | undefined = extractRecentNodesFromDelta(delta)[0];
        if (lastUpsertedNode) {
            navigationService.setLastCreatedNodeId(lastUpsertedNode.nodeToUpsert.absoluteFilePathIsID);
        }

        searchService.updateSearchDataIncremental(delta);

        // Update navigator visibility based on node count
        updateNavigatorVisibility();

        // Update recent node history from delta and re-render tabs
        const updatedHistory: RecentNodeHistory = updateRecentNodeHistoryFromDelta(delta);

        renderRecentNodeTabsV2(
            updatedHistory,
            (nodeId) => navigationService.handleSearchSelect(nodeId),
            (nodeId) => cy.getElementById(nodeId).data('label') as string | undefined
        );
    };

    const handleGraphClear: () => void = (): void => {
        console.log('[subscribeToGraphUpdates] Received graph:clear event');
        setLoadingState(true, 'Loading VoiceTree...');

        // Close all open terminals (UI cleanup - PTY processes already killed by main process)
        closeAllTerminals(cy);

        clearCytoscapeState(cy);

        // Close all open floating editors
        closeAllEditors(cy);

        // Clear recent node history and re-render (empty) tabs
        const emptyHistory: RecentNodeHistory = clearRecentNodeHistory();

        renderRecentNodeTabsV2(
            emptyHistory,
            (nodeId) => navigationService.handleSearchSelect(nodeId),
            (nodeId) => cy.getElementById(nodeId).data('label') as string | undefined
        );

        // Reset ninja-keys search data (now rebuilds from empty cytoscape)
        searchService.updateSearchData();

        setEmptyStateVisible(true);
    };

    // Subscribe to graph updates via electronAPI (returns cleanup function)
    const cleanupUpdate: () => void = electronAPI.graph.onGraphUpdate(handleGraphDelta);
    const cleanupClear: () => void = electronAPI.graph.onGraphClear?.(handleGraphClear) ?? ((): void => {});

    // Return combined cleanup function
    return (): void => {
        cleanupUpdate();
        cleanupClear();
    };
}
