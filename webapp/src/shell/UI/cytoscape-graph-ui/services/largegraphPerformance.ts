/**
 * Dynamically toggle Cytoscape renderer options for large graphs.
 * When node count exceeds the threshold, enable hideEdgesOnViewport and
 * reduce pixelRatio to 1 for significantly better pan/zoom/drag performance.
 */
import type { Core } from 'cytoscape';

const LARGE_GRAPH_THRESHOLD: number = 50;

interface CytoscapeRendererOptions {
    hideEdgesOnViewport: boolean;
    pixelRatio: number | undefined;
}

type CytoscapeRenderer = {
    options: CytoscapeRendererOptions;
    invalidateContainerClientCoordsCache: (() => void) | undefined;
};

let largeGraphModeActive: boolean = false;

export function syncLargeGraphPerformanceMode(cy: Core): void {
    const nodeCount: number = cy.nodes().length;
    const shouldActivate: boolean = nodeCount > LARGE_GRAPH_THRESHOLD;

    if (shouldActivate === largeGraphModeActive) return;

    const renderer: CytoscapeRenderer | undefined =
        (cy as unknown as { renderer: () => CytoscapeRenderer }).renderer?.();
    if (!renderer?.options) return;

    renderer.options.hideEdgesOnViewport = shouldActivate;
    renderer.options.pixelRatio = shouldActivate ? 1 : undefined; // undefined = use device pixel ratio

    cy.resize(); // re-initialize canvas dimensions at new pixel ratio
    largeGraphModeActive = shouldActivate;
}
