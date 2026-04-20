/**
 * Bug reproduction: two-finger trackpad pan.
 *
 * NavigationGestureService maps a trackpad wheel event to
 * dispatchSetPan({...}) on the layoutStore. The renderer-side projection
 * (mountLayoutProjection) is responsible for applying the layoutStore's
 * pan delta back onto the Cytoscape instance. If that subscriber is not
 * mounted, dispatchSetPan becomes a no-op on the rendered graph and
 * trackpad panning stops working.
 *
 * This test provokes the same code path that fires for a real two-finger
 * trackpad swipe and asserts the Cytoscape pan actually moved.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import cytoscape, { type Core } from 'cytoscape';
import { NavigationGestureService } from './NavigationGestureService';
import { setIsTrackpadScrolling } from '@/shell/edge/UI-edge/state/trackpad-state';
import {
    flushLayout,
    getLayoutStoreSingleton,
    _resetLayoutStoreForTests,
} from '@vt/graph-state/state/layoutStore';
import { mountLayoutProjection } from '@/shell/edge/UI-edge/graph/layoutProjection';

describe('NavigationGestureService — two-finger trackpad pan', () => {
    let cy: Core;
    let container: HTMLElement;
    let service: NavigationGestureService;
    let unmountProjection: () => void;

    beforeEach(() => {
        _resetLayoutStoreForTests();

        // Stub electronAPI.main.loadSettings so NavigationGestureService's
        // constructor can complete in jsdom.
        const w: Window & {
            electronAPI?: { main?: { loadSettings?: () => Promise<unknown> } };
        } = window;
        w.electronAPI ??= {};
        w.electronAPI.main ??= {};
        w.electronAPI.main.loadSettings = (): Promise<unknown> =>
            Promise.resolve({ zoomSensitivity: 1.0 });

        container = document.createElement('div');
        container.style.width = '800px';
        container.style.height = '600px';
        document.body.appendChild(container);

        cy = cytoscape({
            container,
            elements: [],
            userZoomingEnabled: false,
            minZoom: 0.1,
            maxZoom: 10,
            layout: { name: 'preset' },
        });

        // Mirrors the app-level wiring in VoiceTreeGraphView.render(): without
        // this subscriber, layoutStore.dispatchSetPan(...) has no effect on cy.
        unmountProjection = mountLayoutProjection(cy, getLayoutStoreSingleton()).unmount;

        service = new NavigationGestureService(cy, container);
        setIsTrackpadScrolling(true);
    });

    afterEach(() => {
        service.dispose();
        unmountProjection();
        cy.destroy();
        container.remove();
        setIsTrackpadScrolling(false);
        _resetLayoutStoreForTests();
    });

    it('pans cytoscape when a two-finger trackpad wheel fires', () => {
        const before: { x: number; y: number } = { ...cy.pan() };

        const evt: WheelEvent = new WheelEvent('wheel', {
            deltaX: 50,
            deltaY: 30,
            clientX: 400,
            clientY: 300,
            ctrlKey: false,
            bubbles: true,
            cancelable: true,
        });
        container.dispatchEvent(evt);

        // Flush any batched layoutStore dispatches synchronously.
        flushLayout();

        const after: { x: number; y: number } = cy.pan();
        const dx: number = after.x - before.x;
        const dy: number = after.y - before.y;

        // NavigationGestureService writes pan = { x: pan.x - deltaX, y: pan.y - deltaY }.
        expect({ dx, dy }).toEqual({ dx: -50, dy: -30 });
    });
});
