/**
 * Cytoscape Floating Window Extension - V2
 *
 * Rewritten to use types.ts with flat types and derived IDs.
 * Windows are anchored to invisible shadow nodes and move with graph transformations.
 */

import type cytoscape from 'cytoscape';
import {
    getScalingStrategy,
    getScreenDimensions,
    getTitleBarFontSize,
    getTransformOrigin,
    getWindowTransform,
    graphToScreenPosition,
    type ScalingStrategy,
    type TransformOrigin,
} from '@/pure/floatingWindowScaling';
import {
    type EditorId,
    type FloatingWindowData,
    type FloatingWindowFields,
    type FloatingWindowUIData,
    getEditorId,
    getFloatingWindowId,
    getShadowNodeId,
    getTerminalId,
    isEditorData,
    type ShadowNodeId,
    type TerminalId,
} from '@/shell/edge/UI-edge/floating-windows/types';
import {removeTerminal} from "@/shell/edge/UI-edge/state/TerminalStore";
import {removeEditor} from "@/shell/edge/UI-edge/state/EditorStore";
import {selectFloatingWindowNode} from "@/shell/edge/UI-edge/floating-windows/select-floating-window-node";

// =============================================================================
// Zoom Change Subscription
// =============================================================================

type ZoomChangeCallback = (zoom: number) => void;
const zoomChangeCallbacks: Set<ZoomChangeCallback> = new Set();

/**
 * Subscribe to zoom changes for floating windows
 * Used by terminals to adjust font size on zoom
 */
export function subscribeToZoomChange(callback: ZoomChangeCallback): () => void {
    zoomChangeCallbacks.add(callback);
    return () => zoomChangeCallbacks.delete(callback);
}

/**
 * Get current zoom level from cytoscape instance
 * Used by terminals to get initial zoom on mount
 */
let cachedZoom: number = 1;
export function getCachedZoom(): number {
    return cachedZoom;
}

// =============================================================================
// Node Selection (shared logic for focus stealing and manual clicks)
// =============================================================================

// =============================================================================
// Cleanup Registry (WeakMap keyed by windowElement)
// =============================================================================

type CleanupFunctions = {
    dragMouseMove: (e: MouseEvent) => void;
    dragMouseUp: () => void;
    resizeObserver?: ResizeObserver;
    parentPositionHandler?: () => void;
};

/**
 * WeakMap to store cleanup functions for each floating window.
 * Keyed by windowElement - when element is GC'd, entry is auto-removed.
 * disposeFloatingWindow looks up and runs these before removing DOM.
 */
export const cleanupRegistry: WeakMap<HTMLElement, CleanupFunctions> = new WeakMap();

// =============================================================================
// Overlay Management (unchanged from v1)
// =============================================================================

/**
 * Get or create the shared overlay container for all floating windows
 *
 * NOTE: We no longer use CSS transform: scale(zoom) because xterm.js has a known bug
 * where getBoundingClientRect() returns post-transform coords but terminal internal
 * coords are pre-transform, causing text selection offset issues.
 * Instead, we scale window positions and dimensions explicitly.
 */
export function getOrCreateOverlay(cy: cytoscape.Core): HTMLElement {
    const container: HTMLElement = cy.container() as HTMLElement;
    const parent: HTMLElement | null = container.parentElement;

    if (!parent) {
        throw new Error('Cytoscape container has no parent element');
    }

    let overlay: HTMLElement = parent.querySelector('.cy-floating-overlay') as HTMLElement;

    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'cy-floating-overlay';
        overlay.style.position = 'absolute';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '1000';
        overlay.style.transformOrigin = 'top left';

        parent.appendChild(overlay);

        // Debounce zoom change callbacks to avoid excessive re-renders
        let zoomDebounceTimeout: ReturnType<typeof setTimeout> | null = null;

        const syncTransform: () => void = () => {
            const pan: cytoscape.Position = cy.pan();
            const zoom: number = cy.zoom();
            cachedZoom = zoom;

            // Only translate, no scale - windows handle their own sizing
            overlay.style.transform = `translate(${pan.x}px, ${pan.y}px)`;

            // Update all floating window positions and sizes
            const windows: NodeListOf<HTMLElement> = overlay.querySelectorAll('.cy-floating-window');
            windows.forEach((windowEl: HTMLElement) => {
                updateWindowFromZoom(cy, windowEl, zoom);
            });

            // Update horizontal context menu position (uses CSS transform scaling)
            const menu: HTMLElement | null = overlay.querySelector('.cy-horizontal-context-menu');
            if (menu && menu.dataset.graphX && menu.dataset.graphY) {
                const menuGraphX: number = parseFloat(menu.dataset.graphX);
                const menuGraphY: number = parseFloat(menu.dataset.graphY);
                const menuScreenPos: { readonly x: number; readonly y: number } = graphToScreenPosition({ x: menuGraphX, y: menuGraphY }, zoom);
                menu.style.left = `${menuScreenPos.x}px`;
                menu.style.top = `${menuScreenPos.y}px`;
                menu.style.transform = getWindowTransform('css-transform', zoom, 'center');
            }

            // Debounced notification to terminals for font size adjustment
            if (zoomDebounceTimeout) {
                clearTimeout(zoomDebounceTimeout);
            }
            zoomDebounceTimeout = setTimeout(() => {
                zoomChangeCallbacks.forEach(callback => callback(zoom));
            }, 400);
        };

        syncTransform();
        cy.on('pan zoom resize', syncTransform);
    }

    return overlay;
}

// Re-export for backward compatibility (TerminalVanilla imports this)
export { TERMINAL_CSS_TRANSFORM_THRESHOLD } from '@/pure/floatingWindowScaling';

/**
 * Update a floating window's scale and position based on zoom level
 * Called on every zoom change for all floating windows
 */
function updateWindowFromZoom(cy: cytoscape.Core, windowElement: HTMLElement, zoom: number): void {
    const baseWidth: number = parseFloat(windowElement.dataset.baseWidth ?? '400');
    const baseHeight: number = parseFloat(windowElement.dataset.baseHeight ?? '400');
    const isTerminal: boolean = windowElement.classList.contains('cy-floating-window-terminal');
    const windowType: 'Terminal' | 'Editor' = isTerminal ? 'Terminal' : 'Editor';
    const strategy: ScalingStrategy = getScalingStrategy(windowType, zoom);

    // Get title bar element for font scaling
    const titleBar: HTMLElement | null = windowElement.querySelector('.cy-floating-window-title');

    // Apply dimensions based on strategy
    const baseDimensions: { readonly width: number; readonly height: number } = { width: baseWidth, height: baseHeight };
    const screenDimensions: { readonly width: number; readonly height: number } = getScreenDimensions(baseDimensions, zoom, strategy);
    windowElement.style.width = `${screenDimensions.width}px`;
    windowElement.style.height = `${screenDimensions.height}px`;
    windowElement.dataset.usingCssTransform = strategy === 'css-transform' ? 'true' : 'false';

    // Apply title bar font size
    if (titleBar) {
        titleBar.style.fontSize = `${getTitleBarFontSize(zoom, strategy)}px`;
    }

    // Update position - look up shadow node or use stored graph position
    const shadowNodeId: string | undefined = windowElement.dataset.shadowNodeId;
    let graphX: number | undefined;
    let graphY: number | undefined;

    if (shadowNodeId) {
        const shadowNode: cytoscape.CollectionReturnValue = cy.getElementById(shadowNodeId);
        if (shadowNode.length > 0) {
            const pos: cytoscape.Position = shadowNode.position();
            graphX = pos.x;
            graphY = pos.y;
        }
    } else if (windowElement.dataset.graphX && windowElement.dataset.graphY) {
        // Hover editors store their graph position in dataset (no shadow node)
        graphX = parseFloat(windowElement.dataset.graphX);
        graphY = parseFloat(windowElement.dataset.graphY);
    }

    if (graphX !== undefined && graphY !== undefined) {
        const screenPos: { readonly x: number; readonly y: number } = graphToScreenPosition({ x: graphX, y: graphY }, zoom);
        windowElement.style.left = `${screenPos.x}px`;
        windowElement.style.top = `${screenPos.y}px`;

        // Check for custom transform origin (e.g., hover editors use translateX(-50%) for centering)
        const customOrigin: TransformOrigin = windowElement.dataset.transformOrigin === 'top-center' ? 'top-center' : 'center';
        windowElement.style.transform = getWindowTransform(strategy, zoom, customOrigin);
        windowElement.style.transformOrigin = getTransformOrigin(customOrigin);
    }
}



// =============================================================================
// Window Chrome Creation
// =============================================================================

/**
 * Create the window chrome (frame) with vanilla DOM
 * Returns DOM refs that will populate the `ui` field on FloatingWindowData
 *
 * NO stored callbacks - use disposeFloatingWindow() for cleanup
 */
export function createWindowChrome(
    cy: cytoscape.Core,
    fw: FloatingWindowData | FloatingWindowFields,
    id: EditorId | TerminalId
): FloatingWindowUIData {
    const dimensions: { width: number; height: number } = fw.shadowNodeDimensions;

    // Create main window container
    const windowElement: HTMLDivElement = document.createElement('div');
    windowElement.id = `window-${id}`;
    // Add type-specific class (terminal vs editor) for differentiated styling
    const typeClass: string = 'type' in fw ? `cy-floating-window-${fw.type.toLowerCase()}` : '';
    windowElement.className = `cy-floating-window ${typeClass}`.trim();
    windowElement.setAttribute('data-floating-window-id', id);

    // Store base dimensions for zoom scaling (used by updateWindowFromZoom)
    windowElement.dataset.baseWidth = String(dimensions.width);
    windowElement.dataset.baseHeight = String(dimensions.height);

    // Determine scaling strategy and apply initial dimensions
    const currentZoom: number = getCachedZoom();
    const isTerminal: boolean = typeClass.includes('terminal');
    const windowType: 'Terminal' | 'Editor' = isTerminal ? 'Terminal' : 'Editor';
    const strategy: ScalingStrategy = getScalingStrategy(windowType, currentZoom);
    const screenDimensions: { readonly width: number; readonly height: number } = getScreenDimensions(dimensions, currentZoom, strategy);

    windowElement.style.width = `${screenDimensions.width}px`;
    windowElement.style.height = `${screenDimensions.height}px`;
    windowElement.dataset.usingCssTransform = strategy === 'css-transform' ? 'true' : 'false';

    if (fw.resizable) {
        windowElement.classList.add('resizable');
    }

    // Event isolation - prevent graph interactions
    windowElement.addEventListener('mousedown', (e: MouseEvent): void => {
        e.stopPropagation();
        selectFloatingWindowNode(cy, fw);
    });
    // Allow horizontal scroll to pan graph, block vertical scroll for in-window scrolling
    windowElement.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            e.stopPropagation();
        }
    }, { passive: false });

    // Create title bar
    const titleBar: HTMLDivElement = document.createElement('div');
    titleBar.className = 'cy-floating-window-title';

    const titleText: HTMLSpanElement = document.createElement('span');
    titleText.className = 'cy-floating-window-title-text';
    titleText.textContent = fw.title || `Window: ${id}`;

    // Create fullscreen button
    const fullscreenButton: HTMLButtonElement = document.createElement('button');
    fullscreenButton.className = 'cy-floating-window-fullscreen';
    fullscreenButton.textContent = '⛶';
    fullscreenButton.title = 'Toggle Fullscreen';
    // Note: fullscreen handler will be attached by the caller (FloatingEditorManager/spawnTerminal)

    // Create close button (handler will be attached by disposeFloatingWindow pattern)
    const closeButton: HTMLButtonElement = document.createElement('button');
    closeButton.className = 'cy-floating-window-close';
    closeButton.textContent = '×';
    // Note: close handler attached via disposeFloatingWindow pattern

    // Assemble title bar
    titleBar.appendChild(titleText);
    titleBar.appendChild(fullscreenButton);
    titleBar.appendChild(closeButton);

    // Create content container
    const contentContainer: HTMLDivElement = document.createElement('div');
    contentContainer.className = 'cy-floating-window-content';

    // Assemble window
    windowElement.appendChild(titleBar);
    windowElement.appendChild(contentContainer);

    return { windowElement, contentContainer, titleBar };
}

// =============================================================================
// Anchor to Node
// =============================================================================

// =============================================================================
// Dispose Floating Window
// =============================================================================

/**
 * Dispose a floating window - remove from DOM and Cytoscape
 * Runs cleanup for event listeners and ResizeObserver before removing
 */
export function disposeFloatingWindow(
    cy: cytoscape.Core,
    fw: FloatingWindowData
): void {
    const fwId: EditorId | TerminalId = getFloatingWindowId(fw);
    const shadowNodeId: ShadowNodeId = getShadowNodeId(fwId);

    console.log('[disposeFloatingWindow-v2] Disposing:', fwId);

    // Run cleanup for event listeners and observers
    if (fw.ui) {
        const cleanup: CleanupFunctions | undefined = cleanupRegistry.get(fw.ui.windowElement);
        if (cleanup) {
            // Remove document-level drag listeners
            document.removeEventListener('mousemove', cleanup.dragMouseMove);
            document.removeEventListener('mouseup', cleanup.dragMouseUp);
            // Disconnect ResizeObserver
            if (cleanup.resizeObserver) {
                cleanup.resizeObserver.disconnect();
            }
            // Remove parent position listener
            if (cleanup.parentPositionHandler) {
                const shadowNode: cytoscape.CollectionReturnValue = cy.getElementById(shadowNodeId);
                if (shadowNode.length > 0) {
                    const parentNodeId: string = shadowNode.data('parentNodeId');
                    const parentNode: cytoscape.CollectionReturnValue = cy.getElementById(parentNodeId);
                    if (parentNode.length > 0) {
                        parentNode.off('position', undefined, cleanup.parentPositionHandler);
                    }
                }
            }
            cleanupRegistry.delete(fw.ui.windowElement);
        }
    }

    // Remove shadow node from Cytoscape (this also removes connected edges and position listeners)
    const shadowNode: cytoscape.CollectionReturnValue = cy.getElementById(shadowNodeId);
    if (shadowNode.length > 0) {
        shadowNode.remove();
    }

    // Remove DOM elements
    if (fw.ui) {
        fw.ui.windowElement.remove();
    }

    // Remove from state
    if (isEditorData(fw)) {
        removeEditor(getEditorId(fw));
    } else {
        removeTerminal(getTerminalId(fw));
    }
}

/**
 * Attach close button handler to a floating window
 * This sets up the close button to call disposeFloatingWindow
 */
export function attachCloseHandler(
    cy: cytoscape.Core,
    fw: FloatingWindowData,
    additionalCleanup?: () => void
): void {
    if (!fw.ui) {
        throw new Error('FloatingWindowData.ui must be populated before attaching close handler');
    }

    const closeButton: HTMLButtonElement | null = fw.ui.titleBar.querySelector('.cy-floating-window-close');
    if (closeButton) {
        closeButton.addEventListener('click', () => {
            if (additionalCleanup) {
                additionalCleanup();
            }
            disposeFloatingWindow(cy, fw);
        });
    }
}
