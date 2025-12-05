/**
 * Cytoscape Floating Window Extension - V2
 *
 * Rewritten to use types.ts with flat types and derived IDs.
 * Windows are anchored to invisible shadow nodes and move with graph transformations.
 */

import type cytoscape from 'cytoscape';
import * as O from 'fp-ts/lib/Option.js';
import type { NodeIdAndFilePath } from "@/pure/graph";
import {
    type FloatingWindowData,
    type FloatingWindowFields,
    type FloatingWindowUIData,
    type EditorId,
    type TerminalId,
    type ShadowNodeId,
    getEditorId,
    getTerminalId,
    getFloatingWindowId,
    getShadowNodeId,
    isEditorData,
    isTerminalData,
} from '@/shell/edge/UI-edge/floating-windows/types';
import {removeTerminal} from "@/shell/edge/UI-edge/state/TerminalStore";
import {removeEditor} from "@/shell/edge/UI-edge/state/EditorStore";

// =============================================================================
// Cleanup Registry (WeakMap keyed by windowElement)
// =============================================================================

type CleanupFunctions = {
    dragMouseMove: (e: MouseEvent) => void;
    dragMouseUp: () => void;
    resizeObserver?: ResizeObserver;
};

/**
 * WeakMap to store cleanup functions for each floating window.
 * Keyed by windowElement - when element is GC'd, entry is auto-removed.
 * disposeFloatingWindow looks up and runs these before removing DOM.
 */
const cleanupRegistry: WeakMap<HTMLElement, CleanupFunctions> = new WeakMap();

// =============================================================================
// Overlay Management (unchanged from v1)
// =============================================================================

/**
 * Get or create the shared overlay container for all floating windows
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

        const syncTransform: () => void = () => {
            const pan: cytoscape.Position = cy.pan();
            const zoom: number = cy.zoom();
            overlay.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
        };

        syncTransform();
        cy.on('pan zoom resize', syncTransform);
    }

    return overlay;
}

// =============================================================================
// Default Dimensions (unchanged from v1)
// =============================================================================

/**
 * Get default shadow node dimensions based on type
 */
export function getDefaultDimensions(type: 'Editor' | 'Terminal'): { width: number; height: number } {
    switch (type) {
        case 'Terminal':
            return { width: 600, height: 400 };
        case 'Editor':
            return { width: 400, height: 400 };
    }
}

// =============================================================================
// Position Sync Utilities
// =============================================================================

/**
 * Update window DOM element position based on shadow node position
 */
function updateWindowPosition(shadowNode: cytoscape.NodeSingular, domElement: HTMLElement): void {
    const pos: cytoscape.Position = shadowNode.position();
    domElement.style.left = `${pos.x}px`;
    domElement.style.top = `${pos.y}px`;
    domElement.style.transform = 'translate(-50%, -50%)';
}

/**
 * Update shadow node dimensions based on window DOM element dimensions
 */
function updateShadowNodeDimensions(shadowNode: cytoscape.NodeSingular, domElement: HTMLElement): void {
    const width: number = domElement.offsetWidth;
    const height: number = domElement.offsetHeight;
    shadowNode.style({
        'width': width,
        'height': height
    });
}

// =============================================================================
// Drag Handlers
// =============================================================================

/**
 * Attach drag-and-drop handlers to the title bar
 * Returns the document-level handlers so they can be removed on dispose
 */
function attachDragHandlers(
    cy: cytoscape.Core,
    titleBar: HTMLElement,
    windowElement: HTMLElement,
    shadowNodeId: ShadowNodeId
): { handleMouseMove: (e: MouseEvent) => void; handleMouseUp: () => void } {
    let isDragging: boolean = false;
    let dragOffset: { x: number; y: number } = { x: 0, y: 0 };

    const handleMouseDown: (e: MouseEvent) => void = (e: MouseEvent) => {
        if ((e.target as HTMLElement).tagName === 'BUTTON') return;

        isDragging = true;
        titleBar.classList.add('dragging');

        const pan: cytoscape.Position = cy.pan();
        const zoom: number = cy.zoom();

        const currentLeft: number = parseFloat(windowElement.style.left) || 0;
        const currentTop: number = parseFloat(windowElement.style.top) || 0;

        const viewportX: number = (currentLeft * zoom) + pan.x;
        const viewportY: number = (currentTop * zoom) + pan.y;

        dragOffset = {
            x: e.clientX - viewportX,
            y: e.clientY - viewportY
        };

        e.preventDefault();
    };

    const handleMouseMove: (e: MouseEvent) => void = (e: MouseEvent) => {
        if (!isDragging) return;

        const pan: cytoscape.Position = cy.pan();
        const zoom: number = cy.zoom();

        const viewportX: number = e.clientX - dragOffset.x;
        const viewportY: number = e.clientY - dragOffset.y;

        const graphX: number = (viewportX - pan.x) / zoom;
        const graphY: number = (viewportY - pan.y) / zoom;

        windowElement.style.left = `${graphX}px`;
        windowElement.style.top = `${graphY}px`;

        // Update shadow node position
        const shadowNode: cytoscape.CollectionReturnValue = cy.getElementById(shadowNodeId);
        if (shadowNode.length > 0) {
            shadowNode.position({ x: graphX, y: graphY });
        }
    };

    const handleMouseUp: () => void = () => {
        if (isDragging) {
            isDragging = false;
            titleBar.classList.remove('dragging');
        }
    };

    titleBar.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return { handleMouseMove, handleMouseUp };
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

    windowElement.style.width = `${dimensions.width}px`;
    windowElement.style.height = `${dimensions.height}px`;

    if (fw.resizable) {
        windowElement.classList.add('resizable');
    }

    // Event isolation - prevent graph interactions
    windowElement.addEventListener('mousedown', (e: MouseEvent): void => {
        e.stopPropagation();
        cy.$(':selected').unselect();

        // Select the node associated with this floating window
        // Use contentLinkedToNodeId for editors, attachedToNodeId for terminals
        let nodeIdToSelect: NodeIdAndFilePath | undefined;
        if ('type' in fw) {
            // fw is FloatingWindowData (has type discriminant)
            const fwData: FloatingWindowData = fw as FloatingWindowData;
            if (isEditorData(fwData)) {
                nodeIdToSelect = fwData.contentLinkedToNodeId;
            } else if (isTerminalData(fwData)) {
                nodeIdToSelect = fwData.attachedToNodeId;
            }
        } else if (O.isSome(fw.anchoredToNodeId)) {
            // Fallback for plain FloatingWindowFields (e.g., settings editor)
            nodeIdToSelect = fw.anchoredToNodeId.value;
        }

        if (nodeIdToSelect) {
            const parentNode: cytoscape.CollectionReturnValue = cy.getElementById(nodeIdToSelect);
            if (parentNode.length > 0) {
                parentNode.select();
            }
        }
    });
    windowElement.addEventListener('wheel', (e) => {
        e.stopPropagation();
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

/**
 * Anchor a floating window to a parent node
 * Creates an invisible shadow node and sets up bidirectional position sync
 *
 * Requires: fw.ui must be populated (call createWindowChrome first)
 */
export function anchorToNode(
    cy: cytoscape.Core,
    fw: FloatingWindowData
): cytoscape.NodeSingular {
    // Validate ui is populated
    if (!fw.ui) {
        throw new Error('FloatingWindowData.ui must be populated before calling anchorToNode. Call createWindowChrome first.');
    }

    // Validate anchored
    if (!O.isSome(fw.anchoredToNodeId)) {
        throw new Error('Cannot anchor a floating window that has no anchoredToNodeId');
    }

    const parentNodeId: NodeIdAndFilePath = fw.anchoredToNodeId.value;
    const { windowElement, titleBar } = fw.ui;

    console.log('[anchorToNode-v2] Anchoring to parentNodeId:', parentNodeId);

    const parentNode: cytoscape.CollectionReturnValue = cy.getElementById(parentNodeId);
    if (parentNode.length === 0) {
        throw new Error(`Parent node "${parentNodeId}" not found in graph. Cannot anchor floating window.`);
    }

    // Derive shadow node ID from the floating window data
    const fwId: EditorId | TerminalId = getFloatingWindowId(fw);
    const shadowNodeId: ShadowNodeId = getShadowNodeId(fwId);

    // Position child shadow node offset from parent
    const parentPos: cytoscape.Position = parentNode.position();
    const childPosition: { x: number; y: number } = {
        x: parentPos.x + 50,
        y: parentPos.y + 50
    };

    // Create shadow node
    const shadowNode: cytoscape.CollectionReturnValue = cy.add({
        group: 'nodes',
        data: {
            id: shadowNodeId,
            parentId: parentNodeId,
            parentNodeId: parentNodeId,
            isFloatingWindow: true,
            isShadowNode: true,
            windowType: fw.type, // 'Terminal' or 'Editor' from V2 type system
            laidOut: false
        },
        position: childPosition
    });

    // Store shadow node ID on DOM element for drag handler
    windowElement.setAttribute('data-shadow-node-id', shadowNodeId);

    // Style shadow node (invisible but with dimensions)
    const dimensions: { width: number; height: number } = {
        width: windowElement.offsetWidth,
        height: windowElement.offsetHeight
    };

    shadowNode.style({
        'opacity': 0,
        'events': 'yes',
        'width': dimensions.width,
        'height': dimensions.height
    });

    // Create edge from parent to shadow
    cy.add({
        group: 'edges',
        data: {
            id: `edge-${parentNode.id()}-${shadowNode.id()}`,
            source: parentNode.id(),
            target: shadowNode.id()
        }
    });

    // Set up ResizeObserver (window resize → shadow dimensions)
    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
            updateShadowNodeDimensions(shadowNode, windowElement);
            cy.trigger('floatingwindow:resize', [{ nodeId: shadowNode.id() }]);
        });
        resizeObserver.observe(windowElement);
    }

    // Set up position sync (shadow position → window position)
    const syncPosition: () => void = () => {
        updateWindowPosition(shadowNode, windowElement);
    };
    shadowNode.on('position', syncPosition);
    syncPosition(); // Initial sync

    // Attach drag handlers and store cleanup references
    const { handleMouseMove, handleMouseUp } = attachDragHandlers(cy, titleBar, windowElement, shadowNodeId);

    // Register cleanup functions
    cleanupRegistry.set(windowElement, {
        dragMouseMove: handleMouseMove,
        dragMouseUp: handleMouseUp,
        resizeObserver,
    });

    // Initial dimension sync
    requestAnimationFrame(() => {
        updateShadowNodeDimensions(shadowNode, windowElement);
    });

    return shadowNode;
}

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

// =============================================================================
// Utility: Create and anchor in one step (convenience)
// =============================================================================

/**
 * Helper to create window chrome and anchor to node in one step
 * Returns the FloatingWindowData with ui populated
 */
export function createAndAnchorFloatingWindow<T extends FloatingWindowData>(
    cy: cytoscape.Core,
    fw: T
): T & { ui: FloatingWindowUIData } {
    const fwId: EditorId | TerminalId = getFloatingWindowId(fw);
    const ui: FloatingWindowUIData = createWindowChrome(cy, fw, fwId);

    // Create a new object with ui populated (immutable update)
    const fwWithUI: T & { ui: FloatingWindowUIData } = { ...fw, ui };

    // Add to overlay
    const overlay: HTMLElement = getOrCreateOverlay(cy);
    overlay.appendChild(ui.windowElement);

    // Anchor if needed
    if (O.isSome(fw.anchoredToNodeId)) {
        anchorToNode(cy, fwWithUI);
    }

    return fwWithUI;
}
