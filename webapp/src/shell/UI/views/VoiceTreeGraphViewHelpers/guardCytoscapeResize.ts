/**
 * Guard against Cytoscape canvas shrinking to unreasonably small dimensions.
 *
 * Cytoscape has internal ResizeObserver + MutationObserver that call cy.resize()
 * whenever the container changes size or attributes (including cursor style changes).
 * During layout instability (e.g. WebGL context loss cascade), the container can
 * momentarily report smaller dimensions, which cy.resize() locks in permanently.
 *
 * Uses window.outerWidth/outerHeight (full BrowserWindow dimensions) as the reference
 * rather than innerWidth/innerHeight, so DevTools docking doesn't fool the guard.
 * The guard blocks resize when the container is smaller than 95% of the expected
 * available area (window minus sidebar and chrome).
 */
import type {Core} from 'cytoscape';

/** Block resize if container is smaller than this fraction of expected dimensions */
const RESIZE_THRESHOLD: number = 1.0;

/** Title bar (38px) + bottom bar (50px) */
const CHROME_HEIGHT_PX: number = 88;

/**
 * Patch cy.resize() to reject suspiciously small container dimensions.
 * Must be called immediately after Cytoscape initialization.
 */
export function guardCytoscapeResize(cy: Core): void {
    const originalResize: () => Core = cy.resize.bind(cy);

    cy.resize = (): Core => {
        const container: HTMLElement | undefined = cy.container() ?? undefined;
        if (!container) console.warn('[guardCytoscapeResize] cy.container() is null, skipping guard');
        if (container) {
            const {clientWidth, clientHeight} = container;
            // Use outerWidth/outerHeight (full BrowserWindow) so DevTools panel
            // doesn't shrink the reference frame and let bad resizes through
            const windowW: number = window.outerWidth;
            const windowH: number = window.outerHeight;

            // Account for the terminal tree sidebar if visible
            const sidebar: Element | null = document.querySelector('.terminal-tree-sidebar');
            const sidebarWidth: number = sidebar instanceof HTMLElement ? sidebar.clientWidth : 0;

            const expectedWidth: number = (windowW - sidebarWidth) * RESIZE_THRESHOLD;
            const expectedHeight: number = (windowH - CHROME_HEIGHT_PX) * RESIZE_THRESHOLD;

            if (clientWidth < expectedWidth || clientHeight < expectedHeight) {
                console.warn(
                    `[guardCytoscapeResize] Blocked resize to ${clientWidth}x${clientHeight} `
                    + `(expected ≥${Math.round(expectedWidth)}x${Math.round(expectedHeight)}, `
                    + `window: ${windowW}x${windowH}, inner: ${window.innerWidth}x${window.innerHeight}, sidebar: ${sidebarWidth}px)`
                );
                return cy;
            }
        }
        const zoomBefore: number = cy.zoom();
        const widthBefore: number = cy.width();
        const heightBefore: number = cy.height();
        const result: Core = originalResize();
        const zoomAfter: number = cy.zoom();
        const widthAfter: number = cy.width();
        const heightAfter: number = cy.height();
        if (widthBefore !== widthAfter || heightBefore !== heightAfter) {
            console.warn(
                `[guardCytoscapeResize] Resize changed dimensions: ${widthBefore}x${heightBefore} → ${widthAfter}x${heightAfter}, `
                + `zoom: ${zoomBefore} → ${zoomAfter}, `
                + `outer=${window.outerWidth}x${window.outerHeight}, inner=${window.innerWidth}x${window.innerHeight}`
            );
        }
        return result;
    };
}
