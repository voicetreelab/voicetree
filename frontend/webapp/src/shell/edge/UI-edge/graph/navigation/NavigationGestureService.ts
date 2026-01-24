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
   * Wheel handler: intercepts only trackpad scroll for panning.
   * All zoom events (mouse wheel, trackpad pinch) use Cytoscape's native handling
   * with default wheelSensitivity for consistent cross-platform behavior.
   */
  private onWheel(e: WheelEvent): void {
    if (!this.cy.userPanningEnabled()) return;

    // Allow native scrolling in tab containers
    const target: Element | null = e.target as Element | null;
    if (target?.closest('.recent-tabs-scroll') || target?.closest('.agent-tabs-pinned')) {
      return;
    }

    // Trackpad two-finger scroll → pan
    // Detection: gestureScrollBegin state from main process OR horizontal component (mouse wheels are vertical-only)
    // ctrlKey = trackpad pinch (macOS sets this), let Cytoscape handle for zoom
    const isTrackpad: boolean = getIsTrackpadScrolling();
    const hasHorizontal: boolean = e.deltaX !== 0;
    console.log('[Wheel] ctrlKey:', e.ctrlKey, 'isTrackpad:', isTrackpad, 'deltaX:', e.deltaX, 'deltaY:', e.deltaY);

    if (!e.ctrlKey && (isTrackpad || hasHorizontal)) {
      console.log('[Wheel] → Intercepting for PAN');
      e.preventDefault();
      e.stopImmediatePropagation();
      this.cy.panBy({ x: -e.deltaX, y: -e.deltaY });
      return;
    }

    console.log('[Wheel] → Letting Cytoscape handle (zoom)');
    // Mouse wheel and trackpad pinch → Cytoscape native zoom (default sensitivity)
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
