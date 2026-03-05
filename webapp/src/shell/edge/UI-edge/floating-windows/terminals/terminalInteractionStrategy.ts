/**
 * Interaction-driven terminal scaling strategy.
 *
 * Switches terminal from css-transform to dimension-scaling on pointerdown,
 * so xterm.js text selection works correctly (getBoundingClientRect bug workaround).
 *
 * Replaces the old zoom-threshold-based strategy (terminalZoomSettleEdge.ts).
 * Default is css-transform (cheap). On user interaction, switch to dimension-scaling
 * (expensive but correct for text selection) synchronously before xterm processes the click.
 */

import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { isZoomActive, getCachedZoom } from '@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows';
import { getCyInstance } from '@/shell/edge/UI-edge/state/cytoscape-state';
import { getTerminalFontSize, TERMINAL_CSS_TRANSFORM_THRESHOLD } from '@/pure/graph/floating-windows/floatingWindowScaling';
import { updateWindowFromZoom } from '@/shell/edge/UI-edge/floating-windows/update-window-from-zoom';

/**
 * Set up interaction-driven strategy switching for a terminal window.
 *
 * Listens for pointerdown (capture phase, before xterm's mousedown) and
 * switches to dimension-scaling so text selection coordinates are correct.
 *
 * @param container - The .cy-floating-window-content element wrapping xterm
 * @param term - The xterm.js Terminal instance
 * @param fitAddon - The FitAddon for recalculating cols/rows
 * @returns Cleanup function to remove the listener
 */
export function setupTerminalInteractionStrategy(
    container: HTMLElement,
    term: XTerm,
    fitAddon: FitAddon
): () => void {
    const handler: (e: PointerEvent) => void = (_e: PointerEvent): void => {
        // Don't switch during active zoom — overlay scale handles visuals
        if (isZoomActive()) return;

        const zoom: number = getCachedZoom();

        // At very low zoom, text selection is impractical — stay in css-transform
        if (zoom < TERMINAL_CSS_TRANSFORM_THRESHOLD) return;

        const windowElement: HTMLElement | null = container.closest('.cy-floating-window') as HTMLElement | null;
        if (!windowElement) return;

        // Already in dimension-scaling — no work needed
        if (windowElement.dataset.interactionStrategy === 'dimension-scaling') return;

        // Set the user's preference — persists across zoom cycles
        windowElement.dataset.interactionStrategy = 'dimension-scaling';

        // Apply dimension-scaling: updates DOM dimensions, transform, title bar
        const cy: import('cytoscape').Core = getCyInstance();
        updateWindowFromZoom(cy, windowElement, zoom);

        // Update font size to match dimension-scaling mode
        term.options.fontSize = getTerminalFontSize(zoom, 'dimension-scaling');

        // Fit synchronously so xterm's mousedown (which fires after capture) sees correct coordinates
        fitAddon.fit();
    };

    // Capture phase: runs before xterm's mousedown handler
    container.addEventListener('pointerdown', handler, { capture: true });

    return () => {
        container.removeEventListener('pointerdown', handler, { capture: true });
    };
}
