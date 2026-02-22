/**
 * Pure factory function for creating a Cytoscape instance
 * Handles container-based initialization with headless fallback for testing environments
 */
import cytoscape, {type Core, type CytoscapeOptions, type StylesheetCSS} from 'cytoscape';
import {MIN_ZOOM, MAX_ZOOM} from '@/shell/UI/cytoscape-graph-ui/constants';

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
 * Cytoscape's WebGL render path (overrideCanvasRendererFunctions) doesn't emit the
 * 'render' event that the canvas path emits. This breaks cytoscape-navigator's
 * onRender-based thumbnail updates. Patch the renderer to always emit 'render'.
 */
function patchWebglRenderEvent(cy: Core): void {
    // renderer() is not in @types/cytoscape — access via cast
    const renderer: { webgl?: boolean; render: (options?: unknown) => void } =
        (cy as unknown as { renderer: () => { webgl?: boolean; render: (options?: unknown) => void } }).renderer();
    if (!renderer.webgl) return;

    const originalRender: (options?: unknown) => void = renderer.render.bind(renderer);
    renderer.render = function (options?: unknown): void {
        originalRender(options);
        // WebGL path skips cy.emit('render'); canvas fallback already emits it,
        // but double-emit is harmless — navigator throttles with rerenderDelay.
        cy.emit('render');
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
                webglTexSize: 4096,
                webglTexRows: 24,
                webglBatchSize: 2048,
                webglTexPerBatch: 16
            }
        } as CytoscapeOptions);
        patchWebglRenderEvent(cy);
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
