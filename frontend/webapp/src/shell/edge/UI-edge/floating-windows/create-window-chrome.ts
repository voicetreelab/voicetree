import type cytoscape from "cytoscape";
import type {
    EditorId,
    FloatingWindowData,
    FloatingWindowFields,
    FloatingWindowUIData,
    TerminalId
} from "@/shell/edge/UI-edge/floating-windows/types";
import {getScalingStrategy, getScreenDimensions, type ScalingStrategy} from "@/pure/floatingWindowScaling";
import {selectFloatingWindowNode} from "@/shell/edge/UI-edge/floating-windows/select-floating-window-node";
import {getCachedZoom, captureTerminalScrollPositions} from "@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows";
import {updateWindowFromZoom} from "@/shell/edge/UI-edge/floating-windows/update-window-from-zoom";
import {triggerLayout} from "@/shell/UI/cytoscape-graph-ui/graphviz/layout/autoLayout";
import * as O from 'fp-ts/lib/Option.js';
import {
    getNodeMenuItems,
    createHorizontalMenuElement,
    type NodeMenuItemsInput,
    type HorizontalMenuItem
} from "@/shell/UI/cytoscape-graph-ui/services/HorizontalMenuService";
import type {AgentConfig} from "@/pure/settings";
import {Maximize2, Minimize2, Pin, PinOff, X, Maximize, createElement, type IconNode} from 'lucide';
import {removeFromAutoPinQueue, addToAutoPinQueue, isPinned, addToPinnedEditors, removeFromPinnedEditors} from "@/shell/edge/UI-edge/state/EditorStore";
import {createAnchoredFloatingEditor, closeHoverEditor} from "@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD";

/**
 * Create an SVG element from a Lucide icon definition.
 */
function createLucideIcon(icon: IconNode, size: number = 8): SVGElement {
    const svg: SVGElement = createElement(icon);
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    return svg;
}

/** Options for createWindowChrome */
export interface CreateWindowChromeOptions {
    /** Agents list for horizontal menu (editors only) */
    readonly agents?: readonly AgentConfig[];
}

/**
 * Create the window chrome (frame) with vanilla DOM
 * Returns DOM refs that will populate the `ui` field on FloatingWindowData
 *
 * NO stored callbacks - use disposeFloatingWindow() for cleanup
 */
export function createWindowChrome(
    cy: cytoscape.Core,
    fw: FloatingWindowData | FloatingWindowFields,
    id: EditorId | TerminalId,
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

    // Create title bar
    const titleBar: HTMLDivElement = document.createElement('div');
    titleBar.className = 'cy-floating-window-title';

    const titleText: HTMLSpanElement = document.createElement('span');
    titleText.className = 'cy-floating-window-title-text';
    titleText.textContent = fw.title || `Window: ${id}`;

    // Create macOS-style traffic light button container (left side)
    const buttonContainer: HTMLDivElement = document.createElement('div');
    buttonContainer.className = 'cy-floating-window-buttons macos-traffic-lights';

    // Create close button (red) - leftmost in macOS style
    const closeButton: HTMLButtonElement = document.createElement('button');
    closeButton.className = 'cy-floating-window-btn cy-floating-window-close';
    closeButton.title = 'Close';
    closeButton.appendChild(createLucideIcon(X));
    // Note: close handler attached via disposeFloatingWindow pattern

    // Create expand button (yellow) - middle in macOS style
    const expandButton: HTMLButtonElement = document.createElement('button');
    expandButton.className = 'cy-floating-window-btn cy-floating-window-expand';
    expandButton.title = 'Expand window';
    expandButton.appendChild(createLucideIcon(Maximize2));
    expandButton.addEventListener('click', () => {
        // Capture terminal scroll positions BEFORE dimension changes to avoid race with auto-scroll
        captureTerminalScrollPositions();

        const isExpanded: boolean = windowElement.dataset.expanded === 'true';
        const currentBaseWidth: number = parseFloat(windowElement.dataset.baseWidth ?? '400');
        const currentBaseHeight: number = parseFloat(windowElement.dataset.baseHeight ?? '400');

        const scaleFactor: number = isExpanded ? 0.5 : 2;

        // Update base dimensions
        windowElement.dataset.baseWidth = String(currentBaseWidth * scaleFactor);
        windowElement.dataset.baseHeight = String(currentBaseHeight * scaleFactor);
        windowElement.dataset.expanded = isExpanded ? 'false' : 'true';
        expandButton.title = isExpanded ? 'Expand window' : 'Shrink window';

        // Update icon based on expanded state
        expandButton.innerHTML = '';
        expandButton.appendChild(createLucideIcon(isExpanded ? Maximize2 : Minimize2));

        // For editors (non-terminals), also scale current height immediately
        // since auto-height manages editor height (not updateWindowFromZoom)
        if (!isTerminal) {
            const currentDomHeight: number = parseFloat(windowElement.style.height) || currentBaseHeight;
            windowElement.style.height = `${currentDomHeight * scaleFactor}px`;
        }

        // Trigger dimension update (handles width for all, height for terminals only)
        updateWindowFromZoom(cy, windowElement, getCachedZoom());
        // Trigger layout since user explicitly resized
        triggerLayout(cy);
    });

    // Create fullscreen button (green) - rightmost in macOS style
    const fullscreenButton: HTMLButtonElement = document.createElement('button');
    fullscreenButton.className = 'cy-floating-window-btn cy-floating-window-fullscreen';
    fullscreenButton.title = 'Toggle Fullscreen';
    fullscreenButton.appendChild(createLucideIcon(Maximize));
    // Note: fullscreen handler will be attached by the caller (FloatingEditorManager/spawnTerminal)

    // Create pin button (4th button)
    const pinButton: HTMLButtonElement = document.createElement('button');
    pinButton.className = 'cy-floating-window-btn cy-floating-window-pin';

    // Get initial pin state
    const hasAnchoredNode: boolean = O.isSome(fw.anchoredToNodeId);
    const anchoredNodeId: string = hasAnchoredNode ? fw.anchoredToNodeId.value : '';
    const contentNodeId: string = 'contentLinkedToNodeId' in fw ? fw.contentLinkedToNodeId : '';
    const pinNodeId: string = anchoredNodeId || contentNodeId;
    const isCurrentlyPinned: boolean = pinNodeId ? isPinned(pinNodeId) : false;
    pinButton.appendChild(createLucideIcon(isCurrentlyPinned ? PinOff : Pin));
    pinButton.title = isCurrentlyPinned ? 'Unpin (allow auto-close)' : 'Pin Editor';

    pinButton.addEventListener('click', async () => {
        const nodeId: string = anchoredNodeId || contentNodeId;

        if (isPinned(nodeId)) {
            // Unpin: remove from pinnedEditors, add to auto-close queue
            removeFromPinnedEditors(nodeId);
            addToAutoPinQueue(nodeId);
            pinButton.innerHTML = '';
            pinButton.appendChild(createLucideIcon(Pin));
            pinButton.title = 'Pin Editor';
        } else {
            // Pin: if hover editor, need to close it and create anchored editor
            if (!hasAnchoredNode) {
                // Close hover editor first, then create anchored editor
                // After closing, this DOM element is disposed, so return early
                // The new anchored editor will have its own pin button with correct state
                closeHoverEditor(cy);
                await createAnchoredFloatingEditor(cy, nodeId);
                addToPinnedEditors(nodeId);
                return;
            }
            removeFromAutoPinQueue(nodeId);
            addToPinnedEditors(nodeId);
            pinButton.innerHTML = '';
            pinButton.appendChild(createLucideIcon(PinOff));
            pinButton.title = 'Unpin (allow auto-close)';
        }
    });

    // Assemble buttons in macOS order: close (red), expand (yellow), fullscreen (green), pin
    buttonContainer.appendChild(closeButton);
    buttonContainer.appendChild(expandButton);
    buttonContainer.appendChild(fullscreenButton);
    buttonContainer.appendChild(pinButton);

    // Assemble title bar: buttons first (left), then title text
    // Traffic lights are shown for ALL editors (including hover editors)
    titleBar.appendChild(buttonContainer);
    titleBar.appendChild(titleText);

    // Create content container
    const contentContainer: HTMLDivElement = document.createElement('div');
    contentContainer.className = 'cy-floating-window-content';

    // Create horizontal menu for editors (not terminals) when anchored to a node
    // Menu is embedded IN the title bar for unified draggable chrome
    const isEditor: boolean = 'type' in fw && fw.type === 'Editor';
    const hasAgents: boolean = options.agents !== undefined && options.agents.length > 0;

    if (isEditor && hasAnchoredNode && hasAgents) {
        const nodeId: string = O.isSome(fw.anchoredToNodeId) ? fw.anchoredToNodeId.value : '';
        // Check if node is a context node (has .context_node. in path)
        const isContextNode: boolean = nodeId.includes('.context_node.');

        const menuInput: NodeMenuItemsInput = {
            nodeId,
            cy,
            agents: options.agents ?? [],
            isContextNode,
        };
        const menuItems: HorizontalMenuItem[] = getNodeMenuItems(menuInput);

        // Create menu elements (leftGroup and rightGroup pills)
        const { leftGroup, rightGroup } = createHorizontalMenuElement(
            menuItems,
            () => {} // No-op onClose - menu is persistent
        );

        // Add menu class to title bar for styling
        titleBar.classList.add('cy-floating-window-title-with-menu');

        // Create menu wrapper to group menu pills together
        const menuWrapper: HTMLDivElement = document.createElement('div');
        menuWrapper.className = 'cy-floating-window-title-menu';
        menuWrapper.appendChild(leftGroup);
        menuWrapper.appendChild(rightGroup);

        // Insert menu at start of title bar (before title text)
        titleBar.insertBefore(menuWrapper, titleText);
    }

    // Assemble window
    windowElement.appendChild(titleBar);
    windowElement.appendChild(contentContainer);

    return {windowElement, contentContainer, titleBar};
}