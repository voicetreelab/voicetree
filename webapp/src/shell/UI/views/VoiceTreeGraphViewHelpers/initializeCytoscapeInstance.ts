/**
 * Pure factory function for creating a Cytoscape instance
 * Handles container-based initialization with headless fallback for testing environments
 */
import cytoscape, {type Core, type CytoscapeOptions, type StylesheetCSS} from 'cytoscape';
import {MIN_ZOOM, MAX_ZOOM} from '@/shell/UI/cytoscape-graph-ui/constants';
import {installCollectionCache, installTextureCacheSkip} from '@/shell/UI/cytoscape-graph-ui/services/animation/largegraphPerformance';

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
 * WebGL texture-atlas size (px) for the label atlas, chosen to keep node-title
 * text crisp. Paired with `webglTexRows: 24` this gives a per-label atlas row of
 * 4096/24 ≈ 170px.
 *
 * Why this matters: cytoscape's experimental WebGL renderer rasterizes every
 * node label once into a single atlas row of height `webglTexSize / webglTexRows`
 * — and a multi-line title's *whole* bounding box must fit that one row (see
 * cytoscape's `atlas.mjs` getScale, which also flags "TODO what about
 * pixelRatio?"). The stock 2048 → 85px row downscales the taller titles measured
 * on the live graph (single line ≈40px up to a 6-line title ≈132px) into far too
 * few texels, so they read soft even at zoom 1 — confirmed by an A/B against
 * cy.png()'s canvas path, which renders the same titles vector-sharp.
 *
 * 4096 (row ≈170px) exceeds the tallest measured title, so labels are no longer
 * downscaled in the atlas: titles are crisp on a standard (DPR 1) display and
 * roughly twice as sharp on HiDPI. Verified on the real WebGL renderer (Chromium
 * + cytoscape) at DPR 1 and DPR 2.
 *
 * Why not larger / DPR-scaled: scaling texSize (rather than cutting texRows) was
 * chosen because it raises the per-label texel budget WITHOUT increasing the
 * atlas *count* — atlas count, not size, drives the per-frame texture binds, so
 * the WebGL batching win the renderer was enabled for is preserved. 8192 would
 * fully sharpen 6-line titles on retina too, but it equals the MAX_TEXTURE_SIZE
 * of lower-end GPUs and rendered *blank* at DPR 2 in testing (a hard texture-size
 * limit), for a marginal gain at 4× the VRAM. 4096 is the measured sweet spot:
 * well within every tested GPU's limits while fixing the reported blur.
 */
const WEBGL_LABEL_ATLAS_SIZE = 4096;

/**
 * Cytoscape's WebGL render path (overrideCanvasRendererFunctions) doesn't emit the
 * 'render' event that the canvas path emits. This breaks cytoscape-navigator's
 * onRender-based thumbnail updates. Patch the renderer to emit 'render' — but
 * SKIP during viewport manipulation (vpManip) to avoid the navigator calling
 * cy.png() → toDataURL which was 21% of CPU during pan/zoom.
 *
 * The navigator's viewport rectangle still updates during vpManip because it
 * listens to 'zoom pan' events (not 'render'). The thumbnail updates when
 * vpManip ends and the final redraw emits 'render'.
 */
function patchWebglRenderEvent(cy: Core): void {
    // renderer() is not in @types/cytoscape — access via cast
    const renderer: {
        webgl?: boolean;
        render: (options?: unknown) => void;
        data?: { wheelZooming?: boolean };
        pinching?: boolean;
        swipePanning?: boolean;
        hoverData?: { draggingEles?: boolean };
    } =
        (cy as unknown as { renderer: () => typeof renderer }).renderer();
    if (!renderer.webgl) return;

    const originalRender: (options?: unknown) => void = renderer.render.bind(renderer);
    renderer.render = function (options?: unknown): void {
        originalRender(options);
        // Skip 'render' event during viewport manipulation to prevent navigator
        // minimap from calling cy.png() → toDataURL (was 21% of CPU during pan/zoom)
        // vpManip depends on renderer.data.wheelZooming, set by signalViewportManipulation()
        // in largegraphPerformance.ts (called by NavigationGestureService on pan/zoom)
        const vpManip: boolean = renderer.data?.wheelZooming === true
            || renderer.pinching === true
            || renderer.swipePanning === true
            || renderer.hoverData?.draggingEles === true;
        if (!vpManip) {
            cy.emit('render');
        }
    };
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
                webglTexSize: WEBGL_LABEL_ATLAS_SIZE, // crisp multi-line titles; see constant doc
                webglTexRows: 24,
                webglBatchSize: 2048,
                webglTexPerBatch: 16
            }
        } as CytoscapeOptions);
        patchWebglRenderEvent(cy);
        installCollectionCache(cy);
        installTextureCacheSkip(cy);
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
