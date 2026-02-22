/**
 * Pure factory function for creating a Cytoscape instance
 * Handles container-based initialization with headless fallback for testing environments
 */
import cytoscape, {type Core, type CytoscapeOptions, type StylesheetCSS} from 'cytoscape';
import {MIN_ZOOM, MAX_ZOOM} from '@/shell/UI/cytoscape-graph-ui/constants';

export interface CytoscapeInitConfig {
    container: HTMLElement;
    stylesheet: StylesheetCSS[];
    /** Show FPS counter overlay on WebGL renderer (default: false) */
    showFps?: boolean;
}

export interface CytoscapeInitResult {
    cy: Core;
    isHeadless: boolean;
}

/**
 * Initialize a Cytoscape instance with the given configuration.
 * Falls back to headless mode if container-based initialization fails (e.g., JSDOM).
 */
export function initializeCytoscapeInstance(config: CytoscapeInitConfig): CytoscapeInitResult {
    const {container, stylesheet, showFps = false} = config;

    const baseOptions: CytoscapeOptions = {
        elements: [],
        style: stylesheet,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        boxSelectionEnabled: true,
        userZoomingEnabled: false // Custom zoom via NavigationGestureService.zoomAtCursor() for unified handling
    };

    // Try container-based initialization first
    try {
        // Experimental WebGL renderer (cytoscape v3.31+, provisional API)
        // Types not yet in @types/cytoscape — cast required
        const cy: Core = cytoscape({
            ...baseOptions,
            container,
            renderer: {
                name: 'canvas',
                webgl: true,
                showFps,
                webglDebug: false,
                webglTexSize: 4096,
                webglTexRows: 24,
                webglBatchSize: 2048,
                webglTexPerBatch: 16
            }
        } as CytoscapeOptions);
        return {cy, isHeadless: false};
    } catch (_error) {
        // Fallback to headless mode (e.g., JSDOM without proper layout)
        //console.log('[initializeCytoscapeInstance] Container-based init failed, using headless mode:', error);
        const cy: Core = cytoscape({
            ...baseOptions,
            container: undefined,
            headless: true
        });
        return {cy, isHeadless: true};
    }
}
