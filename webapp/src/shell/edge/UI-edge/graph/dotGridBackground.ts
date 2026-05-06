/**
 * Subtle dot-grid background for the canvas.
 *
 * Mirrors layoutStore pan/zoom into two CSS custom properties on a target
 * element, which a `.dot-grid` CSS rule consumes to tile a radial-gradient
 * pattern. The Cytoscape canvas is transparent, so this underlay shows
 * through without contending with the WebGL renderer.
 */

import { getLayout, subscribeLayout } from '@vt/graph-state/state/layoutStore';

const DEFAULT_BASE_SPACING = 24;
const MIN_DOT_SPACING = 6; // hide pattern below this to avoid moiré

export function attachDotGridBackground(
    el: HTMLElement,
    baseSpacing: number = DEFAULT_BASE_SPACING
): () => void {
    let rafPending = false;

    const apply = (): void => {
        const layout = getLayout();
        const zoom = layout.zoom ?? 1;
        const pan = layout.pan ?? { x: 0, y: 0 };
        const size = baseSpacing * zoom;

        if (size < MIN_DOT_SPACING) {
            el.style.setProperty('--dot-opacity', '0');
            return;
        }

        el.style.setProperty('--dot-opacity', '1');
        el.style.setProperty('--dot-size', `${size}px`);
        el.style.setProperty('--dot-x', `${pan.x % size}px`);
        el.style.setProperty('--dot-y', `${pan.y % size}px`);
    };

    const schedule = (): void => {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => {
            rafPending = false;
            apply();
        });
    };

    apply();
    const unsubscribe = subscribeLayout(schedule);
    return unsubscribe;
}
