/**
 * Cytoscape Floating Window Extension
 *
 * Adds floating window functionality to Cytoscape graphs.
 * Windows are anchored to invisible shadow nodes and move with graph transformations.
 */

import type cytoscape from 'cytoscape';
import {TerminalVanilla} from '@/floating-windows/TerminalVanilla';
import {CodeMirrorEditorView} from '@/floating-windows/CodeMirrorEditorView';
import type {NodeMetadata} from '@/floating-windows/types';
import {modifyNodeContentFromUI} from "@/functional_graph/shell/UI/handleUIActions.ts";
import {getNodeFromUI} from "@/functional_graph/shell/UI/getNodeFromUI.ts";
import type {NodeId} from "@/functional_graph/pure/types.ts";

export interface FloatingWindowConfig {
    id: string;
    component: string;
    title: string;
    position?: { x: number; y: number };
    nodeData?: Record<string, unknown>;
    resizable?: boolean;
    initialContent?: string;
    onSave?: (content: string) => Promise<void>;
    nodeMetadata?: NodeMetadata;
    // Shadow node dimensions for layout algorithm (defaults based on component type)
    shadowNodeDimensions?: { width: number; height: number };
    // Cleanup callback when window is closed
    onClose?: () => void;
}

/**
 * FloatingWindow object returned by component creation functions
 * Provides access to DOM elements and cleanup
 */
export interface FloatingWindow {
    id: string;
    cy: cytoscape.Core;
    windowElement: HTMLElement;
    contentContainer: HTMLElement;
    titleBar: HTMLElement;
    cleanup: () => void;
}

// Store vanilla JS component instances for cleanup
const vanillaInstances = new Map<string, { dispose: () => void }>();

/**
 * Get a vanilla instance by window ID (for testing)
 * @internal - Only for test usage
 */
export function getVanillaInstance(windowId: string): { dispose: () => void } | undefined {
    return vanillaInstances.get(windowId);
}

/**
 * Get or create the shared overlay container for all floating windows
 */
export function getOrCreateOverlay(cy: cytoscape.Core): HTMLElement {
    const container = cy.container() as HTMLElement;
    const parent = container.parentElement;

    if (!parent) {
        throw new Error('Cytoscape container has no parent element');
    }

    // Check if overlay already exists
    let overlay = parent.querySelector('.cy-floating-overlay') as HTMLElement;

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
        const syncTransform = () => {
            const pan = cy.pan();
            const zoom = cy.zoom();
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
function updateWindowPosition(node: cytoscape.NodeSingular, domElement: HTMLElement) {
    const pos = node.position();
    domElement.style.left = `${pos.x}px`;
    domElement.style.top = `${pos.y}px`;
    domElement.style.transform = 'translate(-50%, -50%)'; // this is not the culprit fro highlight mismatch
}

/**
 * Update shadow node dimensions based on window DOM element dimensions
 * Dimensions flow: DOM element (source of truth) → shadow node (for layout)
 */
function updateShadowNodeDimensions(shadowNode: cytoscape.NodeSingular, domElement: HTMLElement) {
    // Use offsetWidth/Height to get full rendered size including borders
    const width = domElement.offsetWidth;
    const height = domElement.offsetHeight;

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
    config: FloatingWindowConfig
): { windowElement: HTMLElement; contentContainer: HTMLElement; titleBar: HTMLElement } {
    const {id, title, resizable = false, component} = config;

    // Get initial dimensions for this component type
    const dimensions = config.shadowNodeDimensions || getDefaultDimensions(component);

    // Create main window container
    const windowElement = document.createElement('div');
    windowElement.id = `window-${id}`;
    windowElement.className = 'cy-floating-window';
    windowElement.setAttribute('data-shadow-node-relativeFilePathIsID', id);

    // Set initial dimensions
    windowElement.style.width = `${dimensions.width}px`;
    windowElement.style.height = `${dimensions.height}px`;

    if (resizable) {
        windowElement.classList.add('resizable');
    }

    // Event isolation - prevent graph interactions
    windowElement.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });
    windowElement.addEventListener('wheel', (e) => {
        e.stopPropagation();
    }, {passive: false});

    // Create title bar
    const titleBar = document.createElement('div');
    titleBar.className = 'cy-floating-window-title';

    // Create title text
    const titleText = document.createElement('span');
    titleText.className = 'cy-floating-window-title-text';
    titleText.textContent = title || `Window: ${id}`;

    // Create fullscreen button for all components
    const fullscreenButton = document.createElement('button');
    fullscreenButton.className = 'cy-floating-window-fullscreen';
    fullscreenButton.textContent = '⛶';
    fullscreenButton.title = 'Toggle Fullscreen';

    // Attach fullscreen handler
    fullscreenButton.addEventListener('click', () => {
        const vanillaInstance = vanillaInstances.get(id);
        if (vanillaInstance && 'toggleFullscreen' in vanillaInstance) {
            (vanillaInstance as { toggleFullscreen: () => Promise<void> }).toggleFullscreen();
        }
    });

    // Create close button
    const closeButton = document.createElement('button');
    closeButton.className = 'cy-floating-window-close';
    closeButton.textContent = '×';

    // Attach close handler
    closeButton.addEventListener('click', () => {
        // Call cleanup callback if provided
        if (config.onClose) {
            config.onClose();
        }
        // Find and remove shadow node
        const shadowNode = cy.$(`#${id}`);
        if (shadowNode.length > 0) {
            shadowNode.remove();
        }
        // Dispose vanilla JS instances
        const vanillaInstance = vanillaInstances.get(id);
        if (vanillaInstance) {
            vanillaInstance.dispose();
            vanillaInstances.delete(id);
        }
        windowElement.remove();
    });

    // Assemble title bar
    titleBar.appendChild(titleText);
    titleBar.appendChild(fullscreenButton);
    titleBar.appendChild(closeButton);

    // Create content container
    const contentContainer = document.createElement('div');
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
) {
    let isDragging = false;
    let dragOffset = {x: 0, y: 0};

    const handleMouseDown = (e: MouseEvent) => {
        // Don't start drag if clicking on buttons
        if ((e.target as HTMLElement).tagName === 'BUTTON') return;

        isDragging = true;
        titleBar.classList.add('dragging');

        const pan = cy.pan();
        const zoom = cy.zoom();

        // Get current position in graph coordinates from style
        const currentLeft = parseFloat(windowElement.style.left) || 0;
        const currentTop = parseFloat(windowElement.style.top) || 0;

        // Convert current graph position to viewport coordinates
        const viewportX = (currentLeft * zoom) + pan.x;
        const viewportY = (currentTop * zoom) + pan.y;

        // Store offset in viewport coordinates
        dragOffset = {
            x: e.clientX - viewportX,
            y: e.clientY - viewportY
        };

        e.preventDefault();
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (!isDragging) return;

        const pan = cy.pan();
        const zoom = cy.zoom();

        // Calculate new viewport position
        const viewportX = e.clientX - dragOffset.x;
        const viewportY = e.clientY - dragOffset.y;

        // Convert viewport coordinates to graph coordinates
        const graphX = (viewportX - pan.x) / zoom;
        const graphY = (viewportY - pan.y) / zoom;

        windowElement.style.left = `${graphX}px`;
        windowElement.style.top = `${graphY}px`;

        // Update shadow node position so edge follows
        const shadowNodeId = windowElement.getAttribute('data-shadow-node-relativeFilePathIsID');
        if (shadowNodeId) {
            const shadowNode = cy.$(`#${shadowNodeId}`);
            if (shadowNode.length > 0) {
                shadowNode.position({x: graphX, y: graphY});
            }
        }
    };

    const handleMouseUp = () => {
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
function getDefaultDimensions(component: string): { width: number; height: number } {
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
        case 'TestComponent':
            // Test component - small size for e2e-tests
            return {width: 200, height: 150};
        default:
            // Default for unknown components
            return {width: 200, height: 150};
    }
}

/**
 * Create a floating editor window
 * Returns FloatingWindow object that can be anchored or positioned manually
 * Returns undefined if an editor for this node already exists
 *
 * @param cy - Cytoscape instance
 * @param nodeId - ID of the node to edit (used to fetch content and derive editor ID)
 * @param editorRegistry - Map to register editor ID for external content updates
 */
export async function createFloatingEditor(
    cy: cytoscape.Core,
    nodeId: string,
    editorRegistry: Map<string, string>
): Promise<FloatingWindow | undefined> {
    // Derive editor ID from node ID
    const id = `editor-${nodeId}`;

    // Check if already exists
    const existing = cy.nodes(`#${id}`);
    if (existing && existing.length > 0) {
        console.log('[createAnchoredFloatingEditor] Editor already exists:', id);
        return undefined;
    }

    // Register in editor registry if provided
    editorRegistry.set(nodeId, id);

    // Always resizable
    const resizable = true;

    // Derive title and content from nodeId
    const node = await getNodeFromUI(nodeId);
    let content = "loading..."
    if (node){
        content = node.content;
    }
    const title = `Editor: ${nodeId}`;

    // Get overlay
    const overlay = getOrCreateOverlay(cy);

    // Create window chrome (don't pass onClose, we'll handle it in the cleanup wrapper)
    const {windowElement, contentContainer, titleBar} = createWindowChrome(cy, {
        id,
        title,
        component: 'MarkdownEditor',
        resizable,
        initialContent: content
    });

    // Create CodeMirror editor instance
    const editor = new CodeMirrorEditorView(
        contentContainer,
        content,
        {
            autosaveDelay: 300
        }
    );

    // Setup auto-save with modifyNodeContentFromUI
    editor.onChange(async (newContent) => {
        console.log('[createAnchoredFloatingEditor] Saving editor content for node:', nodeId);
        await modifyNodeContentFromUI(nodeId, newContent, cy);
    });

    // Store for cleanup
    vanillaInstances.set(id, editor);

    // Create cleanup wrapper that handles registry and shadow node cleanup
    const floatingWindow: FloatingWindow = {
        id,
        cy,
        windowElement,
        contentContainer,
        titleBar,
        cleanup: () => {
            const vanillaInstance = vanillaInstances.get(id);
            if (vanillaInstance) {
                vanillaInstance.dispose();
                vanillaInstances.delete(id);
            }
            windowElement.remove();
            // Clean up mapping when editor is closed
            editorRegistry.delete(nodeId);
            // TODO Remove child shadow node (but we need to pass it through, or have it in the map)
            // if (childShadowNode && childShadowNode.inside()) {
            //     childShadowNode.remove();
            // }
        }
    };

    // Update close button to call floatingWindow.cleanup (so anchorToNode can wrap it)
    const closeButton = titleBar.querySelector('.cy-floating-window-close') as HTMLElement;
    if (closeButton) {
        // Remove old handler and add new one
        const newCloseButton = closeButton.cloneNode(true) as HTMLElement;
        closeButton.parentNode?.replaceChild(newCloseButton, closeButton);
        newCloseButton.addEventListener('click', () => floatingWindow.cleanup());
    }

    // Add to overlay
    overlay.appendChild(windowElement);

    return floatingWindow;
}

/**
 * Create a floating terminal window (no anchoring)
 * Returns FloatingWindow object that can be anchored or positioned manually
 */
export function createFloatingTerminal(
    cy: cytoscape.Core,
    config: {
        id: string;
        title: string;
        nodeMetadata: NodeMetadata;
        onClose?: () => void;
        resizable?: boolean;
    }
): FloatingWindow {
    const {id, title, nodeMetadata, onClose, resizable = true} = config;

    // Get overlay
    const overlay = getOrCreateOverlay(cy);

    // Create window chrome (don't pass onClose, we'll handle it in the cleanup wrapper)
    const {windowElement, contentContainer, titleBar} = createWindowChrome(cy, {
        id,
        title,
        component: 'Terminal',
        resizable,
        nodeMetadata
    });

    // Create Terminal instance
    const terminal = new TerminalVanilla({
        container: contentContainer,
        nodeMetadata
    });

    // Store for cleanup
    vanillaInstances.set(id, terminal);

    // Create cleanup wrapper that can be extended by anchorToNode
    const floatingWindow: FloatingWindow = {
        id,
        cy,
        windowElement,
        contentContainer,
        titleBar,
        cleanup: () => {
            const vanillaInstance = vanillaInstances.get(id);
            if (vanillaInstance) {
                vanillaInstance.dispose();
                vanillaInstances.delete(id);
            }
            windowElement.remove();
            if (onClose) {
                onClose();
            }
        }
    };

    // Update close button to call floatingWindow.cleanup (so anchorToNode can wrap it)
    const closeButton = titleBar.querySelector('.cy-floating-window-close') as HTMLElement;
    if (closeButton) {
        // Remove old handler and add new one
        const newCloseButton = closeButton.cloneNode(true) as HTMLElement;
        closeButton.parentNode?.replaceChild(newCloseButton, closeButton);
        newCloseButton.addEventListener('click', () => floatingWindow.cleanup());
    }

    // Set initial position to offscreen to avoid flash at 0,0
    // windowElement.style.left = '-9999px';
    // windowElement.style.top = '-9999px';

    // Add to overlay
    overlay.appendChild(windowElement);

    return floatingWindow;
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
    floatingWindow: FloatingWindow,
    parentNodeId: NodeId,
    shadowNodeData?: Record<string, unknown>
): cytoscape.NodeSingular {
    const {cy, windowElement, titleBar} = floatingWindow;

    console.log('[anchorToNode] Called with parentNodeId:', parentNodeId, 'type:', typeof parentNodeId);

    const parentNode = cy.getElementById(parentNodeId);
    console.log('[anchorToNode] Parent node found:', parentNode.length > 0, 'length:', parentNode.length);

    // Validate parent node exists
    if (parentNode.length === 0) {
        console.error('[anchorToNode] Parent node not found in graph:', parentNodeId);
        throw new Error(`Parent node "${parentNodeId}" not found in graph. Cannot anchor floating window.`);
    }

    // 1. Create child shadow node ID based on parent node
    const childShadowId = `shadow-child-${parentNodeId}`;

    // 2. Position child shadow node offset from parent (+50, +50)
    const parentPos = parentNode.position();
    console.log('[anchorToNode] Parent position:', parentPos);
    const childPosition = {
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

    const shadowNode = cy.add({
        group: 'nodes',
        data: nodeData,
        position: childPosition
    });

    // Update window element's data attribute to point to shadow node
    windowElement.setAttribute('data-shadow-node-relativeFilePathIsID', childShadowId);

    // 2. Get initial dimensions from rendered window
    const dimensions = {
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
        const resizeObserver = new ResizeObserver(() => {
            updateShadowNodeDimensions(shadowNode, windowElement);
            cy.trigger('floatingwindow:resize', [{nodeId: shadowNode.id()}]);
        });
        resizeObserver.observe(windowElement);
    }

    // 6. Set up position sync (shadow position → window position)
    const syncPosition = () => {
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
    const originalCleanup = floatingWindow.cleanup;
    floatingWindow.cleanup = () => {
        if (shadowNode.inside()) {
            shadowNode.remove();
        }
        originalCleanup();
    };

    return shadowNode;
}