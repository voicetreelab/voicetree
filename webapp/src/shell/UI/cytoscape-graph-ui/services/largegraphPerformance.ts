/**
 * Dynamically toggle Cytoscape renderer options for large graphs.
 * When node count exceeds the threshold, enable hideEdgesOnViewport and
 * reduce pixelRatio to 1 for significantly better pan/zoom/drag performance.
 *
 * Verified against cytoscape source (v3.31 cjs bundle):
 * - hideEdgesOnViewport: read from r.hideEdgesOnViewport on every render frame (line 31609)
 * - forcedPixelRatio: read by r.getPixelRatio() on every canvas resize (line 31203)
 *   Applied via cy.resize() which calls matchCanvasSize → getPixelRatio.
 *
 * NOTE: This mutates undocumented renderer internals at runtime. If this causes
 * bugs, the simpler alternative is to always set hideEdgesOnViewport: true and
 * pixelRatio: 1 as init options in initializeCytoscapeInstance.ts — small graphs
 * are fast enough that the visual tradeoff barely matters.
 */
import type { Core } from 'cytoscape';

const LARGE_GRAPH_THRESHOLD: number = 0;

/** Internal renderer properties accessed via cy.renderer() — not in @types/cytoscape */
interface CytoscapeRenderer {
    hideEdgesOnViewport: boolean;
    forcedPixelRatio: number | null;
}

let largeGraphModeActive: boolean = false;

export function syncLargeGraphPerformanceMode(cy: Core): void {
    const nodeCount: number = cy.nodes().length;
    const shouldActivate: boolean = nodeCount > LARGE_GRAPH_THRESHOLD;

    if (shouldActivate === largeGraphModeActive) return;

    const renderer: CytoscapeRenderer | undefined =
        (cy as unknown as { renderer: () => CytoscapeRenderer }).renderer?.();
    if (!renderer) return;

    // r.hideEdgesOnViewport is checked live on every render frame
    renderer.hideEdgesOnViewport = shouldActivate;
    // r.forcedPixelRatio is read by getPixelRatio() on every matchCanvasSize call
    renderer.forcedPixelRatio = shouldActivate ? 1 : null;

    cy.resize(); // triggers matchCanvasSize → picks up new forcedPixelRatio
    largeGraphModeActive = shouldActivate;
}
