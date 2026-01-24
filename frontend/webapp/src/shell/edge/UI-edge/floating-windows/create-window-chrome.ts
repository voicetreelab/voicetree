import type cytoscape from "cytoscape";
import type {
    EditorId,
    FloatingWindowData,
    FloatingWindowFields,
    FloatingWindowUIData,
    ImageViewerId,
    TerminalId
} from "@/shell/edge/UI-edge/floating-windows/types";
import {isTerminalData, isEditorData} from "@/shell/edge/UI-edge/floating-windows/types";
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import type {EditorData} from "@/shell/edge/UI-edge/floating-windows/editors/editorDataType";
import type {Core} from 'cytoscape';
import {getScalingStrategy, getScreenDimensions, type ScalingStrategy} from "@/pure/floatingWindowScaling";
import {selectFloatingWindowNode} from "@/shell/edge/UI-edge/floating-windows/select-floating-window-node";
import {getCachedZoom, getOrCreateOverlay} from "@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows";
import * as O from 'fp-ts/lib/Option.js';
import {
    getNodeMenuItems,
    createHorizontalMenuElement,
    type NodeMenuItemsInput,
    type HorizontalMenuItem
} from "@/shell/UI/cytoscape-graph-ui/services/HorizontalMenuService";
import type {AgentConfig} from "@/pure/settings";
import {Maximize2, Minimize2, createElement} from 'lucide';
import {createTrafficLightsForTarget} from "@/shell/edge/UI-edge/floating-windows/traffic-lights";

/** Options for createWindowChrome */
export interface CreateWindowChromeOptions {
    /** Agents list for horizontal menu (editors only) */
    readonly agents?: readonly AgentConfig[];
    /** Current context retrieval distance for slider (editors only) */
    readonly currentDistance?: number;
    /** Close callback for terminals (required when fw is TerminalData) */
    readonly closeTerminal?: (terminal: TerminalData, cy: Core) => Promise<void>;
    /** Close callback for editors (required when fw is EditorData) */
    readonly closeEditor?: (cy: Core, editor: EditorData) => void;
}

/**
 * Create the window chrome (frame) with vanilla DOM
 * Returns DOM refs that will populate the `ui` field on FloatingWindowData
 *
 * Phase 1 refactor: No title bar. Traffic lights will be moved to horizontal menu in Phase 2A/3.
 *
 * NO stored callbacks - use disposeFloatingWindow() for cleanup
 */
export function createWindowChrome(
    cy: cytoscape.Core,
    fw: FloatingWindowData | FloatingWindowFields,
    id: EditorId | TerminalId | ImageViewerId,
    options: CreateWindowChromeOptions = {}
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
    const screenDimensions: {
        readonly width: number;
        readonly height: number
    } = getScreenDimensions(dimensions, currentZoom, strategy);

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
    }, {passive: false});

    // Create content container
    const contentContainer: HTMLDivElement = document.createElement('div');
    contentContainer.className = 'cy-floating-window-content';

    // Create horizontal menu for anchored editors only
    // Hover editors use HorizontalMenuService's hover menu instead (shows node in gap between pills)
    const isEditor: boolean = 'type' in fw && fw.type === 'Editor';
    const hasAnchoredNode: boolean = O.isSome(fw.anchoredToNodeId);
    const hasAgents: boolean = options.agents !== undefined && options.agents.length > 0;

    if (isEditor && hasAnchoredNode && hasAgents) {
        const nodeId: string = 'contentLinkedToNodeId' in fw ? fw.contentLinkedToNodeId : '';
        // Check if node is a context node (has .context_node. in path)
        const isContextNode: boolean = nodeId.includes('.context_node.');

        // Get overlay for floating slider
        const overlay: HTMLElement = getOrCreateOverlay(cy);

        // Create menu wrapper first so it can be passed as menuAnchor for floating slider positioning
        const menuWrapper: HTMLDivElement = document.createElement('div');
        menuWrapper.className = 'cy-floating-window-horizontal-menu';

        // Get menu items with menuAnchor and overlay for floating slider
        const menuInput: NodeMenuItemsInput = {
            nodeId,
            cy,
            agents: options.agents ?? [],
            isContextNode,
            currentDistance: options.currentDistance,
            menuAnchor: menuWrapper,
            overlay,
        };
        const menuItems: HorizontalMenuItem[] = getNodeMenuItems(menuInput);

        // Type-narrow fw to EditorData for traffic lights
        const editorData: EditorData | undefined = 'type' in fw && isEditorData(fw) ? fw : undefined;
        if (!editorData) {
            throw new Error('Expected EditorData for editor-window traffic lights');
        }
        const trafficLights: HTMLDivElement = createTrafficLightsForTarget({
            kind: 'editor-window',
            editor: editorData,
            cy,
            closeEditor: options.closeEditor ?? ((): void => {
                windowElement.dispatchEvent(new CustomEvent('traffic-light-close', { bubbles: true }));
            }),
        });

        // Create menu elements (leftGroup, spacer, and rightGroup pills)
        // The spacer creates a centered gap where the node circle appears visually
        const { leftGroup, spacer, rightGroup } = createHorizontalMenuElement(
            menuItems,
            () => {}, // No-op onClose - menu is persistent
            trafficLights
        );
        // TODO: Tech debt - spacer width should be configurable via createHorizontalMenuElement options
        // Anchored editors don't have a node circle in the gap, so use smaller spacer
        spacer.style.width = '10px';

        // Assemble menu wrapper
        menuWrapper.appendChild(leftGroup);
        menuWrapper.appendChild(spacer);
        menuWrapper.appendChild(rightGroup);

        // Add menu to window element (before content container)
        windowElement.appendChild(menuWrapper);
    }

    // Phase 4: Terminal-specific chrome - minimal title bar with traffic lights at far right
    if (isTerminal && 'type' in fw && isTerminalData(fw)) {
        const terminalTitleBar: HTMLDivElement = createTerminalTitleBar(windowElement, cy, fw, options.closeTerminal);
        windowElement.appendChild(terminalTitleBar);
    }

    // Assemble window - content container only (no title bar in Phase 1)
    windowElement.appendChild(contentContainer);

    // Create bottom-right expand button (Phase 2B)
    const expandButton: HTMLButtonElement = createExpandButton(windowElement, dimensions);
    windowElement.appendChild(expandButton);

    // Create resize zones for edges and corners (Phase 2C)
    if (fw.resizable) {
        addResizeZones(windowElement);
    }

    return {windowElement, contentContainer};
}

/**
 * Create the bottom-right expand/minimize button
 * Toggles between 2x and 0.5x of current dimensions
 */
function createExpandButton(
    windowElement: HTMLDivElement,
    _baseDimensions: { width: number; height: number }
): HTMLButtonElement {
    const button: HTMLButtonElement = document.createElement('button');
    button.className = 'cy-floating-window-expand-corner';
    button.dataset.icon = 'maximize';
    button.dataset.expanded = 'false';

    // Position in bottom-left corner, flush with edge
    button.style.position = 'absolute';
    button.style.bottom = '0';
    button.style.left = '0';

    // Create and append initial icon (Maximize2)
    const initialIcon: SVGElement = createElement(Maximize2);
    initialIcon.setAttribute('width', '16');
    initialIcon.setAttribute('height', '16');
    button.appendChild(initialIcon);

    // Click handler for expand/minimize toggle
    button.addEventListener('click', (e: MouseEvent): void => {
        e.stopPropagation();

        const isExpanded: boolean = windowElement.dataset.expanded === 'true';
        // Get current actual dimensions (accounts for zoom scaling, user resizes, etc.)
        // Fall back to parsing style.width/height for JSDOM tests where offsetWidth returns 0
        const currentWidth: number = windowElement.offsetWidth || parseInt(windowElement.style.width, 10) || 0;
        const currentHeight: number = windowElement.offsetHeight || parseInt(windowElement.style.height, 10) || 0;

        if (isExpanded) {
            // Minimize: shrink current dimensions by half (0.5x)
            windowElement.style.width = `${currentWidth / 2}px`;
            windowElement.style.height = `${currentHeight / 2}px`;
            windowElement.dataset.expanded = 'false';
            button.dataset.expanded = 'false';
            button.dataset.icon = 'maximize';

            // Swap icon to Maximize2
            button.innerHTML = '';
            const maximizeIcon: SVGElement = createElement(Maximize2);
            maximizeIcon.setAttribute('width', '16');
            maximizeIcon.setAttribute('height', '16');
            button.appendChild(maximizeIcon);
        } else {
            // Expand: grow current dimensions by 2x
            windowElement.style.width = `${currentWidth * 2}px`;
            windowElement.style.height = `${currentHeight * 2}px`;
            windowElement.dataset.expanded = 'true';
            button.dataset.expanded = 'true';
            button.dataset.icon = 'minimize';

            // Swap icon to Minimize2
            button.innerHTML = '';
            const minimizeIcon: SVGElement = createElement(Minimize2);
            minimizeIcon.setAttribute('width', '16');
            minimizeIcon.setAttribute('height', '16');
            button.appendChild(minimizeIcon);
        }
    });

    return button;
}

/** Resize zone size in pixels (4-6px as per spec) */
const RESIZE_ZONE_SIZE: number = 5;

/** Minimum window dimensions during resize */
const MIN_WIDTH: number = 300;
const MIN_HEIGHT: number = 200;

/**
 * Add invisible resize zones to all 4 edges and 4 corners of a window (Phase 2C)
 * Each zone has appropriate cursor styling and mousedown handlers for resizing
 */
function addResizeZones(windowElement: HTMLDivElement): void {
    // Edge zones
    const topZone: HTMLDivElement = createEdgeResizeZone('top', 'ns-resize');
    const bottomZone: HTMLDivElement = createEdgeResizeZone('bottom', 'ns-resize');
    const leftZone: HTMLDivElement = createEdgeResizeZone('left', 'ew-resize');
    const rightZone: HTMLDivElement = createEdgeResizeZone('right', 'ew-resize');

    // Corner zones
    const nwCorner: HTMLDivElement = createCornerResizeZone('nw', 'nwse-resize');
    const neCorner: HTMLDivElement = createCornerResizeZone('ne', 'nesw-resize');
    const swCorner: HTMLDivElement = createCornerResizeZone('sw', 'nesw-resize');
    const seCorner: HTMLDivElement = createCornerResizeZone('se', 'nwse-resize');

    // Add resize handlers
    setupEdgeResizeHandler(topZone, windowElement, 'top');
    setupEdgeResizeHandler(bottomZone, windowElement, 'bottom');
    setupEdgeResizeHandler(leftZone, windowElement, 'left');
    setupEdgeResizeHandler(rightZone, windowElement, 'right');

    setupCornerResizeHandler(nwCorner, windowElement, 'nw');
    setupCornerResizeHandler(neCorner, windowElement, 'ne');
    setupCornerResizeHandler(swCorner, windowElement, 'sw');
    setupCornerResizeHandler(seCorner, windowElement, 'se');

    // Append all zones to window
    windowElement.appendChild(topZone);
    windowElement.appendChild(bottomZone);
    windowElement.appendChild(leftZone);
    windowElement.appendChild(rightZone);
    windowElement.appendChild(nwCorner);
    windowElement.appendChild(neCorner);
    windowElement.appendChild(swCorner);
    windowElement.appendChild(seCorner);
}

/**
 * Create an edge resize zone with proper positioning and cursor
 */
function createEdgeResizeZone(
    edge: 'top' | 'bottom' | 'left' | 'right',
    cursor: 'ns-resize' | 'ew-resize'
): HTMLDivElement {
    const zone: HTMLDivElement = document.createElement('div');
    zone.className = `resize-zone-${edge}`;
    zone.style.position = 'absolute';
    zone.style.cursor = cursor;

    // Position based on edge
    if (edge === 'top') {
        zone.style.top = '0px';
        zone.style.left = '0px';
        zone.style.right = '0px';
        zone.style.height = `${RESIZE_ZONE_SIZE}px`;
    } else if (edge === 'bottom') {
        zone.style.bottom = '0px';
        zone.style.left = '0px';
        zone.style.right = '0px';
        zone.style.height = `${RESIZE_ZONE_SIZE}px`;
    } else if (edge === 'left') {
        zone.style.left = '0px';
        zone.style.top = '0px';
        zone.style.bottom = '0px';
        zone.style.width = `${RESIZE_ZONE_SIZE}px`;
    } else {
        // right
        zone.style.right = '0px';
        zone.style.top = '0px';
        zone.style.bottom = '0px';
        zone.style.width = `${RESIZE_ZONE_SIZE}px`;
    }

    return zone;
}

/**
 * Create a corner resize zone with proper positioning and cursor
 */
function createCornerResizeZone(
    corner: 'nw' | 'ne' | 'sw' | 'se',
    cursor: 'nwse-resize' | 'nesw-resize'
): HTMLDivElement {
    const zone: HTMLDivElement = document.createElement('div');
    zone.className = `resize-zone-corner-${corner}`;
    zone.style.position = 'absolute';
    zone.style.cursor = cursor;
    zone.style.width = `${RESIZE_ZONE_SIZE * 2}px`;
    zone.style.height = `${RESIZE_ZONE_SIZE * 2}px`;
    zone.style.zIndex = '1'; // Above edge zones

    // Position based on corner
    if (corner === 'nw') {
        zone.style.top = '0px';
        zone.style.left = '0px';
    } else if (corner === 'ne') {
        zone.style.top = '0px';
        zone.style.right = '0px';
    } else if (corner === 'sw') {
        zone.style.bottom = '0px';
        zone.style.left = '0px';
    } else {
        // se
        zone.style.bottom = '0px';
        zone.style.right = '0px';
    }

    return zone;
}

/**
 * Setup mousedown handler for edge resize
 */
function setupEdgeResizeHandler(
    zone: HTMLDivElement,
    windowElement: HTMLDivElement,
    edge: 'top' | 'bottom' | 'left' | 'right'
): void {
    zone.addEventListener('mousedown', (e: MouseEvent): void => {
        e.preventDefault();
        e.stopPropagation();

        const startX: number = e.clientX;
        const startY: number = e.clientY;
        const startWidth: number = windowElement.offsetWidth;
        const startHeight: number = windowElement.offsetHeight;
        const startLeft: number = windowElement.offsetLeft;
        const startTop: number = windowElement.offsetTop;

        const onMouseMove: (moveEvent: MouseEvent) => void = (moveEvent: MouseEvent): void => {
            const deltaX: number = moveEvent.clientX - startX;
            const deltaY: number = moveEvent.clientY - startY;

            if (edge === 'right') {
                const newWidth: number = Math.max(MIN_WIDTH, startWidth + deltaX);
                windowElement.style.width = `${newWidth}px`;
            } else if (edge === 'left') {
                const newWidth: number = Math.max(MIN_WIDTH, startWidth - deltaX);
                if (newWidth > MIN_WIDTH || deltaX < 0) {
                    windowElement.style.width = `${newWidth}px`;
                    windowElement.style.left = `${startLeft + (startWidth - newWidth)}px`;
                }
            } else if (edge === 'bottom') {
                const newHeight: number = Math.max(MIN_HEIGHT, startHeight + deltaY);
                windowElement.style.height = `${newHeight}px`;
            } else if (edge === 'top') {
                const newHeight: number = Math.max(MIN_HEIGHT, startHeight - deltaY);
                if (newHeight > MIN_HEIGHT || deltaY < 0) {
                    windowElement.style.height = `${newHeight}px`;
                    windowElement.style.top = `${startTop + (startHeight - newHeight)}px`;
                }
            }
        };

        const onMouseUp: () => void = (): void => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

/**
 * Setup mousedown handler for corner resize (both dimensions)
 */
function setupCornerResizeHandler(
    zone: HTMLDivElement,
    windowElement: HTMLDivElement,
    corner: 'nw' | 'ne' | 'sw' | 'se'
): void {
    zone.addEventListener('mousedown', (e: MouseEvent): void => {
        e.preventDefault();
        e.stopPropagation();

        const startX: number = e.clientX;
        const startY: number = e.clientY;
        const startWidth: number = windowElement.offsetWidth;
        const startHeight: number = windowElement.offsetHeight;
        const startLeft: number = windowElement.offsetLeft;
        const startTop: number = windowElement.offsetTop;

        const onMouseMove: (moveEvent: MouseEvent) => void = (moveEvent: MouseEvent): void => {
            const deltaX: number = moveEvent.clientX - startX;
            const deltaY: number = moveEvent.clientY - startY;

            // Handle width based on corner
            if (corner === 'ne' || corner === 'se') {
                const newWidth: number = Math.max(MIN_WIDTH, startWidth + deltaX);
                windowElement.style.width = `${newWidth}px`;
            } else {
                // nw or sw - resize from left edge
                const newWidth: number = Math.max(MIN_WIDTH, startWidth - deltaX);
                if (newWidth > MIN_WIDTH || deltaX < 0) {
                    windowElement.style.width = `${newWidth}px`;
                    windowElement.style.left = `${startLeft + (startWidth - newWidth)}px`;
                }
            }

            // Handle height based on corner
            if (corner === 'sw' || corner === 'se') {
                const newHeight: number = Math.max(MIN_HEIGHT, startHeight + deltaY);
                windowElement.style.height = `${newHeight}px`;
            } else {
                // nw or ne - resize from top edge
                const newHeight: number = Math.max(MIN_HEIGHT, startHeight - deltaY);
                if (newHeight > MIN_HEIGHT || deltaY < 0) {
                    windowElement.style.height = `${newHeight}px`;
                    windowElement.style.top = `${startTop + (startHeight - newHeight)}px`;
                }
            }
        };

        const onMouseUp: () => void = (): void => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

/**
 * Check if a node ID represents a context node
 * Context nodes have 'ctx-nodes/' prefix or '_context_' in their path
 */
function isContextNodeId(nodeId: string): boolean {
    return nodeId.startsWith('ctx-nodes/') || nodeId.includes('_context_');
}

/**
 * Truncate title to max length, adding ellipsis if needed
 */
function truncateTitle(title: string, maxLength: number): string {
    if (title.length <= maxLength) {
        return title;
    }
    return title.slice(0, maxLength) + '...';
}

/**
 * Create terminal-specific title bar with traffic lights at far right
 * Phase 4: Terminals have minimal chrome - just traffic lights, no horizontal menu
 *
 * @param windowElement - The window element to attach events to
 * @param cy - Cytoscape instance
 * @param terminal - Terminal data
 * @param closeTerminal - Optional close callback (falls back to event dispatch)
 */
function createTerminalTitleBar(
    windowElement: HTMLDivElement,
    cy: cytoscape.Core,
    terminal: TerminalData,
    closeTerminal?: (terminal: TerminalData, cy: Core) => Promise<void>
): HTMLDivElement {
    const titleBar: HTMLDivElement = document.createElement('div');
    titleBar.className = 'terminal-title-bar';

    // Get the attached node ID for context detection
    const attachedNodeId: string = terminal.attachedToNodeId;
    const hasContextNode: boolean = isContextNodeId(attachedNodeId);

    // Create context badge for terminals with context nodes
    if (hasContextNode) {
        const contextBadge: HTMLDivElement = createContextBadge(terminal.title, windowElement);
        titleBar.appendChild(contextBadge);
    }

    const trafficLights: HTMLDivElement = createTrafficLightsForTarget({
        kind: 'terminal-window',
        terminal,
        cy,
        closeTerminal: closeTerminal ?? (async (): Promise<void> => {
            windowElement.dispatchEvent(new CustomEvent('traffic-light-close', { bubbles: true }));
        }),
    });
    trafficLights.classList.add('terminal-traffic-lights');
    trafficLights.style.position = 'absolute';
    trafficLights.style.right = '10px';
    trafficLights.style.top = '50%';
    trafficLights.style.transform = 'translateY(-50%)';

    titleBar.appendChild(trafficLights);

    return titleBar;
}

/**
 * Create context badge for terminals with context nodes
 * Shows truncated title
 */
function createContextBadge(title: string, _windowElement: HTMLDivElement): HTMLDivElement {
    const badge: HTMLDivElement = document.createElement('div');
    badge.className = 'terminal-context-badge';

    // Truncated title (max 100 chars)
    const titleSpan: HTMLSpanElement = document.createElement('span');
    titleSpan.className = 'terminal-context-badge-title';
    titleSpan.textContent = truncateTitle(title, 100);
    badge.appendChild(titleSpan);

    return badge;
}
