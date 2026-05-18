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
const MIN_DOT_SPACING = 6;

const DOT_SIZE_MIN = 10;
const DOT_SIZE_MAX = 48;
const DOT_SIZE_MID = (DOT_SIZE_MIN + DOT_SIZE_MAX) / 2;
const DOT_SIZE_HALF = (DOT_SIZE_MAX - DOT_SIZE_MIN) / 2;
// k = 1/HALF_RANGE gives derivative = 1 at the center, so the sigmoid
// matches the linear feel in the sweet spot and only curves at extremes.
const SIGMOID_K = 1 / DOT_SIZE_HALF;

export function attachDotGridBackground(
    el: HTMLElement,
    baseSpacing: number = DEFAULT_BASE_SPACING
): () => void {
    let rafPending = false;

    const apply = (): void => {
        const layout = getLayout();
        const zoom = layout.zoom ?? 1;
        const pan = layout.pan ?? { x: 0, y: 0 };
        const linearSize = baseSpacing * zoom;
        const size = DOT_SIZE_MID + DOT_SIZE_HALF * Math.tanh(SIGMOID_K * (linearSize - DOT_SIZE_MID));

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
