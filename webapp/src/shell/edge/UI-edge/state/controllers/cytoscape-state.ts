/**
 * Cytoscape state accessor — single source of truth for the LIVE cy instance.
 *
 * VoiceTreeGraphView calls setCyInstance() on mount and clearCyInstance() on
 * dispose. UI API functions reach the instance without threading it through
 * parameters.
 *
 * getCyInstance() throws when no live cy exists; callers that may fire before
 * the graph view mounts (IPC-driven terminal launches) guard with
 * isCyInitialized() and no-op — rehydrate() replays them once cy is live.
 *
 * Every accessor treats a destroyed cy as absent (cy.destroyed()), so a caller
 * can never operate on a torn-down instance.
 */

import type { Core } from 'cytoscape';

interface CytoscapeWindow {
    cytoscapeInstance?: Core;
}

let liveCy: Core | null = null;

function isAlive(cy: Core | null): cy is Core {
    return !!cy && !cy.destroyed();
}

/**
 * Register the live cy instance (called from VoiceTreeGraphView on mount).
 * Mirrors onto window for the floating-window extensions that read it directly.
 */
export function setCyInstance(cy: Core): void {
    liveCy = cy;
    (window as unknown as CytoscapeWindow).cytoscapeInstance = cy;
}

/**
 * Clear the live cy instance (called FIRST in disposeGraphView, before
 * cy.destroy(), so nothing can hand out a dead instance during teardown).
 */
export function clearCyInstance(): void {
    liveCy = null;
    delete (window as unknown as CytoscapeWindow).cytoscapeInstance;
}

/**
 * Get the live Cytoscape instance.
 * @throws Error if no live cytoscape instance exists.
 */
export function getCyInstance(): Core {
    if (!isAlive(liveCy)) {
        throw new Error('Cytoscape instance not initialized - getCyInstance called before VoiceTreeGraphView render');
    }
    return liveCy;
}

/**
 * Check if a live Cytoscape instance exists.
 */
export function isCyInitialized(): boolean {
    return isAlive(liveCy);
}

/**
 * Read the live cy's zoom, or `fallback` when no live cy exists. For
 * callbacks (ResizeObserver, xterm onResize) that can fire while the graph
 * view is mid-teardown or not yet mounted, where the synchronous
 * getCyInstance() would throw. A fallback of 1 means "no zoom scaling", which
 * is the correct neutral value for a terminal being created or torn down.
 */
export function getCyZoom(fallback: number = 1): number {
    return isAlive(liveCy) ? liveCy.zoom() : fallback;
}
