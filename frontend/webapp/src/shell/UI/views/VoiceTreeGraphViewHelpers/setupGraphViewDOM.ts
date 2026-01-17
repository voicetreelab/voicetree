/**
 * Setup the graph view DOM structure
 * Pure function that creates all overlay elements and configures the container
 */
import {
    createLoadingOverlay,
    createErrorOverlay,
    createEmptyStateOverlay,
    createStatsOverlay,
    createTitleBarDragRegion
} from '../components/overlays/graphOverlays';
import {SpeedDialSideGraphFloatingMenuView} from '../SpeedDialSideGraphFloatingMenuView';
import {
    initGraphViewOverlays,
    setLoadingState
} from '@/shell/edge/UI-edge/state/GraphViewUIStore';

export interface SpeedDialCallbacks {
    onToggleDarkMode: () => void;
    onBackup: () => void;
    onSettings: () => void;
    onAbout: () => void;
    onStats: () => void;
}

export interface GraphViewDOMConfig {
    container: HTMLElement;
    isDarkMode: boolean;
    speedDialCallbacks: SpeedDialCallbacks;
}

export interface GraphViewDOMElements {
    loadingOverlay: HTMLElement;
    loadingMessageElement: HTMLElement;
    errorOverlay: HTMLElement;
    emptyStateOverlay: HTMLElement;
    statsOverlay: HTMLElement;
    speedDialMenu: SpeedDialSideGraphFloatingMenuView;
}

/**
 * Setup the graph view container and create all DOM elements.
 * Returns references to created elements for lifecycle management.
 */
export function setupGraphViewDOM(config: GraphViewDOMConfig): GraphViewDOMElements {
    const {container, isDarkMode, speedDialCallbacks} = config;

    // Configure container
    container.className = 'h-full w-full bg-background overflow-hidden relative';
    container.setAttribute('tabindex', '0'); // Allow keyboard events

    // Create title bar drag region for macOS
    container.appendChild(createTitleBarDragRegion());

    // Create speed dial menu
    const speedDialMenu = new SpeedDialSideGraphFloatingMenuView(container, {
        ...speedDialCallbacks,
        isDarkMode
    });

    // Create overlays
    const loadingResult = createLoadingOverlay();
    const loadingOverlay = loadingResult.overlay;
    const loadingMessageElement = loadingResult.messageElement;
    container.appendChild(loadingOverlay);

    const errorOverlay = createErrorOverlay();
    container.appendChild(errorOverlay);

    const emptyStateOverlay = createEmptyStateOverlay();
    container.appendChild(emptyStateOverlay);

    const statsOverlay = createStatsOverlay();
    container.appendChild(statsOverlay);

    // Initialize overlay store and show loading state
    initGraphViewOverlays(loadingOverlay, loadingMessageElement, emptyStateOverlay);
    setLoadingState(true, 'Loading VoiceTree...');

    return {
        loadingOverlay,
        loadingMessageElement,
        errorOverlay,
        emptyStateOverlay,
        statsOverlay,
        speedDialMenu
    };
}
