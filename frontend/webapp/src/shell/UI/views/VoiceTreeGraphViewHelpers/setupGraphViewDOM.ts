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
} from '@/shell/UI/views/components/overlays/graphOverlays';
import {SpeedDialSideGraphFloatingMenuView} from '@/shell/UI/views/SpeedDialSideGraphFloatingMenuView';
import {
    initGraphViewOverlays,
    setLoadingState
} from '@/shell/edge/UI-edge/state/GraphViewUIStore';

export interface SpeedDialCallbacks {
    onToggleDarkMode: () => void;
    onSettings: () => void;
    onAbout: () => void;
    onStats: () => void;
    onFeedback: () => void;
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
    const speedDialMenu: SpeedDialSideGraphFloatingMenuView = new SpeedDialSideGraphFloatingMenuView(container, {
        ...speedDialCallbacks,
        isDarkMode
    });

    // Create overlays
    const loadingResult: { overlay: HTMLElement; messageElement: HTMLElement } = createLoadingOverlay();
    const loadingOverlay: HTMLElement = loadingResult.overlay;
    const loadingMessageElement: HTMLElement = loadingResult.messageElement;
    container.appendChild(loadingOverlay);

    const errorOverlay: HTMLElement = createErrorOverlay();
    container.appendChild(errorOverlay);

    const emptyStateOverlay: HTMLElement = createEmptyStateOverlay();
    container.appendChild(emptyStateOverlay);

    const statsOverlay: HTMLElement = createStatsOverlay();
    container.appendChild(statsOverlay);

    // Initialize overlay store and show loading state
    initGraphViewOverlays(loadingOverlay, loadingMessageElement, emptyStateOverlay);
    setLoadingState(true, 'Loading Voicetree...');

    return {
        loadingOverlay,
        loadingMessageElement,
        errorOverlay,
        emptyStateOverlay,
        statsOverlay,
        speedDialMenu
    };
}
