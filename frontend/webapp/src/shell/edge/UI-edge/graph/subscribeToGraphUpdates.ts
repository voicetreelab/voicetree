/**
 * Graph subscription effect - subscribes to graph delta updates from main process
 * Extracted from VoiceTreeGraphView to separate concerns
 */
import type {Core} from 'cytoscape';
import type {GraphDelta, UpsertNodeDelta} from '@/pure/graph';
import type {ElectronAPI} from '@/shell/electron';
import {applyGraphDeltaToUI} from './applyGraphDeltaToUI';
import {clearCytoscapeState} from './clearCytoscapeState';
import {
    updateHistoryFromDelta,
    createEmptyHistory,
    type RecentNodeHistory,
    extractRecentNodesFromDelta
} from '@/pure/graph/recentNodeHistoryV2';
import {renderRecentNodeTabsV2} from '@/shell/UI/views/RecentNodeTabsBar';
import {closeAllEditors} from '@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD';
import {closeAllTerminals} from '@/shell/edge/UI-edge/floating-windows/terminals/spawnTerminalWithCommandFromUI';

/**
 * Dependencies required for graph subscription handlers
 */
export interface GraphSubscriptionDeps {
    cy: Core;
    setLoadingState: (isLoading: boolean, message?: string) => void;
    setEmptyStateVisible: (visible: boolean) => void;
    navigationService: {
        setLastCreatedNodeId: (nodeId: string) => void;
        handleSearchSelect: (nodeId: string) => void;
    };
    searchService: {
        updateSearchDataIncremental: (delta: GraphDelta) => void;
        updateSearchData: () => void;
    };
    getRecentNodeHistory: () => RecentNodeHistory;
    setRecentNodeHistory: (history: RecentNodeHistory) => void;
    updateNavigatorVisibility: () => void;
}

/**
 * Subscribe to graph delta updates from main process via electronAPI.
 * Returns a cleanup function to unsubscribe.
 */
export function subscribeToGraphUpdates(deps: GraphSubscriptionDeps): (() => void) | null {
    const electronAPI: ElectronAPI | undefined = window.electronAPI;

    if (!electronAPI?.graph?.onGraphUpdate) {
        console.error('[subscribeToGraphUpdates] electronAPI not available, skipping graph subscription');
        return null;
    }

    const handleGraphDelta = (delta: GraphDelta): void => {
        console.log('[subscribeToGraphUpdates] Received graph delta, length:', delta.length);

        deps.setLoadingState(false);
        deps.setEmptyStateVisible(false);

        // applyGraphDeltaToUI handles auto-pinning editors for new external nodes
        applyGraphDeltaToUI(deps.cy, delta);

        // Track last created node for "fit to last node" hotkey (Space)
        const lastUpsertedNode: UpsertNodeDelta | undefined = extractRecentNodesFromDelta(delta)[0];
        if (lastUpsertedNode) {
            deps.navigationService.setLastCreatedNodeId(lastUpsertedNode.nodeToUpsert.relativeFilePathIsID);
        }

        deps.searchService.updateSearchDataIncremental(delta);

        // Update navigator visibility based on node count
        deps.updateNavigatorVisibility();

        // Update recent node history from delta and re-render tabs
        const updatedHistory = updateHistoryFromDelta(deps.getRecentNodeHistory(), delta);
        deps.setRecentNodeHistory(updatedHistory);

        renderRecentNodeTabsV2(
            updatedHistory,
            (nodeId) => deps.navigationService.handleSearchSelect(nodeId),
            (nodeId) => deps.cy.getElementById(nodeId).data('label') as string | undefined
        );
    };

    const handleGraphClear = (): void => {
        console.log('[subscribeToGraphUpdates] Received graph:clear event');
        deps.setLoadingState(true, 'Loading VoiceTree...');

        // Close all open terminals (UI cleanup - PTY processes already killed by main process)
        closeAllTerminals(deps.cy);

        clearCytoscapeState(deps.cy);

        // Close all open floating editors
        closeAllEditors(deps.cy);

        // Clear recent node history and re-render (empty) tabs
        const emptyHistory = createEmptyHistory();
        deps.setRecentNodeHistory(emptyHistory);

        renderRecentNodeTabsV2(
            emptyHistory,
            (nodeId) => deps.navigationService.handleSearchSelect(nodeId),
            (nodeId) => deps.cy.getElementById(nodeId).data('label') as string | undefined
        );

        // Reset ninja-keys search data (now rebuilds from empty cytoscape)
        deps.searchService.updateSearchData();

        deps.setEmptyStateVisible(true);
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
