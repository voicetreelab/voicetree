/**
 * Event listener setup for VoiceTreeGraphView
 * Extracted from VoiceTreeGraphView.setupEventListeners() to reduce file size.
 */
import type {Core} from 'cytoscape';
import type {GraphNavigationService} from '@/shell/edge/UI-edge/graph/navigation/GraphNavigationService';
import type {SearchService} from './SearchService';
import type {HotkeyManager} from './HotkeyManager';
import {createNewNodeAction, runTerminalAction, deleteSelectedNodesAction} from '@/shell/UI/cytoscape-graph-ui/actions/graphActions';
import {createSettingsEditor} from "@/shell/edge/UI-edge/settings/createSettingsEditor";
import {toggleVoiceRecording} from '@/shell/edge/UI-edge/state/VoiceRecordingController';
import {onSettingsChange} from '@/shell/edge/UI-edge/api';

export function setupGraphViewEventListeners(params: {
    cy: Core;
    container: HTMLElement;
    navigationService: GraphNavigationService;
    searchService: SearchService;
    hotkeyManager: HotkeyManager;
    onResizeMethod: () => void;
    onNavigateToRecentNode: (index: number) => void;
    onCloseSelectedWindow: () => void;
}): { handleResize: () => void; cleanupSettingsListener: () => void } {
    const {cy, container, navigationService, searchService, hotkeyManager, onResizeMethod, onNavigateToRecentNode, onCloseSelectedWindow} = params;

    // Bind handlers
    const handleResize: () => void = onResizeMethod;

    // Window resize
    window.addEventListener('resize', handleResize);

    // Save positions before window closes
    const handleBeforeUnload: () => void = () => {
        //console.log('[VoiceTreeGraphView] Window closing, saving positions...');
        // Use synchronous IPC if available, otherwise just log
        // todo this.saveNodePositions();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Focus container to ensure it receives keyboard events
    container.focus();

    // Setup hotkeys with settings (async load handled internally by HotkeyManager)
    const hotkeyCallbacks: {
        fitToLastNode: () => void;
        cycleTerminal: (direction: 1 | -1) => void;
        createNewNode: () => void;
        runTerminal: () => void;
        deleteSelectedNodes: () => void;
        navigateToRecentNode: (index: number) => void;
        closeSelectedWindow: () => void;
        openSettings: () => void;
        openSearch: () => void;
    } = {
        fitToLastNode: () => navigationService.fitToLastNode(),
        cycleTerminal: (direction) => navigationService.cycleTerminal(direction),
        createNewNode: createNewNodeAction(cy),
        runTerminal: runTerminalAction(cy),
        deleteSelectedNodes: deleteSelectedNodesAction(cy),
        navigateToRecentNode: (index) => onNavigateToRecentNode(index),
        closeSelectedWindow: () => onCloseSelectedWindow(),
        openSettings: () => void createSettingsEditor(cy),
        openSearch: () => searchService.open()
    };
    void hotkeyManager.initializeWithSettings(hotkeyCallbacks, toggleVoiceRecording);

    // Subscribe to settings changes to refresh hotkeys at runtime
    const cleanupSettingsListener: () => void = onSettingsChange(() => {
        void hotkeyManager.refreshHotkeys(hotkeyCallbacks, toggleVoiceRecording);
    });

    // Note: Wheel events (pan/zoom) are handled by NavigationGestureService

    return {handleResize, cleanupSettingsListener};
}
