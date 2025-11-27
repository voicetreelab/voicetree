/**
 * Cytoscape Floating Window Extension
 *
 * Adds floating window functionality to Cytoscape graphs.
 * Windows are anchored to invisible shadow nodes and move with graph transformations.
 */

import type cytoscape from 'cytoscape';
import type {FloatingWindowData, FloatingWindowUIHTMLData} from '@/shell/edge/UI-edge/floating-windows/types';
import type {NodeIdAndFilePath} from "@/pure/graph";
import {vanillaFloatingWindowInstances} from "@/shell/edge/UI-edge/state/UIAppState";

/**
 * Get or create the shared overlay container for all floating windows
 */
export function getOrCreateOverlay(cy: cytoscape.Core): HTMLElement {
    const container: HTMLElement = cy.container() as HTMLElement;
    const parent: HTMLElement | null = container.parentElement;

    if (!parent) {
        throw new Error('Cytoscape container has no parent element');
    }

    // Check if overlay already exists
    let overlay: HTMLElement = parent.querySelector('.cy-floating-overlay') as HTMLElement;

    if (!overlay) {
        // Create new overlay as sibling to cy container
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

        // Sync overlay transform with graph pan/zoom
        const syncTransform: () => void = () => {
            const pan: cytoscape.Position = cy.pan();
            const zoom: number = cy.zoom();
            overlay.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
        };

        // Initial sync
        syncTransform();

        // Listen to graph events
        cy.on('pan zoom resize', syncTransform);
    }

    return overlay;
}

/**
 * Update window DOM element position based on node position
 */
function updateWindowPosition(node: cytoscape.NodeSingular, domElement: HTMLElement): void {
    const pos: cytoscape.Position = node.position();
    domElement.style.left = `${pos.x}px`;
    domElement.style.top = `${pos.y}px`;
    domElement.style.transform = 'translate(-50%, -50%)'; // this is not the culprit fro highlight mismatch
}

/**
 * Update shadow node dimensions based on window DOM element dimensions
 * Dimensions flow: DOM element (source of truth) → shadow node (for layout)
 */
function updateShadowNodeDimensions(shadowNode: cytoscape.NodeSingular, domElement: HTMLElement): void {
    // Use offsetWidth/Height to get full rendered size including borders
    const width: number = domElement.offsetWidth;
    const height: number = domElement.offsetHeight;

    // Update shadow node dimensions for layout algorithm
    shadowNode.style({
        'width': width,
        'height': height
    });
}

/**
 * Create the window chrome (frame) synchronously with vanilla DOM
 * This includes: window container, title bar, close button, and content container
 * Returns the main window element, content container, and title bar
 */
export function createWindowChrome(
    cy: cytoscape.Core,
    config: FloatingWindowData
): { windowElement: HTMLElement; contentContainer: HTMLElement; titleBar: HTMLElement } {
    const {associatedTerminalOrEditorID, title, resizable = false, component} = config;

    // Get initial dimensions for this component type
    const dimensions: { width: number; height: number; } = config.shadowNodeDimensions ?? getDefaultDimensions(component);

    // Create main window container
    const windowElement: HTMLDivElement = document.createElement('div');
    windowElement.id = `window-${associatedTerminalOrEditorID}`;
    windowElement.className = 'cy-floating-window';
    windowElement.setAttribute('data-shadow-node-relativeFilePathIsID', associatedTerminalOrEditorID) // todo, move this to the type system (this will be unnecessary once we start using EditorData type);

    // Set initial dimensions
    windowElement.style.width = `${dimensions.width}px`;
    windowElement.style.height = `${dimensions.height}px`;

    if (resizable) {
        windowElement.classList.add('resizable');
    }

    // Event isolation - prevent graph interactions
    // Also select the associated node when clicking inside the editor
    // so that Cmd+Enter runs the terminal for this node
    windowElement.addEventListener('mousedown', (e: MouseEvent): void => {
        e.stopPropagation();
        // Select the associated node in Cytoscape
        // First, unselect all other nodes
        cy.$(':selected').unselect();
        // Then select the parent node for this editor (derived from window ID)
        // The window ID is `${nodeId}-editor`, so extract the nodeId
        const windowId: string = associatedTerminalOrEditorID;
        const editorSuffix: string = '-editor'; // todo we shouldn't assume
        const nodeId: string = windowId.endsWith(editorSuffix)
            ? windowId.slice(0, -editorSuffix.length)
            : windowId;
        const parentNode: cytoscape.CollectionReturnValue = cy.getElementById(nodeId);
        if (parentNode.length > 0) {
            parentNode.select();
        }
    });
    windowElement.addEventListener('wheel', (e) => {
        e.stopPropagation();
    }, {passive: false});

    // Create title bar
    const titleBar: HTMLDivElement = document.createElement('div');
    titleBar.className = 'cy-floating-window-title';

    // Create title text
    const titleText: HTMLSpanElement = document.createElement('span');
    titleText.className = 'cy-floating-window-title-text';
    titleText.textContent = title || `Window: ${associatedTerminalOrEditorID}`;

    // Create fullscreen button for all components
    const fullscreenButton: HTMLButtonElement = document.createElement('button');
    fullscreenButton.className = 'cy-floating-window-fullscreen';
    fullscreenButton.textContent = '⛶';
    fullscreenButton.title = 'Toggle Fullscreen';

    // Attach fullscreen handler
    fullscreenButton.addEventListener('click', () => {
        const vanillaInstance: { dispose: () => void; } | undefined = vanillaFloatingWindowInstances.get(associatedTerminalOrEditorID);
        if (vanillaInstance && 'toggleFullscreen' in vanillaInstance) {
            void (vanillaInstance as { toggleFullscreen: () => Promise<void> }).toggleFullscreen();
        }
    });

    // Create close button
    const closeButton: HTMLButtonElement = document.createElement('button');
    closeButton.className = 'cy-floating-window-close';
    closeButton.textContent = '×';

    // Attach close handler
    closeButton.addEventListener('click', () => {
        // Call cleanup callback if provided
        if (config.onClose) {
            config.onClose();
        }
        // Find and remove shadow node (use getElementById to handle IDs with special chars like /)
        const shadowNode: cytoscape.CollectionReturnValue = cy.getElementById(associatedTerminalOrEditorID);
        if (shadowNode.length > 0) {
            shadowNode.remove();
        }
        // Dispose vanilla JS instances
        const vanillaInstance: { dispose: () => void; } | undefined = vanillaFloatingWindowInstances.get(associatedTerminalOrEditorID);
        if (vanillaInstance) {
            vanillaInstance.dispose();
            vanillaFloatingWindowInstances.delete(associatedTerminalOrEditorID);
        }
        windowElement.remove();
    });

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

    return {windowElement, contentContainer, titleBar};
}

/**
 * Attach drag-and-drop handlers to the title bar (vanilla JS)
 */
function attachDragHandlers(
    cy: cytoscape.Core,
    titleBar: HTMLElement,
    windowElement: HTMLElement
): void {
    let isDragging: boolean = false;
    let dragOffset: { x: number; y: number; } = {x: 0, y: 0};

    const handleMouseDown: (e: MouseEvent) => void = (e: MouseEvent) => {
        // Don't start drag if clicking on buttons
        if ((e.target as HTMLElement).tagName === 'BUTTON') return;

        isDragging = true;
        titleBar.classList.add('dragging');

        const pan: cytoscape.Position = cy.pan();
        const zoom: number = cy.zoom();

        // Get current position in graph coordinates from style
        const currentLeft: number = parseFloat(windowElement.style.left) || 0;
        const currentTop: number = parseFloat(windowElement.style.top) || 0;

        // Convert current graph position to viewport coordinates
        const viewportX: number = (currentLeft * zoom) + pan.x;
        const viewportY: number = (currentTop * zoom) + pan.y;

        // Store offset in viewport coordinates
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

        // Calculate new viewport position
        const viewportX: number = e.clientX - dragOffset.x;
        const viewportY: number = e.clientY - dragOffset.y;

        // Convert viewport coordinates to graph coordinates
        const graphX: number = (viewportX - pan.x) / zoom;
        const graphY: number = (viewportY - pan.y) / zoom;

        windowElement.style.left = `${graphX}px`;
        windowElement.style.top = `${graphY}px`;

        // Update shadow node position so edge follows (use getElementById to handle IDs with special chars like /)
        const shadowNodeId: string | null = windowElement.getAttribute('data-shadow-node-relativeFilePathIsID') // todo, move this to the type system (this will be unnecessary once we start using EditorData type);
        if (shadowNodeId) {
            const shadowNode: cytoscape.CollectionReturnValue = cy.getElementById(shadowNodeId);
            if (shadowNode.length > 0) {
                shadowNode.position({x: graphX, y: graphY});
            }
        }
    };

    const handleMouseUp: () => void = () => {
        if (isDragging) {
            isDragging = false;
            titleBar.classList.remove('dragging');
        }
    };

    // Attach listeners
    titleBar.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
}

/**
 * Get default shadow node dimensions based on component type
 * Terminals are larger, editors are medium, other components are small
 */
export function getDefaultDimensions(component: string): { width: number; height: number } {
    switch (component) {
        case 'Terminal':
            // Terminals need more width for 100+ cols and height for ~30+ rows
            // Target: 100 cols × ~9px ≈ 900px + margins (~20px) = 920px
            // Target: 30 rows × ~17px ≈ 510px + title bar (~40px) = 550px
            // Using 800px width to provide ~100 cols and reduce line wrapping (helps with scrolling bug)
            return {width: 600, height: 400};
        case 'MarkdownEditor':
            // Editors are medium - typical size ~500x300
            return {width: 400, height: 400};
        default:
            // Default for unknown components
            return {width: 200, height: 150};
    }
}

/**
 * Anchor a floating window to a parent node
 * Creates an invisible child shadow node and sets up bidirectional synchronization:
 * - Window drag → shadow position
 * - Shadow position → window position
 * - Window resize → shadow dimensions
 *
 * @param floatingWindow - The floating window to anchor
 * @param parentNodeId - The ID of the parent node to anchor to
 * @param shadowNodeData - Optional data for the shadow node (e.g., {isFloatingWindow: true, laidOut: false})
 * @returns The created child shadow node
 */
export function anchorToNode(
    cy : cytoscape.Core,
    floatingWindow: FloatingWindowUIHTMLData,
    parentNodeId: NodeIdAndFilePath,
    shadowNodeData?: Record<string, unknown> // todo remove. get from type
): cytoscape.NodeSingular {
    const {windowElement, titleBar} = floatingWindow;

    console.log('[anchorToNode] Called with parentNodeId:', parentNodeId, 'type:', typeof parentNodeId);

    const parentNode: cytoscape.CollectionReturnValue = cy.getElementById(parentNodeId);
    console.log('[anchorToNode] Parent node found:', parentNode.length > 0, 'length:', parentNode.length);

    // Validate parent node exists
    if (parentNode.length === 0) {
        console.error('[anchorToNode] Parent node not found in graph:', parentNodeId);
        throw new Error(`Parent node "${parentNodeId}" not found in graph. Cannot anchor floating window.`);
    }

    // 1. Create child shadow node ID based on parent node
    const childShadowId: string = `shadow-child-${parentNodeId}-${floatingWindow.id}`; // todo, move this to the type system (this will be unnecessary once we start using EditorData type)

    // 2. Position child shadow node offset from parent (+50, +50)
    const parentPos: cytoscape.Position = parentNode.position();
    console.log('[anchorToNode] Parent position:', parentPos);
    const childPosition: { x: number; y: number; } = {
        x: parentPos.x + 50,
        y: parentPos.y + 50
    };

    // 3. Create child shadow node with parent relationship
    const nodeData: Record<string, unknown> = {
        id: childShadowId,
        parentId: parentNodeId,
        parentNodeId: parentNodeId,
        ...shadowNodeData
    };

    const shadowNode: cytoscape.CollectionReturnValue = cy.add({
        group: 'nodes',
        data: nodeData,
        position: childPosition
    });

    // Update window element's data attribute to point to shadow node
    windowElement.setAttribute('data-shadow-node-relativeFilePathIsID', childShadowId); // todo this will be unnecessary once we start using EditorData type

    // 2. Get initial dimensions from rendered window
    const dimensions: { width: number; height: number; } = {
        width: windowElement.offsetWidth,
        height: windowElement.offsetHeight
    };

    // 3. Style shadow node (invisible but interactive)
    shadowNode.style({
        'opacity': 0,
        'events': 'yes',
        'width': dimensions.width,
        'height': dimensions.height
    });

    // 4. Create edge from parent to shadow
    cy.add({
        group: 'edges',
        data: {
            id: `edge-${parentNode.id()}-${shadowNode.id()}`,
            source: parentNode.id(),
            target: shadowNode.id()
        }
    });

    // 5. Set up ResizeObserver (window resize → shadow dimensions)
    if (typeof ResizeObserver !== 'undefined') {
        const resizeObserver: ResizeObserver = new ResizeObserver(() => {
            updateShadowNodeDimensions(shadowNode, windowElement);
            cy.trigger('floatingwindow:resize', [{nodeId: shadowNode.id()}]);
        });
        resizeObserver.observe(windowElement);
    }

    // 6. Set up position sync (shadow position → window position)
    const syncPosition: () => void = () => {
        updateWindowPosition(shadowNode, windowElement);
    };
    shadowNode.on('position', syncPosition);
    syncPosition(); // Initial sync

    // 7. Attach drag handlers (window drag → shadow position)
    attachDragHandlers(cy, titleBar, windowElement);

    // 8. Initial dimension sync (use requestAnimationFrame to ensure layout is calculated)
    requestAnimationFrame(() => {
        updateShadowNodeDimensions(shadowNode, windowElement);
    });

    // 9. Update cleanup to also remove shadow node
    const originalCleanup: () => void = floatingWindow.cleanup;
    floatingWindow.cleanup = () => {
        if (shadowNode.inside()) {
            shadowNode.remove();
        }
        originalCleanup();
    };

    return shadowNode;
}