import type cytoscape from "cytoscape";
import {
    type EditorId,
    type FloatingWindowData,
    getFloatingWindowId,
    getShadowNodeId,
    type ImageViewerId,
    isTerminalData,
    type ShadowNodeId,
    type TerminalId
} from "@/shell/edge/UI-edge/floating-windows/types";
import * as O from "fp-ts/lib/Option.js";
import type {NodeIdAndFilePath} from "@/pure/graph";
import {
    getWindowTransform,
    graphToScreenPosition,
    type ScalingStrategy,
    screenToGraphDimensions
} from "@/pure/floatingWindowScaling";
import {cleanupRegistry, getCachedZoom} from "@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows";
import {setupResizeObserver, updateShadowNodeDimensions} from "@/shell/edge/UI-edge/floating-windows/setup-resize-observer";
import {DEFAULT_EDGE_LENGTH} from "@/shell/UI/cytoscape-graph-ui/graphviz/layout/cytoscape-graph-constants";

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
    const {windowElement} = fw.ui;

    console.log('[anchorToNode-v2] Anchoring to parentNodeId:', parentNodeId);

    const parentNode: cytoscape.CollectionReturnValue = cy.getElementById(parentNodeId);
    if (parentNode.length === 0) {
        throw new Error(`Parent node "${parentNodeId}" not found in graph. Cannot anchor floating window.`);
    }

    // Derive shadow node ID from the floating window data
    const fwId: EditorId | TerminalId | ImageViewerId = getFloatingWindowId(fw);
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
        {dx: 1, dy: 0},   // right
        {dx: -1, dy: 0},  // left
        {dx: 0, dy: 1},   // below
        {dx: 0, dy: -1},  // above
    ];

    // AABB overlap check
    type BBox = { x1: number; x2: number; y1: number; y2: number };
    const rectsOverlap: (a: BBox, b: BBox) => boolean = (a: BBox, b: BBox): boolean => {
        return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
    };

    // Get all nodes to check for collisions (including shadow nodes for other floating windows)
    const existingNodes: cytoscape.NodeCollection = cy.nodes();
    // todo, need to make this just neighborhood, not O(N)
    // // DEBUG: Log all existing nodes and their dimensions for collision detection
    // console.log('[anchorToNode] Checking collisions. Total nodes:', existingNodes.length);
    // existingNodes.forEach((node: cytoscape.NodeSingular) => {
    //     if (node.id() === parentNodeId) return;
    //     const pos: cytoscape.Position = node.position();
    //     const w: number = node.width();
    //     const h: number = node.height();
    //     const isShadow: boolean = node.data('isShadowNode') === true;
    //     console.log(`[anchorToNode]   Node: ${node.id()}, isShadow: ${isShadow}, pos: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}), dims: ${w.toFixed(1)}x${h.toFixed(1)}`);
    // });
    // console.log(`[anchorToNode] Terminal shadowDimensions: ${shadowDimensions.width}x${shadowDimensions.height}`);
    //
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
        // Include DEFAULT_EDGE_LENGTH to push candidate past sibling floating windows
        // (siblings are typically one edge length away from parent)
        const offsetX: number = dir.dx * ((shadowDimensions.width / 2) + (parentWidth / 2) + gap + DEFAULT_EDGE_LENGTH);
        const offsetY: number = dir.dy * ((shadowDimensions.height / 2) + (parentHeight / 2) + gap + DEFAULT_EDGE_LENGTH);
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
        // Note: Use node.width()/height() instead of boundingBox() because boundingBox()
        // can return incorrect values for shadow nodes in certain scenarios
        // TODO: If terminal/editor collision bug persists, it's likely a race condition
        // where the context node position hasn't been set yet when this runs
        let hasOverlap: boolean = false;
        existingNodes.forEach((node: cytoscape.NodeSingular) => {
            if (node.id() === parentNodeId) return;
            const pos: cytoscape.Position = node.position();
            const w: number = node.width();
            const h: number = node.height();
            const nodeBBox: BBox = {
                x1: pos.x - w / 2,
                x2: pos.x + w / 2,
                y1: pos.y - h / 2,
                y2: pos.y + h / 2
            };
            if (rectsOverlap(terminalBBox, nodeBBox)) {
                hasOverlap = true;
            }
        });

        // DEBUG: Log overlap detection result
        const dirName: string = dir.dx === 1 ? 'right' : dir.dx === -1 ? 'left' : dir.dy === 1 ? 'below' : 'above';
        console.log(`[anchorToNode] Direction ${dirName}: hasOverlap=${hasOverlap}, candidatePos=(${candidatePos.x.toFixed(1)}, ${candidatePos.y.toFixed(1)})`);

        if (!hasOverlap) {
            // Calculate angle from context -> terminal candidate
            const candidateAngle: number = Math.atan2(candidatePos.y - parentPos.y, candidatePos.x - parentPos.x);
            // Calculate absolute angle difference (normalized to [0, PI])
            let angleDiff: number = Math.abs(candidateAngle - desiredAngle);
            if (angleDiff > Math.PI) {
                angleDiff = 2 * Math.PI - angleDiff;
            }
            candidates.push({pos: candidatePos, angleDiff});
        }
    }

    // Pick candidate with minimum angle difference (closest to continuation angle)
    let childPosition: { x: number; y: number };
    if (candidates.length > 0) {
        candidates.sort((a, b) => a.angleDiff - b.angleDiff);
        // Place at DEFAULT_EDGE_LENGTH center-to-center (matches cola's edge length)
        const chosen: { x: number; y: number } = candidates[0].pos;
        childPosition = {
            x: parentPos.x + Math.sign(chosen.x - parentPos.x) * DEFAULT_EDGE_LENGTH,
            y: parentPos.y + Math.sign(chosen.y - parentPos.y) * DEFAULT_EDGE_LENGTH
        };
        console.log(`[anchorToNode] Chose position from ${candidates.length} candidates: (${childPosition.x.toFixed(1)}, ${childPosition.y.toFixed(1)})`);
    } else {
        // Fallback to right if all directions blocked
        childPosition = {
            x: parentPos.x + DEFAULT_EDGE_LENGTH,
            y: parentPos.y
        };
        console.log(`[anchorToNode] FALLBACK to right (all directions blocked): (${childPosition.x.toFixed(1)}, ${childPosition.y.toFixed(1)})`);
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
    const dimensions: {
        readonly width: number;
        readonly height: number
    } = screenToGraphDimensions(screenDims, currentZoom, strategy);

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

    // Create edge from parent (task node) to shadow
    cy.add({
        group: 'edges',
        data: {
            id: `edge-${parentNode.id()}-${shadowNode.id()}`,
            source: parentNode.id(),
            target: shadowNode.id(),
            isIndicatorEdge: true
        },
        classes: 'terminal-indicator'
    });

    // For terminals: fix context node position to top-left of terminal (no edge)
    // Context node follows terminal position at a fixed offset
    if (isTerminalData(fw) && fw.attachedToNodeId !== parentNodeId) {
        const contextNodeId: NodeIdAndFilePath = fw.attachedToNodeId;
        const contextNode: cytoscape.CollectionReturnValue = cy.getElementById(contextNodeId);

        if (contextNode.length > 0) {
            // Sync context node position to shadow node
            // Dynamically reads dimensions to stay terminal-width aware
            const syncContextPosition: () => void = () => {
                const shadowPos: cytoscape.Position = shadowNode.position();
                // Calculate offset dynamically based on current shadow node dimensions
                const terminalWidth: number = shadowNode.width();
                const terminalHeight: number = shadowNode.height();
                const contextWidth: number = contextNode.width();
                const contextHeight: number = contextNode.height();
                // Position context node flush with terminal left edge, tops aligned
                contextNode.position({
                    x: shadowPos.x - terminalWidth / 2 - contextWidth / 2,
                    y: shadowPos.y - terminalHeight / 2 + contextHeight / 2
                });
            };

            // Initial position sync
            syncContextPosition();

            // Follow terminal on position changes
            shadowNode.on('position', syncContextPosition);

            // Also update context position when terminal is resized
            const handleResize: (evt: cytoscape.EventObject, data: { nodeId: string }) => void = (
                _evt: cytoscape.EventObject,
                data: { nodeId: string }
            ) => {
                if (data.nodeId === shadowNodeId) {
                    syncContextPosition();
                }
            };
            cy.on('floatingwindow:resize', handleResize);

            // Store cleanup reference
            (shadowNode as cytoscape.NodeSingular & { _contextPositionSync?: () => void; _resizeHandler?: typeof handleResize })._contextPositionSync = syncContextPosition;
            (shadowNode as cytoscape.NodeSingular & { _contextPositionSync?: () => void; _resizeHandler?: typeof handleResize })._resizeHandler = handleResize;
        }
    }

    // Set up ResizeObserver (window resize → shadow dimensions)
    // Only triggers layout for user-initiated resizes, not zoom-induced resizes
    const resizeObserver: ResizeObserver | undefined = setupResizeObserver(cy, shadowNode, windowElement);

    // Set up position sync (shadow position → window position)
    const syncPosition: () => void = () => {
        updateWindowPosition(shadowNode, windowElement);
    };
    shadowNode.on('position', syncPosition);
    syncPosition(); // Initial sync

    // BUG: The code below was commented out because it introduced a bug where dragging the terminal
    // causes it to briefly teleport somewhere else. The feature was intended to make context nodes
    // attached to their terminal anchor/shadow node so that dragging the context node drags the terminal.
    // TODO: Fix and re-enable this feature
    /*
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
    */

    // Attach drag handlers (only menu bar areas are draggable) and store cleanup references
    const {handleMouseMove, handleMouseUp} = attachDragHandlers(cy, windowElement, shadowNodeId);

    // Register cleanup functions
    cleanupRegistry.set(windowElement, {
        dragMouseMove: handleMouseMove,
        dragMouseUp: handleMouseUp,
        resizeObserver,
        // parentPositionHandler: syncWithParent, // BUG: commented out - see above
    });

    // Initial dimension sync
    requestAnimationFrame(() => {
        updateShadowNodeDimensions(shadowNode, windowElement);
    });

    return shadowNode;
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

// =============================================================================
// Drag Handlers
// =============================================================================

/**
 * Attach drag-and-drop handlers to the window element
 * Dragging only initiates from menu bar areas (.cy-floating-window-horizontal-menu or .terminal-title-bar)
 * to preserve text selection in editor content
 * Returns the document-level handlers so they can be removed on dispose
 */
function attachDragHandlers(
    cy: cytoscape.Core,
    windowElement: HTMLElement,
    shadowNodeId: ShadowNodeId
): { handleMouseMove: (e: MouseEvent) => void; handleMouseUp: () => void } {
    let isDragging: boolean = false;
    let dragOffset: { x: number; y: number } = { x: 0, y: 0 };

    const handleMouseDown: (e: MouseEvent) => void = (e: MouseEvent) => {
        // Only allow dragging from the menu bar areas, not the content area
        // This preserves text selection in the editor content
        const target: HTMLElement = e.target as HTMLElement;

        // Don't drag when clicking buttons
        if (target.tagName === 'BUTTON') return;

        // Check if the click originated from a draggable area:
        // - .cy-floating-window-horizontal-menu (editor menu bar)
        // - .terminal-title-bar (terminal title bar)
        const draggableArea: Element | null = target.closest('.cy-floating-window-horizontal-menu, .terminal-title-bar');
        if (!draggableArea) return;

        isDragging = true;
        windowElement.classList.add('dragging');

        const pan: cytoscape.Position = cy.pan();

        // currentLeft/Top are already in screen coordinates (graph * zoom)
        // set by updateWindowPosition via graphToScreenPosition
        const currentLeft: number = parseFloat(windowElement.style.left) || 0;
        const currentTop: number = parseFloat(windowElement.style.top) || 0;

        // Viewport position = screen position + pan (overlay is translated by pan)
        const viewportX: number = currentLeft + pan.x;
        const viewportY: number = currentTop + pan.y;

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

        // Use screen coordinates (graph * zoom) to match updateWindowPosition
        const screenPos: { readonly x: number; readonly y: number } = graphToScreenPosition({ x: graphX, y: graphY }, zoom);
        windowElement.style.left = `${screenPos.x}px`;
        windowElement.style.top = `${screenPos.y}px`;

        // Update shadow node position (in graph coordinates)
        const shadowNode: cytoscape.CollectionReturnValue = cy.getElementById(shadowNodeId);
        if (shadowNode.length > 0) {
            shadowNode.position({ x: graphX, y: graphY });
        }
    };

    const handleMouseUp: () => void = () => {
        if (isDragging) {
            isDragging = false;
            windowElement.classList.remove('dragging');
        }
    };

    windowElement.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return { handleMouseMove, handleMouseUp };
}