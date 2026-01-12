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
import {getCachedZoom} from "@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows";
import {updateWindowFromZoom} from "@/shell/edge/UI-edge/floating-windows/update-window-from-zoom";
import {triggerLayout} from "@/shell/UI/cytoscape-graph-ui/graphviz/layout/autoLayout";
import {Maximize2, Minimize2, createElement, type IconNode} from 'lucide';
import * as O from 'fp-ts/lib/Option.js';
import {
    getNodeMenuItems,
    createHorizontalMenuElement,
    type NodeMenuItemsInput,
    type HorizontalMenuItem
} from "@/shell/UI/cytoscape-graph-ui/services/HorizontalMenuService";
import type {AgentConfig} from "@/pure/settings";

/** Render a Lucide icon to SVG element */
function createIconElement(icon: IconNode, size: number = 14): SVGElement {
    const svgElement: SVGElement = createElement(icon);
    svgElement.setAttribute('width', String(size));
    svgElement.setAttribute('height', String(size));
    return svgElement;
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

    // Create button container to keep fullscreen and close buttons together
    const buttonContainer: HTMLDivElement = document.createElement('div');
    buttonContainer.className = 'cy-floating-window-buttons';
    buttonContainer.style.display = 'flex';
    buttonContainer.style.alignItems = 'center';
    buttonContainer.style.gap = '4px';

    // Create expand button (doubles/halves window size)
    const expandButton: HTMLButtonElement = document.createElement('button');
    expandButton.className = 'cy-floating-window-expand';
    expandButton.appendChild(createIconElement(Maximize2));
    expandButton.title = 'Expand window';
    expandButton.addEventListener('click', () => {
        const isExpanded: boolean = windowElement.dataset.expanded === 'true';
        const currentBaseWidth: number = parseFloat(windowElement.dataset.baseWidth ?? '400');
        const currentBaseHeight: number = parseFloat(windowElement.dataset.baseHeight ?? '400');

        // Clear existing icon
        expandButton.innerHTML = '';

        const scaleFactor: number = isExpanded ? 0.5 : 2;

        // Update base dimensions
        windowElement.dataset.baseWidth = String(currentBaseWidth * scaleFactor);
        windowElement.dataset.baseHeight = String(currentBaseHeight * scaleFactor);
        windowElement.dataset.expanded = isExpanded ? 'false' : 'true';

        // Update button icon and title
        expandButton.appendChild(createIconElement(isExpanded ? Maximize2 : Minimize2));
        expandButton.title = isExpanded ? 'Expand window' : 'Shrink window';

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

    // Assemble buttons into container
    buttonContainer.appendChild(expandButton);
    buttonContainer.appendChild(fullscreenButton);
    buttonContainer.appendChild(closeButton);

    // Assemble title bar
    titleBar.appendChild(titleText);
    titleBar.appendChild(buttonContainer);

    // Create content container
    const contentContainer: HTMLDivElement = document.createElement('div');
    contentContainer.className = 'cy-floating-window-content';

    // Create horizontal menu for editors (not terminals) when anchored to a node
    const isEditor: boolean = 'type' in fw && fw.type === 'Editor';
    const hasAnchoredNode: boolean = O.isSome(fw.anchoredToNodeId);
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

        // Create menu container (positioned above the window)
        const menuContainer: HTMLDivElement = document.createElement('div');
        menuContainer.className = 'cy-floating-window-menu';

        // Create menu elements and assemble
        const { leftGroup, spacer, rightGroup } = createHorizontalMenuElement(
            menuItems,
            () => {} // No-op onClose - menu is persistent
        );

        menuContainer.appendChild(leftGroup);
        menuContainer.appendChild(spacer);
        menuContainer.appendChild(rightGroup);

        // Add menu container first (above title bar)
        windowElement.appendChild(menuContainer);
    }

    // Assemble window
    windowElement.appendChild(titleBar);
    windowElement.appendChild(contentContainer);

    return {windowElement, contentContainer, titleBar};
}