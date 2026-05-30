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
        // VoiceTree extension: flushers installed by installTextureCacheSkip,
        // replayed when wheelZooming clears so invalidations deferred during
        // pan/zoom actually reach the texture caches.
        _vtTxrFlushers?: Array<() => void>;
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
/**
 * Same as signalViewportManipulation but uses the cached renderer — no cy
 * reference needed. Safe to call after initializeCytoscapeInstance has run
 * (which calls installCollectionCache/installTextureCacheSkip to warm the
 * cache). No-op if the cache is cold.
 */
export function signalViewportManipulationCached(): void {
    if (!cachedRenderer) return;
    applyViewportManipulationSignal(cachedRenderer);
}

function applyViewportManipulationSignal(renderer: CytoscapeRenderer): void {
    if (!largeGraphModeActive) return;
    renderer.data.wheelZooming = true;
    if (renderer.data.wheelTimeout) clearTimeout(renderer.data.wheelTimeout);
    renderer.data.wheelTimeout = setTimeout(() => {
        renderer.data.wheelZooming = false;
        collectionCache?.clear();
        // Replay label/element texture invalidations that were deferred during pan/zoom.
        // Without this, data changes that landed inside the wheelZooming window leave
        // stale textures (blank or clipped labels) until something else forces a refresh.
        const flushers: Array<() => void> = renderer.data._vtTxrFlushers ?? [];
        for (const flush of flushers) flush();
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

    /**
     * cy.batching() exists at runtime in cytoscape v3.x but is not in
     * @types/cytoscape. Detect it once here, mirroring installTextureCacheSkip.
     * If unavailable, the cache only fires during wheelZooming (today's behavior).
     */
    const cyBatching: (() => boolean) | undefined = typeof (cy as unknown as { batching?: unknown }).batching === 'function'
        ? (cy as unknown as { batching: () => boolean }).batching.bind(cy)
        : undefined;

    function cached<T>(
        method: 'nodes' | 'edges' | 'elements',
        original: (selector?: string) => T,
        selector?: string,
    ): T {
        const r: CytoscapeRenderer | undefined = getRenderer(cy);
        const isPanZoom: boolean = r?.data.wheelZooming === true;
        const isBatchUnqualified: boolean = selector === undefined && cyBatching !== undefined && cyBatching();
        if (isPanZoom || isBatchUnqualified) {
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

    // Capture the cache in the closure rather than reading the module-level
    // `collectionCache`: the handler outlives a dispose (it is removed only when
    // cy.destroy() tears down listeners), and by then resetLargeGraphPerformanceState
    // has nulled the module field — or a new graph view has installed a fresh
    // cache for a different cy. Clearing the captured map is always correct and
    // never dereferences null. The destroyed() guard skips work during teardown.
    const cache: Map<string, unknown> = collectionCache; // non-null: guarded + assigned above
    cy.on('add remove', () => {
        if (cy.destroyed()) return;
        cache.clear();
    });
}

/**
 * Monkey-patches Cytoscape's ElementTextureCache instances to skip
 * invalidateElement() calls when r.data.wheelZooming is true.
 * During viewport manipulation, element data hasn't changed — only the camera
 * moved — so texture re-rasterization is pure waste (~8% CPU at 500 nodes).
 *
 * Additionally, while a cy.batch() is in progress, defers invalidateElement
 * calls into per-cache Sets and replays them after endBatch returns. The
 * same set of originalInvalidate(ele) calls happens across the lifetime of
 * any batch — they are merely collected and executed in one pass after the
 * batch closes, instead of interleaved with every data mutation. End state
 * of the texture caches is identical to the un-batched path.
 *
 * Call once during graph initialisation. Idempotent.
 */
export function installTextureCacheSkip(cy: Core): void {
    if (textureCacheSkipInstalled) return;
    const renderer: CytoscapeRenderer | undefined = getRenderer(cy);
    if (!renderer) return;

    /**
     * cy.batching() exists at runtime in cytoscape v3.x but is not in
     * @types/cytoscape. Cast narrowly here, mirroring the hand-rolled
     * CytoscapeRenderer interface pattern above.
     */
    const cyWithBatching: { batching: () => boolean } = cy as unknown as { batching: () => boolean };

    const cacheKeys: ReadonlyArray<'eleTxrCache' | 'lblTxrCache' | 'slbTxrCache' | 'tlbTxrCache'> = ['eleTxrCache', 'lblTxrCache', 'slbTxrCache', 'tlbTxrCache'];

    type TxrCache = NonNullable<CytoscapeRenderer['data'][typeof cacheKeys[number]]>;
    const flushers: Array<() => void> = [];

    for (const key of cacheKeys) {
        const cache: CytoscapeRenderer['data'][typeof key] = renderer.data[key];
        if (!cache || !cache.invalidateElement) continue;
        const originalInvalidate: (ele: unknown) => void = cache.invalidateElement.bind(cache);
        const deferred: Set<unknown> = new Set<unknown>();
        const boundCache: TxrCache = cache;

        boundCache.invalidateElement = function (ele: unknown): void {
            if (renderer.data.wheelZooming || cyWithBatching.batching()) {
                deferred.add(ele);
                return;
            }
            originalInvalidate(ele);
        };

        flushers.push((): void => {
            if (deferred.size === 0) return;
            // Don't flush while still wheelZooming — defer until the pan/zoom debounce
            // timeout fires, then this same flusher runs from renderer.data._vtTxrFlushers.
            if (renderer.data.wheelZooming) return;
            for (const ele of deferred) originalInvalidate(ele);
            deferred.clear();
        });
    }

    renderer.data._vtTxrFlushers = flushers;

    const originalEndBatch: () => Core = cy.endBatch.bind(cy) as () => Core;
    (cy as unknown as { endBatch: () => Core }).endBatch = function (): Core {
        const result: Core = originalEndBatch();
        // Only flush at the outermost batch boundary — nested startBatch/endBatch
        // calls leave batching() true until the outer endBatch decrements to zero.
        if (!cyWithBatching.batching()) {
            for (const flush of flushers) flush();
        }
        return result;
    };

    textureCacheSkipInstalled = true;
}

export function resetLargeGraphPerformanceState(): void {
    largeGraphModeActive = false;
    cachedRenderer = undefined;
    collectionCache = null;
    textureCacheSkipInstalled = false;
}
