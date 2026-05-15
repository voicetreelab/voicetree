/**
 * GraphViewUIStore - Edge state for graph view UI elements
 * Follows the same pattern as EditorStore.ts
 */

// DOM element references (set once during render)
let loadingOverlay: HTMLElement | null = null;
let loadingMessageElement: HTMLElement | null = null;
let emptyStateOverlay: HTMLElement | null = null;

/**
 * Initialize overlay references (called once from VoiceTreeGraphView.render())
 */
export function initGraphViewOverlays(
    loading: HTMLElement,
    loadingMessage: HTMLElement,
    emptyState: HTMLElement
): void {
    loadingOverlay = loading;
    loadingMessageElement = loadingMessage;
    emptyStateOverlay = emptyState;
}

/**
 * Set loading state visibility and message
 */
export function setLoadingState(isLoading: boolean, message?: string): void {
    if (!loadingOverlay) return;

    if (isLoading) {
        if (message && loadingMessageElement) {
            loadingMessageElement.textContent = message;
        }
        loadingOverlay.style.display = 'flex';
    } else {
        loadingOverlay.style.display = 'none';
    }
}

/**
 * Set empty state overlay visibility
 */
export function setEmptyStateVisible(visible: boolean): void {
    if (!emptyStateOverlay) return;
    emptyStateOverlay.style.display = visible ? 'flex' : 'none';
}

/**
 * Cleanup (called from VoiceTreeGraphView.dispose())
 */
export function disposeGraphViewOverlays(): void {
    loadingOverlay = null;
    loadingMessageElement = null;
    emptyStateOverlay = null;
}
