/**
 * Dynamically toggle Cytoscape renderer options for large graphs.
 * When node count exceeds the threshold, enable hideEdgesOnViewport
 * for better pan/zoom/drag performance.
 *
 * Verified against cytoscape source (v3.31 cjs bundle):
 * - hideEdgesOnViewport: read from r.hideEdgesOnViewport on every render frame (line 31609)
 *   Edges are hidden when hideEdgesOnViewport && vpManip, where vpManip includes
 *   r.data.wheelZooming (set/cleared via signalViewportManipulation below).
 *
 * Because this app disables userZoomingEnabled and uses custom pan/zoom via
 * NavigationGestureService, cytoscape's internal vpManip flags (wheelZooming,
 * swipePanning) are never set. signalViewportManipulation() bridges this gap.
 */
import type { Core } from 'cytoscape';

const LARGE_GRAPH_THRESHOLD: number = 50;

/** Internal renderer properties accessed via cy.renderer() — not in @types/cytoscape */
interface CytoscapeRenderer {
    hideEdgesOnViewport: boolean;
    data: { wheelZooming: boolean; wheelTimeout: ReturnType<typeof setTimeout> | null };
    redrawHint: (group: string, value: boolean) => void;
    redraw: () => void;
}

let largeGraphModeActive: boolean = false;
let cachedRenderer: CytoscapeRenderer | undefined;

export function syncLargeGraphPerformanceMode(cy: Core): void {
    const nodeCount: number = cy.nodes().length;
    const shouldActivate: boolean = nodeCount > LARGE_GRAPH_THRESHOLD;

    if (shouldActivate === largeGraphModeActive) return;

    const renderer: CytoscapeRenderer | undefined = getRenderer(cy);
    if (!renderer) return;

    renderer.hideEdgesOnViewport = shouldActivate;
    largeGraphModeActive = shouldActivate;
}

function getRenderer(cy: Core): CytoscapeRenderer | undefined {
    if (cachedRenderer) return cachedRenderer;
    cachedRenderer = (cy as unknown as { renderer: () => CytoscapeRenderer }).renderer?.();
    return cachedRenderer;
}

/**
 * Signal to the Cytoscape renderer that a viewport manipulation (pan/zoom) is
 * happening. Sets r.data.wheelZooming = true with a 150ms debounce clear,
 * mirroring cytoscape's internal wheel handler. This makes vpManip true on
 * render frames, which triggers hideEdgesOnViewport.
 *
 * Call from NavigationGestureService on every pan/zoom event.
 */
export function signalViewportManipulation(cy: Core): void {
    const renderer: CytoscapeRenderer | undefined = getRenderer(cy);
    if (!renderer) return;
    if (!renderer.hideEdgesOnViewport) return; // no-op when edge hiding is off

    renderer.data.wheelZooming = true;
    if (renderer.data.wheelTimeout) clearTimeout(renderer.data.wheelTimeout);
    renderer.data.wheelTimeout = setTimeout(() => {
        renderer.data.wheelZooming = false;
        renderer.redrawHint('eles', true);
        renderer.redraw();
    }, 150);
}
