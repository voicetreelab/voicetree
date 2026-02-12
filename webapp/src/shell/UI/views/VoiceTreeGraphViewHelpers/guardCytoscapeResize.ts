/**
 * Guard against Cytoscape canvas shrinking to unreasonably small dimensions.
 *
 * Cytoscape has internal ResizeObserver + MutationObserver that call cy.resize()
 * whenever the container changes size or attributes (including cursor style changes).
 * During layout instability (e.g. WebGL context loss cascade), the container can
 * momentarily report smaller dimensions, which cy.resize() locks in permanently.
 *
 * The guard blocks resize when the container is smaller than 95% of the expected
 * available area (viewport minus sidebar and chrome), which catches spurious shrinks
 * while allowing legitimate window resizes.
 */
import type {Core} from 'cytoscape';

/** Block resize if container is smaller than this fraction of expected dimensions */
const RESIZE_THRESHOLD: number = 0.95;

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
        if (container) {
            const {clientWidth, clientHeight} = container;
            const screenW: number = window.innerWidth;
            const screenH: number = window.innerHeight;

            // Account for the terminal tree sidebar if visible
            const sidebar: Element | null = document.querySelector('.terminal-tree-sidebar');
            const sidebarWidth: number = sidebar instanceof HTMLElement ? sidebar.clientWidth : 0;

            const expectedWidth: number = (screenW - sidebarWidth) * RESIZE_THRESHOLD;
            const expectedHeight: number = (screenH - CHROME_HEIGHT_PX) * RESIZE_THRESHOLD;

            if (clientWidth < expectedWidth || clientHeight < expectedHeight) {
                console.warn(
                    `[guardCytoscapeResize] Blocked resize to ${clientWidth}x${clientHeight} `
                    + `(expected ≥${Math.round(expectedWidth)}x${Math.round(expectedHeight)}, `
                    + `screen: ${screenW}x${screenH}, sidebar: ${sidebarWidth}px)`
                );
                return cy;
            }
        }
        return originalResize();
    };
}
