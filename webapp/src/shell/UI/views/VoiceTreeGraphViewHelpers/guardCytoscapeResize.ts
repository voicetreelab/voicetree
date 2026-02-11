/**
 * Guard against Cytoscape canvas shrinking to unreasonably small dimensions.
 *
 * Cytoscape has internal ResizeObserver + MutationObserver that call cy.resize()
 * whenever the container changes size or attributes (including cursor style changes).
 * During layout instability (e.g. WebGL context loss cascade), the container can
 * momentarily report smaller dimensions, which cy.resize() locks in permanently.
 *
 * This wraps cy.resize() to skip resize when the container is much smaller than
 * the screen — the graph canvas should be ~90% of the UI, so <60% signals a problem.
 */
import type {Core} from 'cytoscape';

const MIN_SCREEN_RATIO: number = 0.6;

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

            if (clientWidth < screenW * MIN_SCREEN_RATIO || clientHeight < screenH * MIN_SCREEN_RATIO) {
                console.warn(
                    `[guardCytoscapeResize] Blocked resize to ${clientWidth}x${clientHeight} `
                    + `(screen: ${screenW}x${screenH}, threshold: ${MIN_SCREEN_RATIO * 100}%)`
                );
                return cy;
            }
        }
        return originalResize();
    };
}
