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
// Below this on-screen spacing the grid reads as noise rather than structure,
// so we fade it out instead of drawing an indistinct smear.
const MIN_DOT_SPACING = 6;
// Dot radius in graph-space px at `baseSpacing`. Scaling it by zoom alongside
// the spacing keeps the dot *marks* in lockstep too, so the whole pattern is a
// faithful zoom of one graph-space grid. At zoom 1 this is the 1px the CSS
// `--dot-radius` fallback already used, so the resting look is unchanged.
const BASE_DOT_RADIUS = 1;

export function attachDotGridBackground(
    el: HTMLElement,
    baseSpacing: number = DEFAULT_BASE_SPACING
): () => void {
    let rafPending = false;

    const apply = (): void => {
        const layout = getLayout();
        const zoom = layout.zoom ?? 1;
        const pan = layout.pan ?? { x: 0, y: 0 };
        // Cytoscape renders model points as `screen = model * zoom + pan`, so a
        // graph-space grid of spacing `baseSpacing` lands at `baseSpacing * zoom`
        // px and shares the nodes' zoom rate exactly. The spacing law MUST stay
        // linear in zoom — any easing/sigmoid here makes the dots drift against
        // the nodes as you zoom.
        const size = baseSpacing * zoom;

        if (size < MIN_DOT_SPACING) {
            el.style.setProperty('--dot-opacity', '0');
            return;
        }

        el.style.setProperty('--dot-opacity', '1');
        el.style.setProperty('--dot-size', `${size}px`);
        el.style.setProperty('--dot-radius', `${BASE_DOT_RADIUS * zoom}px`);
        // Phase the pattern so model-space grid lines stay pinned to the nodes:
        // a line at model k*baseSpacing sits at screen k*size + pan, i.e. pan % size.
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
