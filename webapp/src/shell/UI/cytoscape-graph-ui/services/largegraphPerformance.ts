/**
 * Dynamically toggle Cytoscape renderer options for large graphs.
 * When node count exceeds the threshold, enable performance optimizations
 * for better pan/zoom/drag performance.
 *
 * Verified against cytoscape source (v3.31 cjs bundle):
 * - hideEdgesOnViewport: read from r.hideEdgesOnViewport on every render frame (line 31609)
 *   Edges are hidden when hideEdgesOnViewport && vpManip, where vpManip includes
 *   r.data.wheelZooming (set/cleared via signalViewportManipulation below).
 * - textureOnViewport: captures viewport as bitmap during vpManip (canvas path only,
 *   active when WebGL falls back to canvas at zoom > maxZoom)
 *
 * Because this app disables userZoomingEnabled and uses custom pan/zoom via
 * NavigationGestureService, cytoscape's internal vpManip flags (wheelZooming,
 * swipePanning) are never set. signalViewportManipulation() bridges this gap.
 */
import type { Core } from 'cytoscape';

const LARGE_GRAPH_THRESHOLD: number = 0;

/** Internal renderer properties accessed via cy.renderer() — not in @types/cytoscape */
interface CytoscapeRenderer {
    hideEdgesOnViewport: boolean;
    textureOnViewport: boolean;
    data: {
        wheelZooming: boolean;
        wheelTimeout: ReturnType<typeof setTimeout> | null;
        eleTxrCache?: { setupDequeueing: () => void; invalidateElement: (ele: unknown) => void };
        lblTxrCache?: { setupDequeueing: () => void; invalidateElement: (ele: unknown) => void };
        slbTxrCache?: { setupDequeueing: () => void; invalidateElement: (ele: unknown) => void };
        tlbTxrCache?: { setupDequeueing: () => void; invalidateElement: (ele: unknown) => void };
    };
    pinching: boolean;
    hoverData: { dragging: boolean; draggingEles: boolean };
    swipePanning: boolean;
    redrawHint: (group: string, value: boolean) => void;
    redraw: () => void;
}

let largeGraphModeActive: boolean = false;
let cachedRenderer: CytoscapeRenderer | undefined;
let collectionCache: Map<string, unknown> | null = null;
let textureCacheSkipInstalled: boolean = false;
export function syncLargeGraphPerformanceMode(cy: Core): void {
    const nodeCount: number = cy.nodes().length;
    const shouldActivate: boolean = nodeCount > LARGE_GRAPH_THRESHOLD;

    if (shouldActivate === largeGraphModeActive) return;

    const renderer: CytoscapeRenderer | undefined = getRenderer(cy);
    if (!renderer) return;

    renderer.hideEdgesOnViewport = shouldActivate;
    renderer.textureOnViewport = shouldActivate;
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
 * render frames, which triggers hideEdgesOnViewport + textureOnViewport.
 *
 * Call from NavigationGestureService on every pan/zoom event.
 */
export function signalViewportManipulation(cy: Core): void {
    const renderer: CytoscapeRenderer | undefined = getRenderer(cy);
    if (!renderer) return;
    if (!largeGraphModeActive) return;

    renderer.data.wheelZooming = true;
    if (renderer.data.wheelTimeout) clearTimeout(renderer.data.wheelTimeout);
    renderer.data.wheelTimeout = setTimeout(() => {
        renderer.data.wheelZooming = false;
        collectionCache?.clear();
        renderer.redrawHint('eles', true);
        renderer.redraw();
    }, 150);
}

/**
 * Monkey-patches cy.nodes(), cy.edges(), and cy.elements() to return cached
 * collections while r.data.wheelZooming is true. Eliminates redundant Cytoscape
 * traversal overhead on every pan/zoom render frame.
 *
 * Cache key is 'method:selector' — cy.nodes() and cy.nodes('.visible') are
 * separate entries. Cache is invalidated on element add/remove events and when
 * wheelZooming transitions to false (via signalViewportManipulation timeout).
 *
 * Call once during graph initialisation. Idempotent — safe to call multiple times.
 * Depends on getRenderer(cy), so cy must have a renderer attached.
 */
export function installCollectionCache(cy: Core): void {
    if (collectionCache !== null) return; // already installed
    collectionCache = new Map();

    const orig: {
        nodes: (selector?: string) => ReturnType<Core['nodes']>;
        edges: (selector?: string) => ReturnType<Core['edges']>;
        elements: (selector?: string) => ReturnType<Core['elements']>;
    } = {
        nodes: cy.nodes.bind(cy) as (selector?: string) => ReturnType<Core['nodes']>,
        edges: cy.edges.bind(cy) as (selector?: string) => ReturnType<Core['edges']>,
        elements: cy.elements.bind(cy) as (selector?: string) => ReturnType<Core['elements']>,
    };

    function cached<T>(
        method: 'nodes' | 'edges' | 'elements',
        original: (selector?: string) => T,
        selector?: string,
    ): T {
        const r: CytoscapeRenderer | undefined = getRenderer(cy);
        if (r?.data.wheelZooming) {
            const key: string = `${method}:${selector ?? ''}`;
            const hit: unknown = collectionCache!.get(key);
            if (hit !== undefined) return hit as T;
            const result: T = original(selector);
            collectionCache!.set(key, result);
            return result;
        }
        return original(selector);
    }

    const cyAny: Record<string, unknown> = cy as unknown as Record<string, unknown>;
    cyAny.nodes = (selector?: string) => cached('nodes', orig.nodes, selector);
    cyAny.edges = (selector?: string) => cached('edges', orig.edges, selector);
    cyAny.elements = (selector?: string) => cached('elements', orig.elements, selector);

    cy.on('add remove', () => { collectionCache!.clear(); });
}

/**
 * Monkey-patches Cytoscape's ElementTextureCache instances to skip
 * invalidateElement() calls when r.data.wheelZooming is true.
 * During viewport manipulation, element data hasn't changed — only the camera
 * moved — so texture re-rasterization is pure waste (~8% CPU at 500 nodes).
 *
 * Call once during graph initialisation. Idempotent.
 */
export function installTextureCacheSkip(cy: Core): void {
    if (textureCacheSkipInstalled) return;
    const renderer: CytoscapeRenderer | undefined = getRenderer(cy);
    if (!renderer) return;

    const cacheKeys: ReadonlyArray<'eleTxrCache' | 'lblTxrCache' | 'slbTxrCache' | 'tlbTxrCache'> = ['eleTxrCache', 'lblTxrCache', 'slbTxrCache', 'tlbTxrCache'];
    for (const key of cacheKeys) {
        const cache: CytoscapeRenderer['data'][typeof key] = renderer.data[key];
        if (!cache || !cache.invalidateElement) continue;
        const originalInvalidate: (ele: unknown) => void = cache.invalidateElement.bind(cache);
        cache.invalidateElement = function (ele: unknown): void {
            if (renderer.data.wheelZooming) return;
            originalInvalidate(ele);
        };
    }
    textureCacheSkipInstalled = true;
}
