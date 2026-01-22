/**
 * NavigationGestureService - Handles trackpad and mouse gestures for graph navigation
 *
 * Provides:
 * - Trackpad two-finger scroll → pan
 * - Trackpad pinch (ctrlKey) → zoom
 * - Mouse wheel → zoom
 * - Middle-mouse drag → pan
 */

import type { Core } from 'cytoscape';
import { getIsTrackpadScrolling } from '@/shell/edge/UI-edge/state/trackpad-state';

export class NavigationGestureService {
    private cy: Core;
    private container: HTMLElement;

    // Middle-mouse pan state
    private isPanning = false;
    private lastPos = { x: 0, y: 0 };

    // Bound handlers for cleanup
    private handleWheel: (e: WheelEvent) => void;
    private handleMouseDown: (e: MouseEvent) => void;
    private handleMouseMove: (e: MouseEvent) => void;
    private handleMouseUp: (e: MouseEvent) => void;

    constructor(cy: Core, container: HTMLElement) {
        this.cy = cy;
        this.container = container;

        // Bind handlers
        this.handleWheel = this.onWheel.bind(this);
        this.handleMouseDown = this.onMouseDown.bind(this);
        this.handleMouseMove = this.onMouseMove.bind(this);
        this.handleMouseUp = this.onMouseUp.bind(this);

        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        // Wheel: capture phase to intercept before Cytoscape
        this.container.addEventListener('wheel', this.handleWheel, { passive: false, capture: true });

        // Middle-mouse pan
        this.container.addEventListener('mousedown', this.handleMouseDown);
        window.addEventListener('mousemove', this.handleMouseMove);
        window.addEventListener('mouseup', this.handleMouseUp);
    }

    /**
     * Wheel handler: takes full control of wheel events to prevent Cytoscape conflicts.
     * - ctrlKey (trackpad pinch) → zoom
     * - trackpad scrolling (via uiAPI state from main process) → pan
     * - else (mouse wheel) → zoom
     */
    private onWheel(e: WheelEvent): void {
        if (!this.cy.userPanningEnabled()) return;

        // Allow native scrolling in tab containers
        const target: Element | null = e.target as Element | null;
        if (target?.closest('.recent-tabs-scroll') || target?.closest('.agent-tabs-pinned')) {
            return;
        }

        e.preventDefault();
        e.stopImmediatePropagation();

        if (e.ctrlKey) {
            // Trackpad pinch gesture → zoom (ctrlKey is set by macOS for pinch)
            this.zoomAtCursor(e, 0.013);
        } else if (getIsTrackpadScrolling() || e.deltaX !== 0) {
            // Trackpad two-finger scroll → pan
            // Detection: uiAPI state (gestureScrollBegin) OR horizontal component (mouse wheels are vertical-only)
            this.cy.panBy({ x: -e.deltaX, y: -e.deltaY });
        } else {
            // Mouse wheel (vertical-only, no gesture event) → zoom
            this.zoomAtCursor(e, 0.01);
        }
    }

    /**
     * Zoom centered on cursor position
     */
    private zoomAtCursor(e: WheelEvent, sensitivity: number): void {
        const zoomFactor: number = 1 - e.deltaY * sensitivity;
        const newZoom: number = Math.max(
            this.cy.minZoom(),
            Math.min(this.cy.maxZoom(), this.cy.zoom() * zoomFactor)
        );
        const rect: DOMRect = this.container.getBoundingClientRect();
        this.cy.zoom({
            level: newZoom,
            renderedPosition: { x: e.clientX - rect.left, y: e.clientY - rect.top }
        });
    }

    /**
     * Middle-mouse down: start panning
     */
    private onMouseDown(e: MouseEvent): void {
        if (e.button !== 1) return; // Only middle click
        if (!this.cy.userPanningEnabled()) return;

        this.isPanning = true;
        this.lastPos = { x: e.clientX, y: e.clientY };
        e.preventDefault();

        // Change cursor to indicate panning
        this.container.style.cursor = 'grabbing';
    }

    /**
     * Mouse move: pan if middle-mouse is held
     */
    private onMouseMove(e: MouseEvent): void {
        if (!this.isPanning) return;

        const dx: number = e.clientX - this.lastPos.x;
        const dy: number = e.clientY - this.lastPos.y;
        this.cy.panBy({ x: dx, y: dy });
        this.lastPos = { x: e.clientX, y: e.clientY };
    }

    /**
     * Mouse up: stop panning
     */
    private onMouseUp(e: MouseEvent): void {
        if (e.button !== 1) return; // Only middle click
        if (!this.isPanning) return;

        this.isPanning = false;
        this.container.style.cursor = '';
    }

    /**
     * Cleanup all event listeners
     */
    dispose(): void {
        this.container.removeEventListener('wheel', this.handleWheel, { capture: true });
        this.container.removeEventListener('mousedown', this.handleMouseDown);
        window.removeEventListener('mousemove', this.handleMouseMove);
        window.removeEventListener('mouseup', this.handleMouseUp);
    }
}
