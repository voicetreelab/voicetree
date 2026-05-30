/**
 * Cytoscape state accessor — single source of truth for the LIVE cy instance.
 *
 * VoiceTreeGraphView calls setCyInstance() on mount and clearCyInstance() on
 * dispose. UI API functions reach the instance without threading it through
 * parameters.
 *
 * Two access modes:
 * - getCyInstance() throws when no live cy exists. Use only from synchronous
 *   call sites driven by user interaction, where the graph view provably exists.
 * - whenCyReady() resolves the instant a live cy is set (immediately if one
 *   already exists). Use from IPC-driven entry points that may fire before the
 *   graph view has mounted (e.g. main replaying terminal launches on reload) —
 *   the call queues instead of throwing, and replays onto the cy once ready.
 *
 * Every accessor treats a destroyed cy as absent (cy.destroyed()), so a caller
 * can never operate on a torn-down instance.
 */

import type { Core } from 'cytoscape';

interface CytoscapeWindow {
    cytoscapeInstance?: Core;
}

let liveCy: Core | null = null;
let readyWaiters: Array<(cy: Core) => void> = [];

function isAlive(cy: Core | null): cy is Core {
    return !!cy && !cy.destroyed();
}

/**
 * Register the live cy instance (called from VoiceTreeGraphView on mount).
 * Mirrors onto window for the floating-window extensions that read it directly,
 * and flushes any callers parked in whenCyReady().
 */
export function setCyInstance(cy: Core): void {
    liveCy = cy;
    (window as unknown as CytoscapeWindow).cytoscapeInstance = cy;

    const waiters: Array<(cy: Core) => void> = readyWaiters;
    readyWaiters = [];
    for (const resolve of waiters) {
        resolve(cy);
    }
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
 * Resolve with the live cy — immediately if one exists, otherwise when the next
 * one mounts. Never rejects; a call made before any graph view mounts simply
 * waits for the mount (and is replayed if the view is later torn down and
 * remounted).
 */
export function whenCyReady(): Promise<Core> {
    if (isAlive(liveCy)) {
        return Promise.resolve(liveCy);
    }
    return new Promise<Core>((resolve) => {
        readyWaiters.push(resolve);
    });
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
