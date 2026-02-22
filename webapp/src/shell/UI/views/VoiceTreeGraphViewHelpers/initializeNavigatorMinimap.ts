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
            thumbnailEventFramerate: 30, // Update thumbnail more frequently for responsiveness
            thumbnailLiveFramerate: false, // Disable continuous thumbnail updates for performance
            dblClickDelay: 200,
            removeCustomContainer: true, // Let library manage container cleanup
            rerenderDelay: 100 // Throttle rerenders
        });

        //console.log('[initializeNavigatorMinimap] Navigator minimap initialized');

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
