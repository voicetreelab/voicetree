// @vitest-environment jsdom
/**
 * Hot Zone C — Surface (c): Post-navigation-gesture zoom matches store zoom.
 *
 * Black-box (CLAUDE.md): observable signal is the layoutStore — the public
 * API both the renderer and the gesture service read/write through. The
 * gesture service is not mocked; we drive a real WheelEvent through it and
 * read back the resulting `getLayout().zoom`.
 *
 * Regression intent: prevents regression of `8051de89 fix: sync
 * NavigationGestureService.currentZoom`. The bug — gesture service held a
 * stale local `currentZoom` after external nav (fitToTerminal, search nav)
 * dispatched a different zoom into the store. Subsequent wheel events
 * computed `newZoom = staleZoom * 10^diff`, teleporting the viewport.
 *
 * The fix re-reads `getLayout().zoom` at the start of every gesture (when
 * not animating). This test simulates the exact scenario:
 *   1. Service constructed with zoom=1.
 *   2. Store zoom externally changed to 2 (e.g. fitToTerminal).
 *   3. User pinches to zoom in (ctrlKey wheel; trackpad path = sync apply).
 *   4. Resulting `getLayout().zoom` MUST be `2 * 10^diff`, not `1 * 10^diff`.
 */

import type { Core } from 'cytoscape';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    _resetLayoutStoreForTests,
    dispatchSetZoom,
    flushLayout,
    getLayout,
} from '@vt/graph-state/state/layoutStore';
import { setIsTrackpadScrolling } from '@/shell/edge/UI-edge/state/controllers/trackpad-state';

import { NavigationGestureService } from './NavigationGestureService';

interface ElectronAPIStub {
    main: { loadSettings: () => Promise<{ readonly zoomSensitivity: number }> };
}

function installElectronAPIStub(): void {
    const stub: ElectronAPIStub = {
        main: { loadSettings: () => Promise.resolve({ zoomSensitivity: 1.0 }) },
    };
    Object.defineProperty(window, 'hostAPI', {
        configurable: true,
        writable: true,
        value: stub,
    });
}

function fakeCy(): Core {
    return {} as unknown as Core;
}

function makePinchEvent(deltaY: number): WheelEvent {
    return new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaX: 0,
        deltaY,
        deltaMode: 0,
        ctrlKey: true,
        clientX: 100,
        clientY: 100,
    });
}

/**
 * The gesture service samples the first 4 wheel events to detect "inaccurate"
 * scroll devices (mice that report deltas in chunks). During this sampling
 * phase, deltas with |delta| > 5 are clamped to ±5. We send 4 small priming
 * events that don't trigger the clamp, settling the service into the
 * "accurate device" branch so our test events apply their full magnitude.
 */
function primePastSampling(target: HTMLElement): void {
    for (let i: number = 0; i < 4; i++) {
        target.dispatchEvent(new WheelEvent('wheel', {
            bubbles: true, cancelable: true,
            deltaX: 0, deltaY: 1, deltaMode: 0, ctrlKey: true,
            clientX: 0, clientY: 0,
        }));
    }
}

describe('Hot Zone C (c) — Zoom gesture syncs from layoutStore (no teleport)', () => {
    let container: HTMLElement;
    let service: NavigationGestureService | undefined;

    beforeEach((): void => {
        installElectronAPIStub();
        _resetLayoutStoreForTests();

        // Provide a stable rAF (jsdom supplies one but we don't depend on it
        // here — the trackpad-pinch zoom path is synchronous).
        if (typeof window.requestAnimationFrame !== 'function') {
            window.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
                const id: number = window.setTimeout(() => cb(performance.now()), 16) as unknown as number;
                return id;
            }) as typeof window.requestAnimationFrame;
            window.cancelAnimationFrame = ((id: number): void => {
                window.clearTimeout(id);
            }) as typeof window.cancelAnimationFrame;
        }

        container = document.createElement('div');
        container.style.width = '800px';
        container.style.height = '600px';
        document.body.appendChild(container);

        // Start the store at zoom=1 (the value the service reads in its ctor).
        dispatchSetZoom(1);
        flushLayout();

        // Trackpad path makes the wheel handler synchronous (no rAF animation),
        // so we can assert immediately after dispatchEvent.
        setIsTrackpadScrolling(true);
    });

    afterEach((): void => {
        service?.dispose();
        service = undefined;
        container.remove();
        setIsTrackpadScrolling(false);
        _resetLayoutStoreForTests();
        vi.useRealTimers();
    });

    it('post-priming gesture from store-zoom=1 produces the expected ~2.512 result (sanity baseline)', () => {
        service = new NavigationGestureService(fakeCy(), container);
        primePastSampling(container);
        // Reset zoom to a known value after priming (priming nudges it slightly).
        dispatchSetZoom(1);
        flushLayout();

        // deltaY = -100 → diff = +0.4 → newZoom = 1 * 10^0.4 ≈ 2.512.
        container.dispatchEvent(makePinchEvent(-100));
        flushLayout();

        const z: number | undefined = getLayout().zoom;
        expect(z).toBeDefined();
        expect(z as number).toBeGreaterThan(2.4);
        expect(z as number).toBeLessThan(2.65);
    });

    it('after external dispatchSetZoom (fitToTerminal-style nav), wheel uses store zoom as base — no teleport', () => {
        service = new NavigationGestureService(fakeCy(), container);
        primePastSampling(container);

        // Simulate an external navigation gesture (fitToTerminal, search nav)
        // that writes a different zoom into the store. The fix re-reads this
        // value into the service's internal `currentZoom` before applying.
        dispatchSetZoom(2);
        flushLayout();

        // deltaY = -100 → diff = +0.4 → newZoom MUST be 2 * 10^0.4 ≈ 5.024.
        // Bug regression would multiply against the post-priming
        // currentZoom (~0.96) → result < 2.5, well below our lower bound.
        container.dispatchEvent(makePinchEvent(-100));
        flushLayout();

        const z: number | undefined = getLayout().zoom;
        expect(z).toBeDefined();
        expect(z as number).toBeGreaterThan(4.8);
        expect(z as number).toBeLessThan(5.3);
    });

    it('repeated external zoom resets are honored on each gesture (no drift)', () => {
        service = new NavigationGestureService(fakeCy(), container);
        primePastSampling(container);

        // External zoom → 4. Wheel-out (deltaY=+100) should produce 4 / 10^0.4 ≈ 1.594.
        dispatchSetZoom(4);
        flushLayout();
        container.dispatchEvent(makePinchEvent(100));
        flushLayout();
        const afterFirst: number = getLayout().zoom as number;
        expect(afterFirst).toBeGreaterThan(1.4);
        expect(afterFirst).toBeLessThan(1.8);

        // External zoom resets → 0.5. Wheel-in (deltaY=-100) → 0.5 * 10^0.4 ≈ 1.256.
        dispatchSetZoom(0.5);
        flushLayout();
        container.dispatchEvent(makePinchEvent(-100));
        flushLayout();
        const afterSecond: number = getLayout().zoom as number;
        expect(afterSecond).toBeGreaterThan(1.1);
        expect(afterSecond).toBeLessThan(1.4);
    });
});
