/**
 * Pure factory function for creating a Cytoscape instance
 * Handles container-based initialization with headless fallback for testing environments
 */
import cytoscape, {type Core, type CytoscapeOptions, type Stylesheet} from 'cytoscape';
import {MIN_ZOOM, MAX_ZOOM} from '@/shell/UI/cytoscape-graph-ui/constants';

export interface CytoscapeInitConfig {
    container: HTMLElement;
    stylesheet: Stylesheet[];
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
    const {container, stylesheet} = config;

    const baseOptions: CytoscapeOptions = {
        elements: [],
        style: stylesheet,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        boxSelectionEnabled: true,
        userZoomingEnabled:false
    };

    // Try container-based initialization first
    try {
        const cy: Core = cytoscape({
            ...baseOptions,
            container
        });
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
