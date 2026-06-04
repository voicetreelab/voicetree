// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    _resetLayoutStoreForTests,
    dispatchSetPan,
    dispatchSetZoom,
    flushLayout,
} from '@vt/graph-state/state/layoutStore';

import { attachDotGridBackground } from './dotGridBackground';

const BASE_SPACING = 24;

/**
 * Commit a zoom/pan into the singleton layout store synchronously, the way the
 * renderer would once a frame's gestures settle.
 */
function setLayout(zoom: number, pan: { x: number; y: number } = { x: 0, y: 0 }): void {
    dispatchSetZoom(zoom);
    dispatchSetPan(pan);
    flushLayout();
}

function px(el: HTMLElement, prop: string): number {
    return parseFloat(el.style.getPropertyValue(prop));
}

describe('attachDotGridBackground', () => {
    let el: HTMLElement;
    let detach: () => void;

    beforeEach(() => {
        _resetLayoutStoreForTests();
        el = document.createElement('div');
    });

    afterEach(() => {
        detach?.();
        _resetLayoutStoreForTests();
    });

    it('spaces dots linearly in zoom, locking them to the nodes', () => {
        setLayout(1);
        detach = attachDotGridBackground(el, BASE_SPACING);
        expect(px(el, '--dot-size')).toBe(BASE_SPACING);
    });

    it('doubles spacing and radius when zoom doubles (same rate as nodes)', () => {
        setLayout(1);
        detach = attachDotGridBackground(el, BASE_SPACING);
        const size1 = px(el, '--dot-size');
        const radius1 = px(el, '--dot-radius');

        setLayout(2);
        flushLayout();

        // The store schedules a rAF flush; force the next frame so apply() runs.
        return new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
                expect(px(el, '--dot-size')).toBeCloseTo(size1 * 2);
                expect(px(el, '--dot-radius')).toBeCloseTo(radius1 * 2);
                resolve();
            });
        });
    });

    it('fades out when zoomed far enough that spacing reads as noise', () => {
        setLayout(0.1); // 24 * 0.1 = 2.4px < MIN_DOT_SPACING
        detach = attachDotGridBackground(el, BASE_SPACING);
        expect(px(el, '--dot-opacity')).toBe(0);
    });

    it('phases the pattern by pan modulo spacing so grid lines pin to nodes', () => {
        setLayout(2, { x: 100, y: 100 }); // size = 48, 100 % 48 = 4
        detach = attachDotGridBackground(el, BASE_SPACING);
        expect(px(el, '--dot-x')).toBeCloseTo(100 % 48);
        expect(px(el, '--dot-y')).toBeCloseTo(100 % 48);
    });
});
