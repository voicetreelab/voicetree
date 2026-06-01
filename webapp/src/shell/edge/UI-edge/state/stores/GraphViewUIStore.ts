/**
 * GraphViewUIStore - Edge state for graph view UI elements
 * Follows the same pattern as EditorStore.ts
 */

// DOM element references (set once during render). `ownedOverlays` holds every
// element setupGraphViewDOM imperatively appended to the reused uiContainer, so
// disposeGraphViewOverlays can remove them — otherwise each remount (project
// switch, or a churned mount) orphans a stuck overlay in the DOM.
let loadingOverlay: HTMLElement | null = null;
let loadingMessageElement: HTMLElement | null = null;
let emptyStateOverlay: HTMLElement | null = null;
let ownedOverlays: HTMLElement[] = [];

/**
 * Initialize overlay references (called once from VoiceTreeGraphView.render()).
 * `extraOverlays` are additional imperatively-appended elements (error, stats)
 * that carry no store state but must be removed from the DOM on dispose.
 */
export function initGraphViewOverlays(
    loading: HTMLElement,
    loadingMessage: HTMLElement,
    emptyState: HTMLElement,
    ...extraOverlays: HTMLElement[]
): void {
    loadingOverlay = loading;
    loadingMessageElement = loadingMessage;
    emptyStateOverlay = emptyState;
    ownedOverlays = [loading, emptyState, ...extraOverlays];
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
        if (loadingMessageElement) {
            loadingMessageElement.textContent = '';
        }
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
 * Cleanup (called from VoiceTreeGraphView.dispose()). Removes the overlay
 * elements from the DOM so a remount into the same uiContainer starts clean
 * instead of stacking a fresh set on top of orphaned ones.
 */
export function disposeGraphViewOverlays(): void {
    for (const overlay of ownedOverlays) {
        overlay.remove();
    }
    ownedOverlays = [];
    loadingOverlay = null;
    loadingMessageElement = null;
    emptyStateOverlay = null;
}
