/**
 * NavigationGestureService - Handles all wheel gestures for zoom and pan
 *
 * Strategy (Option A - Unified zoomAtCursor):
 * - Cytoscape's userZoomingEnabled is OFF (custom zoom handling)
 * - ALL zoom uses our zoomAtCursor() method which implements Cytoscape's algorithm:
 *   - deltaMode handling for Firefox Linux/Windows
 *   - Inaccurate device detection (mice reporting in chunks)
 *   - Exponential zoom formula for natural feel
 * - Trackpad scroll → pan (via panBy)
 * - Trackpad pinch (ctrlKey) → zoom (via zoomAtCursor)
 * - Mouse wheel → zoom (via zoomAtCursor)
 * - This gives unified device detection state and simpler DOM (no wrapper div)
 */

import type { Core } from 'cytoscape';
import { MIN_ZOOM, MAX_ZOOM } from '@/shell/UI/cytoscape-graph-ui/constants';
import { getEditors } from '@/shell/edge/UI-edge/state/EditorStore';
import { getTerminals } from '@/shell/edge/UI-edge/state/TerminalStore';
import { getIsTrackpadScrolling } from '@/shell/edge/UI-edge/state/trackpad-state';
import type { EditorId, TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import type { EditorData } from '@/shell/edge/UI-edge/floating-windows/editors/editorDataType';
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType';
import type { VTSettings } from '@vt/graph-model/pure/settings/types';
import { onSettingsChange } from '@/shell/edge/UI-edge/api';
import { signalViewportManipulationCached } from '@/shell/UI/cytoscape-graph-ui/services/largegraphPerformance';
import { isSelected } from '@vt/graph-state';
import { getLayout, dispatchSetZoom, dispatchSetPan } from '@vt/graph-state/state/layoutStore';

export class NavigationGestureService {
    private container: HTMLElement;

    // Middle-mouse pan state
    private isPanning: boolean = false;
    private lastPos: { x: number; y: number } = { x: 0, y: 0 };

    // Zoom sensitivity multiplier (loaded from settings)
    private zoomSensitivity: number = 1.0;

    // Inaccurate scroll device detection (matches Cytoscape's implementation)
    // Mice often report wheel deltas in chunks (e.g., multiples of 5 or same magnitude)
    private wheelDeltas: number[] = [];
    private inaccurateScrollDevice: boolean | undefined = undefined;
    private inaccurateScrollFactor: number = 100000;

    // Smooth zoom animation state (for discrete mouse wheels)
    private targetZoom: number = 1;
    private currentZoom: number = 1;  // tracks last-dispatched zoom; updated on every dispatchSetZoom write
    private panEnabled: boolean = true; // panning always enabled; userPanningEnabled is always true in this app
    private zoomCursorPos: { x: number; y: number } = { x: 0, y: 0 };
    private zoomAnimating: boolean = false;
    private zoomAnimFrameId: number = 0;
    private static readonly ZOOM_LERP: number = 0.2;
    private static readonly ZOOM_EPSILON: number = 0.001;

    // Bound handlers for cleanup
    private handleWheel: (e: WheelEvent) => void;
    private handleMouseDown: (e: MouseEvent) => void;
    private handleMouseMove: (e: MouseEvent) => void;
    private handleMouseUp: (e: MouseEvent) => void;
    private handleFloatingWindowWheel: (e: WheelEvent) => void;
    private unsubSettingsChange: () => void;

    constructor(_cy: Core, container: HTMLElement) {
        this.container = container;
        this.currentZoom = getLayout().zoom ?? 1;

        // Bind handlers
        this.handleWheel = this.onWheel.bind(this);
        this.handleMouseDown = this.onMouseDown.bind(this);
        this.handleMouseMove = this.onMouseMove.bind(this);
        this.handleMouseUp = this.onMouseUp.bind(this);
        this.handleFloatingWindowWheel = this.onFloatingWindowWheel.bind(this);

        this.setupEventListeners();

        // Load zoom sensitivity from settings and subscribe to changes
        const loadSensitivity: () => void = (): void => {
            void window.electronAPI?.main.loadSettings().then((s: VTSettings) => {
                this.zoomSensitivity = s.zoomSensitivity ?? 1.0;
            });
        };
        loadSensitivity();
        this.unsubSettingsChange = onSettingsChange(loadSensitivity);
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
     * Wheel handler - handles all zoom and pan gestures.
     * Uses unified zoomAtCursor() for all zoom (userZoomingEnabled: false).
     */
    private onWheel(e: WheelEvent): void {
        if (!this.panEnabled) return;

        // Allow native scrolling in UI elements
        const target: Element | null = e.target as Element | null;
        if (target?.closest('.recent-tabs-scroll') ?? target?.closest('.terminal-tree-sidebar')) {
            return;
        }

        e.preventDefault();

        // Use native detection from main process (via IPC)
        const isTrackpad: boolean = getIsTrackpadScrolling();

        // Trackpad scroll (non-pinch) → pan
        if (isTrackpad && !e.ctrlKey) {
            signalViewportManipulationCached();
            const pan: { x: number; y: number } = getLayout().pan ?? { x: 0, y: 0 };
            dispatchSetPan({ x: pan.x - e.deltaX, y: pan.y - e.deltaY });
            return;
        }

        // Mouse wheel or trackpad pinch (ctrlKey) → zoom using Cytoscape-compatible logic
        signalViewportManipulationCached();
        this.zoomAtCursor(e);
    }

    // Helper functions for inaccurate device detection (from Cytoscape source)
    private signum(x: number): number {
        if (x > 0) return 1;
        else if (x < 0) return -1;
        else return 0;
    }

    private allAreDivisibleBy(list: number[], factor: number): boolean {
        return list.every(v => v % factor === 0);
    }

    private allAreSameMagnitude(list: number[]): boolean {
        const firstMag: number = Math.abs(list[0]);
        return list.every(v => Math.abs(v) === firstMag);
    }

    /**
     * Zoom the graph centered on the cursor position.
     * Uses Cytoscape's zoom logic for cross-platform consistency:
     * - deltaMode handling for Firefox Linux/Windows (LINE units vs pixels)
     * - Inaccurate device detection (mice reporting in chunks)
     * - Exponential zoom formula for natural feel
     * - Smooth animation for discrete mouse wheels (trackpad is already smooth)
     */
    private zoomAtCursor(e: WheelEvent): void {
        let delta: number = e.deltaY;
        if (delta === 0) return;

        let clamp: boolean = false;
        const wheelDeltaN: number = 4;

        // Inaccurate device detection (sample first 4 events)
        // Some mice report wheel deltas in chunks (e.g., multiples of 5)
        if (this.inaccurateScrollDevice === undefined) {
            if (this.wheelDeltas.length >= wheelDeltaN) {
                const wds: number[] = this.wheelDeltas;
                this.inaccurateScrollDevice = this.allAreDivisibleBy(wds, 5);
                if (!this.inaccurateScrollDevice) {
                    const firstMag: number = Math.abs(wds[0]);
                    this.inaccurateScrollDevice = this.allAreSameMagnitude(wds) && firstMag > 5;
                }
                if (this.inaccurateScrollDevice) {
                    for (const wd of wds) {
                        this.inaccurateScrollFactor = Math.min(Math.abs(wd), this.inaccurateScrollFactor);
                    }
                }
            } else {
                this.wheelDeltas.push(delta);
                clamp = true;
            }
        } else if (this.inaccurateScrollDevice) {
            this.inaccurateScrollFactor = Math.min(Math.abs(delta), this.inaccurateScrollFactor);
        }

        // Clamp initial events while sampling to avoid jumpy zoom
        if (clamp && Math.abs(delta) > 5) {
            delta = this.signum(delta) * 5;
        }

        // Base calculation (matches Cytoscape's formula), scaled by user sensitivity
        let diff: number = (delta / -250) * this.zoomSensitivity;

        // Normalize inaccurate devices
        if (this.inaccurateScrollDevice) {
            diff /= this.inaccurateScrollFactor;
            diff *= 3;
        }

        // Firefox Linux/Windows fix: deltaMode=1 means LINE units, not pixels
        if (e.deltaMode === 1) {
            diff *= 33;
        }

        // Trackpad pinch: apply directly (already smooth from high-frequency deltas)
        if (getIsTrackpadScrolling()) {
            this.cancelZoomAnimation();
            const newZoom: number = this.currentZoom * Math.pow(10, diff);
            const clampedZoom: number = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
            // Cursor-anchored zoom: keep model point under cursor fixed via store dispatch
            const pinchPan: { x: number; y: number } = getLayout().pan ?? { x: 0, y: 0 };
            const rp: { x: number; y: number } = { x: e.clientX, y: e.clientY };
            dispatchSetPan({
                x: (pinchPan.x - rp.x) / this.currentZoom * clampedZoom + rp.x,
                y: (pinchPan.y - rp.y) / this.currentZoom * clampedZoom + rp.y,
            });
            dispatchSetZoom(clampedZoom);
            this.currentZoom = clampedZoom;
            return;
        }

        // Discrete mouse wheel: accumulate target and animate smoothly
        if (!this.zoomAnimating) {
            this.targetZoom = this.currentZoom; // sync before first delta
        }
        this.targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM,
            this.targetZoom * Math.pow(10, diff)));
        this.zoomCursorPos = { x: e.clientX, y: e.clientY };
        if (!this.zoomAnimating) {
            this.startZoomAnimation();
        }
    }

    /**
     * Start smooth zoom animation loop.
     * Uses exponential ease-out: each frame closes ZOOM_LERP fraction of the remaining gap.
     */
    private startZoomAnimation(): void {
        this.zoomAnimating = true;
        const tick: () => void = (): void => {
            const current: number = this.currentZoom;
            const remaining: number = this.targetZoom - current;

            // Stop when close enough (relative threshold scales across zoom range)
            if (Math.abs(remaining / current) < NavigationGestureService.ZOOM_EPSILON) {
                // TODO: renderedPosition (cursor-anchored zoom) not yet modeled in layoutStore
                dispatchSetZoom(this.targetZoom);
                this.currentZoom = this.targetZoom;
                this.zoomAnimating = false;
                return;
            }

            const next: number = current + remaining * NavigationGestureService.ZOOM_LERP;
            // TODO: renderedPosition (cursor-anchored zoom) not yet modeled in layoutStore
            dispatchSetZoom(next);
            this.currentZoom = next;
            this.zoomAnimFrameId = requestAnimationFrame(tick);
        };
        this.zoomAnimFrameId = requestAnimationFrame(tick);
    }

    /**
     * Cancel any running zoom animation.
     */
    private cancelZoomAnimation(): void {
        if (this.zoomAnimating) {
            cancelAnimationFrame(this.zoomAnimFrameId);
            this.zoomAnimating = false;
        }
    }

    /**
     * Check if a floating window's corresponding node is selected.
     * For editors: contentLinkedToNodeId; for terminals: attachedToContextNodeId
     */
    private isFloatingWindowNodeSelected(floatingWindowId: string, floatingWindow: Element): boolean {
        if (floatingWindow.classList.contains('cy-floating-window-editor')) {
            const editor: EditorData | undefined = getEditors().get(floatingWindowId as EditorId);
            if (editor) {
                return isSelected(editor.contentLinkedToNodeId);
            }
        } else if (floatingWindow.classList.contains('cy-floating-window-terminal')) {
            const terminal: TerminalData | undefined = getTerminals().get(floatingWindowId as TerminalId);
            if (terminal) {
                return isSelected(terminal.attachedToContextNodeId);
            }
        }
        return false;
    }

    /**
     * Check if a floating window has scrollable content (overflow).
     * Returns true if content exceeds visible area, false otherwise.
     */
    private hasScrollableContent(floatingWindow: Element): boolean {
        // Check for editor (CodeMirror)
        if (floatingWindow.classList.contains('cy-floating-window-editor')) {
            const scroller: HTMLElement | null = floatingWindow.querySelector('.cm-scroller');
            if (scroller) {
                return scroller.scrollHeight > scroller.clientHeight;
            }
        }

        // Terminals always allow scroll — fresh terminals with little output may not
        // have viewport overflow yet, but blocking scroll feels broken to users
        if (floatingWindow.classList.contains('cy-floating-window-terminal')) {
            return true;
        }

        // Default: assume scrollable (conservative)
        return true;
    }

    /**
     * Handle wheel events from floating windows.
     * - Pinch-to-zoom (ctrlKey) ALWAYS zooms the graph, even if window is focused
     * - Scroll events redirect to graph if window is unfocused
     */
    private onFloatingWindowWheel(e: WheelEvent): void {
        const target: Element | null = e.target as Element | null;
        const floatingWindow: Element | null | undefined = target?.closest('[data-floating-window-id]');

        // Not from a floating window - already handled by onWheel
        if (!floatingWindow) return;

        // Pinch-to-zoom (ctrlKey) should ALWAYS zoom the graph, even if window is focused
        // macOS generates ctrlKey=true for trackpad pinch gestures
        if (e.ctrlKey) {
            if (!this.panEnabled) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            signalViewportManipulationCached();
            this.zoomAtCursor(e);
            return;
        }

        // Horizontal scroll should ALWAYS pan the graph (no horizontal scroll in floating windows)
        const isHorizontalScroll: boolean = Math.abs(e.deltaX) > Math.abs(e.deltaY);
        if (isHorizontalScroll && e.deltaX !== 0) {
            if (!this.panEnabled) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            signalViewportManipulationCached();
            const hPan: { x: number; y: number } = getLayout().pan ?? { x: 0, y: 0 };
            dispatchSetPan({ x: hPan.x - e.deltaX, y: hPan.y - e.deltaY });
            return;
        }

        // For vertical scroll: check if this floating window has focus
        const hasFocus: boolean = floatingWindow.contains(document.activeElement);
        if (hasFocus) return; // Focused - allow native vertical scroll in the floating window

        // Check if this floating window's node is selected AND has scrollable content
        const floatingWindowId: string | null = floatingWindow.getAttribute('data-floating-window-id');
        if (floatingWindowId && this.isFloatingWindowNodeSelected(floatingWindowId, floatingWindow)) {
            // Only allow native scroll if content actually has overflow
            if (this.hasScrollableContent(floatingWindow)) {
                return; // Node selected AND has overflow - allow native scroll
            }
            // Node selected but no overflow - fall through to graph zoom/pan
        }

        // Unfocused floating window - redirect to graph
        if (!this.panEnabled) return;

        e.preventDefault();
        e.stopImmediatePropagation();

        // Use native detection from main process
        const isTrackpad: boolean = getIsTrackpadScrolling();

        signalViewportManipulationCached();
        if (isTrackpad && !e.ctrlKey) {
            // Trackpad scroll → pan
            const fwPan: { x: number; y: number } = getLayout().pan ?? { x: 0, y: 0 };
            dispatchSetPan({ x: fwPan.x - e.deltaX, y: fwPan.y - e.deltaY });
        } else {
            // Mouse wheel OR trackpad pinch → zoom (using Cytoscape-compatible logic)
            this.zoomAtCursor(e);
        }
    }

    /**
     * Middle-mouse down: start panning
     */
    private onMouseDown(e: MouseEvent): void {
        if (e.button !== 1) return; // Only middle click
        if (!this.panEnabled) return;

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
        signalViewportManipulationCached();
        const mmPan: { x: number; y: number } = getLayout().pan ?? { x: 0, y: 0 };
        dispatchSetPan({ x: mmPan.x + dx, y: mmPan.y + dy });
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
        this.cancelZoomAnimation();
        this.unsubSettingsChange();
        this.container.removeEventListener('wheel', this.handleWheel, { capture: true });
        document.removeEventListener('wheel', this.handleFloatingWindowWheel, { capture: true });
        this.container.removeEventListener('mousedown', this.handleMouseDown);
        window.removeEventListener('mousemove', this.handleMouseMove);
        window.removeEventListener('mouseup', this.handleMouseUp);
    }
}
