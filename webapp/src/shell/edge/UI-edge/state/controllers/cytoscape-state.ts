/**
 * Cytoscape state accessor
 *
 * Gets the cytoscape instance from window where VoiceTreeGraphView exposes it.
 * This allows UI API functions to access cy without passing it through parameters.
 */

import type { Core } from 'cytoscape';

/**
 * Get the global Cytoscape instance
 * @throws Error if cytoscape is not initialized
 */
export function getCyInstance(): Core {
    const cy: Core | undefined = (window as unknown as { cytoscapeInstance?: Core }).cytoscapeInstance;
    if (!cy) {
        throw new Error('Cytoscape instance not initialized - getCyInstance called before VoiceTreeGraphView render');
    }
    return cy;
}

/**
 * Check if Cytoscape is initialized
 */
export function isCyInitialized(): boolean {
    return !!(window as unknown as { cytoscapeInstance?: Core }).cytoscapeInstance;
}
