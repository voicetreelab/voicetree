/**
 * NavigationGestureService - Handles trackpad scroll for panning and mouse wheel for zooming
 *
 * Strategy (Heuristic-Based Detection):
 * - Cytoscape's userZoomingEnabled is OFF permanently (we handle all zoom ourselves)
 * - Trackpad scroll (detected via heuristics) → pan
 * - Trackpad pinch (ctrlKey) → zoom via zoomAtCursor
 * - Mouse wheel (detected via heuristics) → zoom via zoomAtCursor
 *
 * This approach was chosen after 3 failed approaches:
 * 1. Electron gestureScrollBegin/End events are unreliable (fire for mouse too)
 * 2. cy.userZoomingEnabled() toggle is not bidirectional
 * 3. Event interception doesn't work (Cytoscape handlers still fire)
 */

import type { Core } from 'cytoscape';
import { getEditors } from '@/shell/edge/UI-edge/state/EditorStore';
import { getTerminals } from '@/shell/edge/UI-edge/state/TerminalStore';
import type { EditorId, TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import type { EditorData } from '@/shell/edge/UI-edge/floating-windows/editors/editorDataType';
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType';

// Timing thresholds for trackpad detection
const RAPID_EVENT_THRESHOLD_MS: number = 50;  // Events closer than this = rapid firing
const RAPID_EVENT_COUNT_THRESHOLD: number = 3; // Need this many rapid events to confirm trackpad
const GESTURE_END_TIMEOUT_MS: number = 150;    // Gesture ends after this much silence

export class NavigationGestureService {
    private cy: Core;
    private container: HTMLElement;

    // Middle-mouse pan state
    private isPanning: boolean = false;
    private lastPos: { x: number; y: number } = { x: 0, y: 0 };

    // Trackpad detection state - track recent wheel events for timing analysis
    private lastWheelTime: number = 0;
    private rapidEventCount: number = 0;
    private isInTrackpadGesture: boolean = false;
    private gestureTimeoutId: ReturnType<typeof setTimeout> | null = null;

    // Bound handlers for cleanup
    private handleWheel: (e: WheelEvent) => void;
    private handleMouseDown: (e: MouseEvent) => void;
    private handleMouseMove: (e: MouseEvent) => void;
    private handleMouseUp: (e: MouseEvent) => void;
    private handleFloatingWindowWheel: (e: WheelEvent) => void;

    constructor(cy: Core, container: HTMLElement) {
        this.cy = cy;
        this.container = container;

        // Bind handlers
        this.handleWheel = this.onWheel.bind(this);
        this.handleMouseDown = this.onMouseDown.bind(this);
        this.handleMouseMove = this.onMouseMove.bind(this);
        this.handleMouseUp = this.onMouseUp.bind(this);
        this.handleFloatingWindowWheel = this.onFloatingWindowWheel.bind(this);

        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        // Wheel: handle trackpad scroll for panning, mouse wheel for zooming
        this.container.addEventListener('wheel', this.handleWheel, { passive: false, capture: true });

        // Document-level wheel listener to intercept events from unfocused floating windows
        document.addEventListener('wheel', this.handleFloatingWindowWheel, { passive: false, capture: true });

        // Middle-mouse pan
        this.container.addEventListener('mousedown', this.handleMouseDown);
        window.addEventListener('mousemove', this.handleMouseMove);
        window.addEventListener('mouseup', this.handleMouseUp);
    }

    /**
     * Wheel handler - heuristic-based trackpad detection.
     * Since Electron's gesture events are unreliable and Cytoscape's zoom toggle
     * is not bidirectional, we keep userZoomingEnabled: false and handle everything ourselves.
     */
    private onWheel(e: WheelEvent): void {
        if (!this.cy.userPanningEnabled()) return;

        // Allow native scrolling in UI elements
        const target: Element | null = e.target as Element | null;
        if (target?.closest('.recent-tabs-scroll') ?? target?.closest('.terminal-tree-sidebar')) {
            return;
        }

        e.preventDefault();

        // Heuristic-based trackpad detection
        const isLikelyTrackpad: boolean = this.isLikelyTrackpadScroll(e);

        if (isLikelyTrackpad && !e.ctrlKey) {
            // Trackpad scroll → pan
            this.cy.panBy({ x: -e.deltaX, y: -e.deltaY });
        } else {
            // Mouse wheel OR trackpad pinch (ctrlKey) → zoom
            const sensitivity: number = e.ctrlKey ? 0.013 : 0.01;
            this.zoomAtCursor(e, sensitivity);
        }
    }

    /**
     * Heuristic to detect trackpad scroll vs mouse wheel.
     *
     * Detection strategy:
     * 1. deltaX !== 0 → definitely trackpad (mouse wheels are vertical-only)
     * 2. deltaMode !== 0 → definitely mouse (line/page mode)
     * 3. Timing analysis: trackpads fire many rapid events, mice fire fewer spaced events
     * 4. Once we detect a trackpad gesture, stay in that mode until events stop
     */
    private isLikelyTrackpadScroll(e: WheelEvent): boolean {
        const now: number = performance.now();
        const timeSinceLastEvent: number = now - this.lastWheelTime;

        // Reset gesture timeout - will mark gesture as ended after silence
        this.resetGestureTimeout();

        // Horizontal scroll = definitely trackpad (mouse wheels are vertical-only)
        if (e.deltaX !== 0) {
            this.markAsTrackpadGesture(now);
            return true;
        }

        // deltaMode: 0 = pixels, 1 = lines (mouse), 2 = pages
        // If not pixel mode, it's definitely a mouse
        if (e.deltaMode !== 0) {
            this.resetTrackpadState();
            return false;
        }

        // If we're already in a trackpad gesture, continue treating as trackpad
        if (this.isInTrackpadGesture) {
            this.lastWheelTime = now;
            return true;
        }

        // Timing analysis: rapid successive events suggest trackpad
        if (timeSinceLastEvent < RAPID_EVENT_THRESHOLD_MS && this.lastWheelTime > 0) {
            this.rapidEventCount++;
            if (this.rapidEventCount >= RAPID_EVENT_COUNT_THRESHOLD) {
                this.markAsTrackpadGesture(now);
                return true;
            }
        } else {
            // Event was spaced out - reset rapid count
            this.rapidEventCount = 1;
        }

        this.lastWheelTime = now;

        // Not enough evidence yet - default to mouse (zoom)
        // This means the first few events of a trackpad scroll might zoom,
        // but once we detect the rapid pattern, we switch to pan
        return false;
    }

    /**
     * Mark that we've detected a trackpad gesture
     */
    private markAsTrackpadGesture(now: number): void {
        this.isInTrackpadGesture = true;
        this.lastWheelTime = now;
        this.rapidEventCount = 0;
    }

    /**
     * Reset trackpad detection state (when we detect mouse or gesture ends)
     */
    private resetTrackpadState(): void {
        this.isInTrackpadGesture = false;
        this.rapidEventCount = 0;
        this.lastWheelTime = 0;
    }

    /**
     * Reset the gesture timeout - gesture ends after period of no events
     */
    private resetGestureTimeout(): void {
        if (this.gestureTimeoutId) {
            clearTimeout(this.gestureTimeoutId);
        }
        this.gestureTimeoutId = setTimeout(() => {
            this.resetTrackpadState();
            this.gestureTimeoutId = null;
        }, GESTURE_END_TIMEOUT_MS);
    }

    /**
     * Check if a floating window's corresponding node is selected.
     * For editors: contentLinkedToNodeId; for terminals: attachedToNodeId
     */
    private isFloatingWindowNodeSelected(floatingWindowId: string, floatingWindow: Element): boolean {
        if (floatingWindow.classList.contains('cy-floating-window-editor')) {
            const editor: EditorData | undefined = getEditors().get(floatingWindowId as EditorId);
            if (editor) {
                return this.cy.getElementById(editor.contentLinkedToNodeId).selected();
            }
        } else if (floatingWindow.classList.contains('cy-floating-window-terminal')) {
            const terminal: TerminalData | undefined = getTerminals().get(floatingWindowId as TerminalId);
            if (terminal) {
                return this.cy.getElementById(terminal.attachedToNodeId).selected();
            }
        }
        return false;
    }

    /**
     * Handle wheel events from unfocused floating windows.
     * Intercepts at document level to catch events before xterm/CodeMirror.
     */
    private onFloatingWindowWheel(e: WheelEvent): void {
        const target: Element | null = e.target as Element | null;
        const floatingWindow: Element | null | undefined = target?.closest('[data-floating-window-id]');

        // Not from a floating window - let existing handlers deal with it
        if (!floatingWindow) return;

        // Check if this floating window has focus
        const hasFocus: boolean = floatingWindow.contains(document.activeElement);
        if (hasFocus) return; // Focused - allow native scroll

        // Check if this floating window's node is selected (e.g., hover editor on selected node)
        const floatingWindowId: string | null = floatingWindow.getAttribute('data-floating-window-id');
        if (floatingWindowId && this.isFloatingWindowNodeSelected(floatingWindowId, floatingWindow)) {
            return; // Node is selected - allow native scroll
        }

        // Unfocused floating window - handle as graph navigation
        if (!this.cy.userPanningEnabled()) return;

        e.preventDefault();
        e.stopImmediatePropagation();

        // Use same heuristic-based detection
        const isLikelyTrackpad: boolean = this.isLikelyTrackpadScroll(e);

        if (e.ctrlKey) {
            // Trackpad pinch zoom
            this.zoomAtCursor(e, 0.013);
        } else if (isLikelyTrackpad) {
            // Trackpad scroll → pan
            this.cy.panBy({ x: -e.deltaX, y: -e.deltaY });
        } else {
            // Mouse wheel → zoom
            this.zoomAtCursor(e, 0.01);
        }
    }

    /**
     * Zoom the graph centered on the cursor position.
     */
    private zoomAtCursor(e: WheelEvent, sensitivity: number): void {
        const currentZoom: number = this.cy.zoom();
        const delta: number = -e.deltaY * sensitivity;
        const newZoom: number = currentZoom * (1 + delta);

        // Clamp to Cytoscape's zoom limits
        const minZoom: number = this.cy.minZoom();
        const maxZoom: number = this.cy.maxZoom();
        const clampedZoom: number = Math.max(minZoom, Math.min(maxZoom, newZoom));

        this.cy.zoom({
            level: clampedZoom,
            renderedPosition: { x: e.clientX, y: e.clientY }
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
     * Cleanup all event listeners and timers
     */
    dispose(): void {
        if (this.gestureTimeoutId) {
            clearTimeout(this.gestureTimeoutId);
        }
        this.container.removeEventListener('wheel', this.handleWheel, { capture: true });
        document.removeEventListener('wheel', this.handleFloatingWindowWheel, { capture: true });
        this.container.removeEventListener('mousedown', this.handleMouseDown);
        window.removeEventListener('mousemove', this.handleMouseMove);
        window.removeEventListener('mouseup', this.handleMouseUp);
    }
}
