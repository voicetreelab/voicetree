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
    type ScalingStrategy,
    type TransformOrigin,
    getScalingStrategy,
    graphToScreenPosition,
    getScreenDimensions,
    screenToGraphDimensions,
    getTitleBarFontSize,
    getWindowTransform,
    getTransformOrigin,
} from '@/pure/floatingWindowScaling';

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
import {addRecentlyVisited} from "@/shell/edge/UI-edge/state/RecentlyVisitedStore";

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
const cleanupRegistry: WeakMap<HTMLElement, CleanupFunctions> = new WeakMap();

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
            }, 150);
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
 * Positions are scaled by zoom. Transform includes scale() when using CSS transform mode.
 */
function updateWindowPosition(shadowNode: cytoscape.NodeSingular, domElement: HTMLElement): void {
    const pos: cytoscape.Position = shadowNode.position();
    const zoom: number = getCachedZoom();
    const strategy: ScalingStrategy = domElement.dataset.usingCssTransform === 'true' ? 'css-transform' : 'dimension-scaling';

    // Convert graph coordinates to screen coordinates
    const screenPos: { readonly x: number; readonly y: number } = graphToScreenPosition({ x: pos.x, y: pos.y }, zoom);
    domElement.style.left = `${screenPos.x}px`;
    domElement.style.top = `${screenPos.y}px`;
    domElement.style.transform = getWindowTransform(strategy, zoom, 'center');
}

/**
 * Update shadow node dimensions based on window DOM element dimensions
 * Shadow node dimensions are in graph coordinates (base dimensions)
 */
function updateShadowNodeDimensions(shadowNode: cytoscape.NodeSingular, domElement: HTMLElement): void {
    const strategy: ScalingStrategy = domElement.dataset.usingCssTransform === 'true' ? 'css-transform' : 'dimension-scaling';
    const zoom: number = getCachedZoom();
    const screenDimensions: { readonly width: number; readonly height: number } = {
        width: domElement.offsetWidth,
        height: domElement.offsetHeight
    };
    const graphDimensions: { readonly width: number; readonly height: number } = screenToGraphDimensions(screenDimensions, zoom, strategy);

    shadowNode.style({
        'width': graphDimensions.width,
        'height': graphDimensions.height
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
                addRecentlyVisited(nodeIdToSelect);
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

    // Find best direction to spawn terminal based on available space and neighborhood
    const parentPos: cytoscape.Position = parentNode.position();
    const shadowDimensions: { width: number; height: number } = fw.shadowNodeDimensions;
    const parentWidth: number = parentNode.width();
    const parentHeight: number = parentNode.height();
    const gap: number = 20;

    // Cardinal directions
    type Direction = { dx: number; dy: number };
    const directions: Direction[] = [
        { dx: 1, dy: 0 },   // right
        { dx: -1, dy: 0 },  // left
        { dx: 0, dy: 1 },   // below
        { dx: 0, dy: -1 },  // above
    ];

    // AABB overlap check
    type BBox = { x1: number; x2: number; y1: number; y2: number };
    const rectsOverlap: (a: BBox, b: BBox) => boolean = (a: BBox, b: BBox): boolean => {
        return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
    };

    // Get all nodes to check for collisions (including shadow nodes for other floating windows)
    const existingNodes: cytoscape.NodeCollection = cy.nodes();

    // Calculate desired angle using angle continuation heuristic:
    // Find the grandparent (task node) and continue the angle from task -> context -> terminal
    const incomingEdges: cytoscape.EdgeCollection = parentNode.incomers('edge').filter(
        (e: cytoscape.EdgeSingular) => !e.source().data('isShadowNode')
    );
    let desiredAngle: number;
    if (incomingEdges.length > 0) {
        // Use first incoming edge's source as grandparent (task node)
        const grandparentNode: cytoscape.NodeSingular = incomingEdges[0].source();
        const grandparentPos: cytoscape.Position = grandparentNode.position();
        // Angle from grandparent -> context node, which we want to continue
        desiredAngle = Math.atan2(parentPos.y - grandparentPos.y, parentPos.x - grandparentPos.x);
    } else {
        // No grandparent (context node is root), default to right (angle 0)
        desiredAngle = 0;
    }

    // Calculate candidate positions and filter by no-overlap
    const candidates: { pos: { x: number; y: number }; angleDiff: number }[] = [];
    for (const dir of directions) {
        const offsetX: number = dir.dx * ((shadowDimensions.width / 2) + (parentWidth / 2) + gap);
        const offsetY: number = dir.dy * ((shadowDimensions.height / 2) + (parentHeight / 2) + gap);
        const candidatePos: { x: number; y: number } = {
            x: parentPos.x + offsetX,
            y: parentPos.y + offsetY
        };

        // Calculate terminal bounding box at candidate position
        const terminalBBox: BBox = {
            x1: candidatePos.x - shadowDimensions.width / 2,
            x2: candidatePos.x + shadowDimensions.width / 2,
            y1: candidatePos.y - shadowDimensions.height / 2,
            y2: candidatePos.y + shadowDimensions.height / 2
        };

        // Check overlap with existing nodes
        let hasOverlap: boolean = false;
        existingNodes.forEach((node: cytoscape.NodeSingular) => {
            if (node.id() === parentNodeId) return;
            const bb: cytoscape.BoundingBox12 & cytoscape.BoundingBoxWH = node.boundingBox();
            const nodeBBox: BBox = { x1: bb.x1, x2: bb.x2, y1: bb.y1, y2: bb.y2 };
            if (rectsOverlap(terminalBBox, nodeBBox)) {
                hasOverlap = true;
            }
        });

        if (!hasOverlap) {
            // Calculate angle from context -> terminal candidate
            const candidateAngle: number = Math.atan2(candidatePos.y - parentPos.y, candidatePos.x - parentPos.x);
            // Calculate absolute angle difference (normalized to [0, PI])
            let angleDiff: number = Math.abs(candidateAngle - desiredAngle);
            if (angleDiff > Math.PI) {
                angleDiff = 2 * Math.PI - angleDiff;
            }
            candidates.push({ pos: candidatePos, angleDiff });
        }
    }

    // Pick candidate with minimum angle difference (closest to continuation angle)
    let childPosition: { x: number; y: number };
    if (candidates.length > 0) {
        candidates.sort((a, b) => a.angleDiff - b.angleDiff);
        childPosition = candidates[0].pos;
    } else {
        // Fallback to right if all directions blocked
        const offsetX: number = (shadowDimensions.width / 2) + (parentWidth / 2) + gap;
        childPosition = {
            x: parentPos.x + offsetX,
            y: parentPos.y
        };
    }

    // Create shadow node (follows parent position via listener below)
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
    windowElement.dataset.shadowNodeId = shadowNodeId;

    // Calculate shadow node dimensions (graph coordinates)
    const strategy: ScalingStrategy = windowElement.dataset.usingCssTransform === 'true' ? 'css-transform' : 'dimension-scaling';
    const currentZoom: number = getCachedZoom();
    const screenDims: { readonly width: number; readonly height: number } = {
        width: windowElement.offsetWidth,
        height: windowElement.offsetHeight
    };
    const dimensions: { readonly width: number; readonly height: number } = screenToGraphDimensions(screenDims, currentZoom, strategy);

    // Shadow node visible on minimap with subtle styling
    shadowNode.style({
        'opacity': 0.1,
        'background-color': '#333333',
        'border-width': 2,
        'border-color': 'black',
        'shape': 'rectangle',
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

    // Track offset for parent sync (terminal follows context node when dragged)
    let currentOffset: { x: number; y: number } = {
        x: childPosition.x - parentPos.x,
        y: childPosition.y - parentPos.y
    };

    // Update offset when shadow node is dragged directly
    shadowNode.on('position', () => {
        const shadowPos: cytoscape.Position = shadowNode.position();
        const parentPosition: cytoscape.Position = parentNode.position();
        currentOffset = {
            x: shadowPos.x - parentPosition.x,
            y: shadowPos.y - parentPosition.y
        };
    });

    // Parent position sync: terminal follows context node at current offset
    const syncWithParent: () => void = () => {
        const newParentPos: cytoscape.Position = parentNode.position();
        shadowNode.position({
            x: newParentPos.x + currentOffset.x,
            y: newParentPos.y + currentOffset.y
        });
    };
    parentNode.on('position', syncWithParent);

    // Attach drag handlers and store cleanup references
    const { handleMouseMove, handleMouseUp } = attachDragHandlers(cy, titleBar, windowElement, shadowNodeId);

    // Register cleanup functions
    cleanupRegistry.set(windowElement, {
        dragMouseMove: handleMouseMove,
        dragMouseUp: handleMouseUp,
        resizeObserver,
        parentPositionHandler: syncWithParent,
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
