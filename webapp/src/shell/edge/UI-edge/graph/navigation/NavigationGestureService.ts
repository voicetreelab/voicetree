/**
 * NavigationGestureService - Handles trackpad scroll for panning and mouse wheel for zooming
 *
 * Strategy (Native Detection via electron-trackpad-detect addon):
 * - Cytoscape's userZoomingEnabled is OFF permanently (we handle all zoom ourselves)
 * - Native addon detects trackpad vs mouse via NSEvent.hasPreciseScrollingDeltas
 * - Trackpad scroll → pan
 * - Trackpad pinch (ctrlKey) → zoom
 * - Mouse wheel → zoom
 */

import type { Core } from 'cytoscape';
import { getEditors } from '@/shell/edge/UI-edge/state/EditorStore';
import { getTerminals } from '@/shell/edge/UI-edge/state/TerminalStore';
import { getIsTrackpadScrolling } from '@/shell/edge/UI-edge/state/trackpad-state';
import type { EditorId, TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import type { EditorData } from '@/shell/edge/UI-edge/floating-windows/editors/editorDataType';
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType';

export class NavigationGestureService {
    private cy: Core;
    private container: HTMLElement;

    // Middle-mouse pan state
    private isPanning: boolean = false;
    private lastPos: { x: number; y: number } = { x: 0, y: 0 };

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
     * Wheel handler - native trackpad detection.
     * Uses electron-trackpad-detect addon which reads NSEvent.hasPreciseScrollingDeltas.
     * - Trackpad scroll → pan
     * - Trackpad pinch (ctrlKey) → zoom
     * - Mouse wheel → zoom
     */
    private onWheel(e: WheelEvent): void {
        if (!this.cy.userPanningEnabled()) return;

        // Allow native scrolling in UI elements
        const target: Element | null = e.target as Element | null;
        if (target?.closest('.recent-tabs-scroll') ?? target?.closest('.terminal-tree-sidebar')) {
            return;
        }

        e.preventDefault();

        // Use native detection from main process (via IPC)
        const isTrackpad: boolean = getIsTrackpadScrolling();

        if (isTrackpad && !e.ctrlKey) {
            // Trackpad scroll → pan
            this.cy.panBy({ x: -e.deltaX, y: -e.deltaY });
        } else {
            // Mouse wheel OR trackpad pinch (ctrlKey) → zoom
            const sensitivity: number = e.ctrlKey ? 0.013 : 0.01;
            this.zoomAtCursor(e, sensitivity);
        }
    }

    /**
     * Zoom the graph centered on the cursor position.
     */
    private zoomAtCursor(e: WheelEvent, sensitivity: number): void {
        const currentZoom: number = this.cy.zoom();
        const delta: number = -e.deltaY * sensitivity;
        const newZoom: number = currentZoom * (1 + delta);

        const minZoom: number = this.cy.minZoom();
        const maxZoom: number = this.cy.maxZoom();
        const clampedZoom: number = Math.max(minZoom, Math.min(maxZoom, newZoom));

        this.cy.zoom({
            level: clampedZoom,
            renderedPosition: { x: e.clientX, y: e.clientY }
        });
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
     * Redirects scroll to the graph instead of the floating window content.
     */
    private onFloatingWindowWheel(e: WheelEvent): void {
        const target: Element | null = e.target as Element | null;
        const floatingWindow: Element | null | undefined = target?.closest('[data-floating-window-id]');

        // Not from a floating window - already handled by onWheel
        if (!floatingWindow) return;

        // Check if this floating window has focus
        const hasFocus: boolean = floatingWindow.contains(document.activeElement);
        if (hasFocus) return; // Focused - allow native scroll in the floating window

        // Check if this floating window's node is selected
        const floatingWindowId: string | null = floatingWindow.getAttribute('data-floating-window-id');
        if (floatingWindowId && this.isFloatingWindowNodeSelected(floatingWindowId, floatingWindow)) {
            return; // Node is selected - allow native scroll
        }

        // Unfocused floating window - redirect to graph
        if (!this.cy.userPanningEnabled()) return;

        e.preventDefault();
        e.stopImmediatePropagation();

        // Use native detection from main process
        const isTrackpad: boolean = getIsTrackpadScrolling();

        if (isTrackpad && !e.ctrlKey) {
            // Trackpad scroll → pan
            this.cy.panBy({ x: -e.deltaX, y: -e.deltaY });
        } else {
            // Mouse wheel OR trackpad pinch → zoom
            const sensitivity: number = e.ctrlKey ? 0.013 : 0.01;
            this.zoomAtCursor(e, sensitivity);
        }
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
        document.removeEventListener('wheel', this.handleFloatingWindowWheel, { capture: true });
        this.container.removeEventListener('mousedown', this.handleMouseDown);
        window.removeEventListener('mousemove', this.handleMouseMove);
        window.removeEventListener('mouseup', this.handleMouseUp);
    }
}
