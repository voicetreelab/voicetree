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
import {createSpeedDialMenu, type SpeedDialCallbacks} from '@/shell/UI/views/SpeedDialMenu';
import {
    initGraphViewOverlays,
    setLoadingState
} from '@/shell/edge/UI-edge/state/GraphViewUIStore';

export interface GraphViewDOMConfig {
    container: HTMLElement;
    uiContainer: HTMLElement;
    isDarkMode: boolean;
    speedDialCallbacks: SpeedDialCallbacks;
}

export interface GraphViewDOMElements {
    loadingOverlay: HTMLElement;
    loadingMessageElement: HTMLElement;
    errorOverlay: HTMLElement;
    emptyStateOverlay: HTMLElement;
    statsOverlay: HTMLElement;
}

/**
 * Setup the graph view container and create all DOM elements.
 * Returns references to created elements for lifecycle management.
 */
export function setupGraphViewDOM(config: GraphViewDOMConfig): GraphViewDOMElements {
    const {container, uiContainer, isDarkMode, speedDialCallbacks} = config;

    // React owns container className (absolute inset-0 pb-14 overflow-hidden bg-background)
    container.setAttribute('tabindex', '0'); // Allow keyboard events

    // Create title bar drag region for macOS - append to UI container
    uiContainer.appendChild(createTitleBarDragRegion());

    // Create speed dial menu (React) - append to UI container
    createSpeedDialMenu(uiContainer, speedDialCallbacks, isDarkMode);

    // Create overlays (appended to uiContainer, not Cytoscape container)
    const loadingResult: { overlay: HTMLElement; messageElement: HTMLElement } = createLoadingOverlay();
    const loadingOverlay: HTMLElement = loadingResult.overlay;
    const loadingMessageElement: HTMLElement = loadingResult.messageElement;
    uiContainer.appendChild(loadingOverlay);

    const errorOverlay: HTMLElement = createErrorOverlay();
    uiContainer.appendChild(errorOverlay);

    const emptyStateOverlay: HTMLElement = createEmptyStateOverlay();
    uiContainer.appendChild(emptyStateOverlay);

    const statsOverlay: HTMLElement = createStatsOverlay();
    uiContainer.appendChild(statsOverlay);

    // Initialize overlay store and show loading state
    initGraphViewOverlays(loadingOverlay, loadingMessageElement, emptyStateOverlay);
    setLoadingState(true, 'Loading Voicetree...');

    return {
        loadingOverlay,
        loadingMessageElement,
        errorOverlay,
        emptyStateOverlay,
        statsOverlay,
    };
}
