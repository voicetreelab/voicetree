/**
 * Initialize and manage the Cytoscape navigator minimap
 * Provides a thumbnail view of the graph in the bottom-right corner
 */
import type {Core} from 'cytoscape';

export interface NavigatorMinimapResult {
    navigator: { destroy: () => void } | null;
    updateVisibility: () => void;
}

/**
 * Initialize the navigator minimap widget with performance-optimized settings.
 * Returns the navigator instance and a visibility updater function.
 */
export function initializeNavigatorMinimap(cy: Core): NavigatorMinimapResult {
    let navigatorInstance: { destroy: () => void } | null = null;

    // Visibility updater - shows minimap only when 2+ nodes exist
    const updateVisibility: () => void = (): void => {
        if (!navigatorInstance) {
            return;
        }

        const nodeCount: number = cy.nodes().length;
        const navigatorElement: HTMLElement | null = document.querySelector('.cytoscape-navigator') as HTMLElement;

        if (navigatorElement) {
            const wasHidden: boolean = navigatorElement.style.display === 'none';
            navigatorElement.style.display = nodeCount <= 1 ? 'none' : 'block';

            // When the navigator transitions from hidden to visible, its cached
            // panelWidth/panelHeight (from getBoundingClientRect during _initPanel)
            // may be 0 because the element was display:none. Emitting 'resize'
            // triggers the navigator's resize() handler which calls _setupPanel()
            // to refresh these cached dimensions from the now-visible element.
            if (wasHidden && nodeCount > 1) {
                cy.emit('resize');
            }
        }
    };

    try {
        // Initialize navigator with performance-optimized settings
        // Let library auto-create container, which we'll style with CSS
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        navigatorInstance = (cy as any).navigator({
            container: false, // Auto-create container
            viewLiveFramerate: 0, // Update graph pan instantly while dragging
            thumbnailEventFramerate: 0, // Disable thumbnail updates during pan/zoom (reduces toDataURL cost); rerenderDelay handles post-idle regeneration
            thumbnailLiveFramerate: false, // Disable continuous thumbnail updates for performance
            dblClickDelay: 200,
            removeCustomContainer: true, // Let library manage container cleanup
            rerenderDelay: 100 // Regenerate thumbnail 100ms after interaction stops (on idle)
        });

        //console.log('[initializeNavigatorMinimap] Navigator minimap initialized');

        // cytoscape-navigator's destroy() unbinds its cy listeners but never
        // cancels the throttled render timer (_onRenderHandler). A render queued
        // just before teardown therefore fires up to rerenderDelay later and
        // calls cy.elements().boundingBox() on an already-destroyed cy →
        // "Cannot read properties of null (reading 'isHeadless')". Wrap destroy
        // to cancel that timer first. Optional-chained so a library version
        // without the field degrades to a no-op rather than throwing.
        if (navigatorInstance) {
            const inner: { destroy: () => void } = navigatorInstance;
            const nativeDestroy: () => void = inner.destroy.bind(inner);
            inner.destroy = (): void => {
                (inner as { _onRenderHandler?: { cancel?: () => void } })._onRenderHandler?.cancel?.();
                nativeDestroy();
            };
        }

        // Initially hide minimap if there's only one node or less
        updateVisibility();
    } catch (error) {
        console.error('[initializeNavigatorMinimap] Failed to initialize navigator:', error);
    }

    return {
        navigator: navigatorInstance,
        updateVisibility
    };
}
