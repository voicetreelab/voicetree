import type {Core, NodeSingular, Position} from 'cytoscape';
import type {GraphNode} from "@/pure/graph";
import {createNewChildNodeFromUI, deleteNodesFromUI} from "@/shell/edge/UI-edge/graph/handleUIActions";
import {
    spawnTerminalWithNewContextNode,
    spawnTerminalWithCommandEditor,
} from "@/shell/edge/UI-edge/floating-windows/terminals/spawnTerminalWithCommandFromUI";
import {getEditorByNodeId} from "@/shell/edge/UI-edge/state/EditorStore";
import {getImageViewerByNodeId} from "@/shell/edge/UI-edge/state/ImageViewerStore";
import * as O from 'fp-ts/lib/Option.js';
import {getFilePathForNode, getNodeFromMainToUI} from "@/shell/edge/UI-edge/graph/getNodeFromMainToUI";
import {Plus, Play, Trash2, Clipboard, ChevronDown, Edit2, GitBranch, createElement, type IconNode} from 'lucide';
import {getOrCreateOverlay} from "@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows";
import {graphToScreenPosition, getWindowTransform, getTransformOrigin} from '@/pure/floatingWindowScaling';
import type {AgentConfig, VTSettings} from "@/pure/settings";
import {highlightContainedNodes, highlightPreviewNodes, clearContainedHighlights} from '@/shell/UI/cytoscape-graph-ui/highlightContextNodes';
import {createTrafficLights, createTrafficLightsForTarget} from "@/shell/edge/UI-edge/floating-windows/traffic-lights";

/** Slider config */
const SLIDER_SQUARE_COUNT: number = 10;
const SLIDER_SQUARE_SIZE: number = 12;
const SLIDER_SQUARE_GAP: number = 2;
const SLIDER_GOLD_COLOR: string = 'rgba(251, 191, 36, 0.9)';
const SLIDER_GRAY_COLOR: string = 'rgba(255, 255, 255, 0.2)';

/** Module-level state for floating slider */
let activeSlider: HTMLDivElement | null = null;
let sliderHideTimeout: number | null = null;

/** Options for showing the floating slider */
interface FloatingSliderOptions {
    readonly anchorElement: HTMLElement;      // The menu wrapper to position above
    readonly currentDistance: number;
    readonly onDistanceChange: (distance: number) => void;
    readonly overlay: HTMLElement;            // cy-floating-overlay to append to
}

/**
 * Show the floating distance slider above the menu anchor.
 * Creates a single shared slider element appended to cy-floating-overlay.
 */
export function showFloatingSlider(options: FloatingSliderOptions): void {
    // Clear any pending hide
    if (sliderHideTimeout !== null) {
        clearTimeout(sliderHideTimeout);
        sliderHideTimeout = null;
    }

    // Reuse or create slider
    if (!activeSlider) {
        activeSlider = createDistanceSlider(options.currentDistance, options.onDistanceChange);
        activeSlider.style.position = 'absolute';
        activeSlider.style.zIndex = '10002'; // Above menus
        options.overlay.appendChild(activeSlider);
    }

    // Position above the anchor (menu wrapper)
    const rect: DOMRect = options.anchorElement.getBoundingClientRect();
    const overlayRect: DOMRect = options.overlay.getBoundingClientRect();
    activeSlider.style.left = `${rect.left + rect.width / 2 - overlayRect.left}px`;
    activeSlider.style.bottom = `${overlayRect.height - (rect.top - overlayRect.top) + 8}px`;
    activeSlider.style.transform = 'translateX(-50%)';
    activeSlider.style.display = 'flex';

    // Keep visible when hovering slider
    activeSlider.onmouseenter = (): void => {
        if (sliderHideTimeout !== null) {
            clearTimeout(sliderHideTimeout);
            sliderHideTimeout = null;
        }
    };
    activeSlider.onmouseleave = (): void => hideFloatingSlider();
}

/**
 * Hide the floating slider with a small delay for mouse transition.
 */
export function hideFloatingSlider(): void {
    sliderHideTimeout = window.setTimeout(() => {
        if (activeSlider) {
            activeSlider.style.display = 'none';
        }
    }, 100); // Small delay for mouse transition
}

/**
 * Remove the floating slider completely from the DOM.
 * Call this when the menu/editor is destroyed.
 */
export function destroyFloatingSlider(): void {
    if (sliderHideTimeout !== null) {
        clearTimeout(sliderHideTimeout);
        sliderHideTimeout = null;
    }
    if (activeSlider) {
        activeSlider.remove();
        activeSlider = null;
    }
}

/**
 * Create a horizontal distance slider with 10 squares.
 * Updates contextNodeMaxDistance setting on hover and triggers preview refresh.
 * @internal Exported for testing only
 */
export function createDistanceSlider(
    currentDistance: number,
    onDistanceChange: (newDistance: number) => void
): HTMLDivElement {
    const container: HTMLDivElement = document.createElement('div');
    container.className = 'distance-slider';
    container.style.cssText = `
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        pointer-events: auto;
    `;

    // Add tooltip label above the squares
    const tooltip: HTMLSpanElement = document.createElement('span');
    tooltip.textContent = 'Select context-retrieval distance';
    tooltip.style.cssText = `
        font-size: 11px;
        color: var(--foreground);
        white-space: nowrap;
    `;
    container.appendChild(tooltip);

    // Container for the squares themselves
    const squaresRow: HTMLDivElement = document.createElement('div');
    squaresRow.style.cssText = `
        display: flex;
        gap: ${SLIDER_SQUARE_GAP}px;
        justify-content: center;
    `;

    const squares: HTMLDivElement[] = [];

    // Update visual state of all squares based on distance
    const updateSquares: (distance: number) => void = (distance: number): void => {
        squares.forEach((square, index) => {
            const squareDistance: number = index + 1;
            square.style.background = squareDistance <= distance ? SLIDER_GOLD_COLOR : SLIDER_GRAY_COLOR;
        });
    };

    for (let i: number = 0; i < SLIDER_SQUARE_COUNT; i++) {
        const square: HTMLDivElement = document.createElement('div');
        const squareDistance: number = i + 1;

        square.style.cssText = `
            width: ${SLIDER_SQUARE_SIZE}px;
            height: ${SLIDER_SQUARE_SIZE}px;
            background: ${squareDistance <= currentDistance ? SLIDER_GOLD_COLOR : SLIDER_GRAY_COLOR};
            border: 1px solid var(--muted-foreground);
            cursor: pointer;
            transition: background 0.1s ease;
        `;

        // On hover, update visual and trigger distance change
        square.addEventListener('mouseenter', () => {
            updateSquares(squareDistance);
            onDistanceChange(squareDistance);
        });

        squares.push(square);
        squaresRow.appendChild(square);
    }

    container.appendChild(squaresRow);
    return container;
}
import type {EditorData} from "@/shell/edge/UI-edge/floating-windows/editors/editorDataType";
import type {ImageViewerData} from "@/shell/edge/UI-edge/floating-windows/image-viewers/imageViewerDataType";

/** Config for attaching a distance slider to a menu item */
export interface SliderConfig {
    readonly currentDistance: number;
    readonly onDistanceChange: (newDistance: number) => void;
    readonly menuAnchor: HTMLElement;  // Element to position slider above
    readonly overlay: HTMLElement;      // Overlay to append slider to
}

/** Menu item interface for the custom horizontal menu */
export interface HorizontalMenuItem {
    icon: IconNode;
    label: string;
    color?: string;
    action: () => void | Promise<void>;
    subMenu?: HorizontalMenuItem[];
    hotkey?: string; // e.g., "⌘⏎" for cmd+enter
    onHoverEnter?: () => void | Promise<void>; // Optional callback on mouseenter
    onHoverLeave?: () => void; // Optional callback on mouseleave
    sliderConfig?: SliderConfig; // Optional distance slider shown on hover
}

/** Render a Lucide icon to SVG element with optional color */
function createIconElement(icon: IconNode, color?: string): SVGElement {
    const svgElement: SVGElement = createElement(icon);
    svgElement.setAttribute('width', '20');
    svgElement.setAttribute('height', '20');
    if (color) svgElement.setAttribute('stroke', color);
    return svgElement;
}

/** Create a menu item button element
 * @param alwaysShowLabel - if true, label is always visible (for vertical submenus)
 * @returns container element with button (and slider if configured)
 */
function createMenuItemElement(item: HorizontalMenuItem, onClose: () => void, alwaysShowLabel: boolean = false): HTMLElement {
    // Wrap button in container for slider positioning
    const container: HTMLDivElement = document.createElement('div');
    container.style.cssText = 'position: relative; display: inline-flex; flex-direction: column; align-items: center;';

    const button: HTMLButtonElement = document.createElement('button');
    button.className = 'horizontal-menu-item';
    button.style.cssText = `
        position: relative;
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        padding: 6px 20px;
        margin: 0 4px;
        border: none;
        background: transparent;
        cursor: pointer;
        color: inherit;
    `;

    // Add icon (fixed position, doesn't move on hover)
    const iconWrapper: HTMLSpanElement = document.createElement('span');
    iconWrapper.appendChild(createIconElement(item.icon, item.color));
    button.appendChild(iconWrapper);

    // Add label container - position depends on whether label is always shown
    const labelContainer: HTMLSpanElement = document.createElement('span');
    labelContainer.className = 'horizontal-menu-label';

    if (alwaysShowLabel) {
        // For vertical submenus: inline label, always visible
        labelContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
            white-space: nowrap;
        `;
    } else {
        // For horizontal menu: positioned absolutely below icon, hidden until hover
        labelContainer.style.cssText = `
            position: absolute;
            top: 100%;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            align-items: center;
            gap: 4px;
            white-space: nowrap;
            visibility: hidden;
            opacity: 0;
            transition: opacity 0.1s ease;
        `;
    }

    const labelText: HTMLSpanElement = document.createElement('span');
    labelText.style.fontSize = '13px';
    labelText.textContent = item.label;
    labelContainer.appendChild(labelText);

    // Add hotkey hint if provided
    if (item.hotkey) {
        const hotkeyHint: HTMLSpanElement = document.createElement('span');
        hotkeyHint.style.cssText = `
            font-size: 10px;
            color: var(--muted-foreground);
            opacity: 0.7;
        `;
        hotkeyHint.textContent = item.hotkey;
        labelContainer.appendChild(hotkeyHint);
    }

    button.appendChild(labelContainer);
    container.appendChild(button);

    // Hover effect - for horizontal menu, show label; for vertical, just highlight
    // Also show/hide floating slider on hover (slider is appended to overlay, not container)
    // Use CSS variable for dark mode support
    button.addEventListener('mouseenter', () => {
        button.style.background = 'var(--accent)';
        if (!alwaysShowLabel) {
            labelContainer.style.visibility = 'visible';
            labelContainer.style.opacity = '1';
        }
        if (item.sliderConfig) {
            showFloatingSlider({
                anchorElement: item.sliderConfig.menuAnchor,
                currentDistance: item.sliderConfig.currentDistance,
                onDistanceChange: item.sliderConfig.onDistanceChange,
                overlay: item.sliderConfig.overlay,
            });
        }
        if (item.onHoverEnter) {
            void item.onHoverEnter();
        }
    });
    button.addEventListener('mouseleave', () => {
        button.style.background = 'transparent';
        if (!alwaysShowLabel) {
            labelContainer.style.visibility = 'hidden';
            labelContainer.style.opacity = '0';
        }
        if (item.sliderConfig) {
            hideFloatingSlider();
        }
        if (item.onHoverLeave) {
            item.onHoverLeave();
        }
    });

    // Click handler
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        void item.action();
        if (!item.subMenu) {
            onClose();
        }
    });

    return container;
}

/** Create submenu container (vertical dropdown)
 * Styles are defined in floating-windows.css (.horizontal-menu-submenu) for dark mode support */
function createSubMenuElement(items: HorizontalMenuItem[], onClose: () => void): HTMLElement {
    const submenu: HTMLDivElement = document.createElement('div');
    submenu.className = 'horizontal-menu-submenu';

    for (const item of items) {
        // Pass alwaysShowLabel=true for vertical submenu items
        const menuItem: HTMLElement = createMenuItemElement(item, onClose, true);
        menuItem.style.flexDirection = 'row';
        menuItem.style.justifyContent = 'flex-start';
        menuItem.style.gap = '8px';
        menuItem.style.whiteSpace = 'nowrap';
        // Target the button inside container to reduce its padding for submenu context
        const button: HTMLButtonElement | null = menuItem.querySelector('button');
        if (button) {
            button.style.padding = '4px 8px';
            button.style.margin = '0';
        }
        submenu.appendChild(menuItem);
    }

    return submenu;
}

/** Input parameters for getNodeMenuItems */
export interface NodeMenuItemsInput {
    readonly nodeId: string;
    readonly cy: Core;
    readonly agents: readonly AgentConfig[];
    readonly isContextNode: boolean;
    readonly currentDistance?: number; // Current context retrieval distance (for slider)
    readonly menuAnchor?: HTMLElement;  // Element to position slider above (required for slider)
    readonly overlay?: HTMLElement;      // Overlay to append slider to (required for slider)
}

/**
 * Create slider config for run buttons (non-context nodes only).
 * The slider allows adjusting context retrieval distance and shows preview.
 */
function createRunButtonSliderConfig(
    cy: Core,
    nodeId: string,
    currentDistance: number,
    menuAnchor: HTMLElement,
    overlay: HTMLElement
): SliderConfig {
    return {
        currentDistance,
        onDistanceChange: (newDistance: number): void => {
            void (async (): Promise<void> => {
                const currentSettings: VTSettings | null = await window.electronAPI?.main.loadSettings() ?? null;
                if (currentSettings && window.electronAPI) {
                    await window.electronAPI.main.saveSettings({...currentSettings, contextNodeMaxDistance: newDistance});
                }
                clearContainedHighlights(cy);
                await highlightPreviewNodes(cy, nodeId);
            })();
        },
        menuAnchor,
        overlay,
    };
}

/**
 * Get menu items for a node - pure function that returns menu item definitions.
 * Extracted for reuse by floating window chrome.
 */
export function getNodeMenuItems(input: NodeMenuItemsInput): HorizontalMenuItem[] {
    const { nodeId, cy, agents, isContextNode, currentDistance, menuAnchor, overlay } = input;
    const menuItems: HorizontalMenuItem[] = [];

    // Create slider config for non-context nodes (context nodes don't need distance slider)
    // Only create if menuAnchor and overlay are provided (required for floating slider)
    const sliderConfig: SliderConfig | undefined = !isContextNode && currentDistance !== undefined && menuAnchor && overlay
        ? createRunButtonSliderConfig(cy, nodeId, currentDistance, menuAnchor, overlay)
        : undefined;

    // LEFT SIDE: Delete, Copy, Add (3 buttons)
    menuItems.push({
        icon: Trash2, label: 'Delete', hotkey: '⌘⌫',
        action: () => deleteNodesFromUI([nodeId], cy),
    });
    menuItems.push({
        icon: Clipboard, label: 'Copy Path',
        action: () => { void navigator.clipboard.writeText(getFilePathForNode(nodeId)); },
    });
    menuItems.push({
        icon: Plus, label: 'Add Child', hotkey: '⌘N',
        action: () => { void createNewChildNodeFromUI(nodeId, cy); },
    });

    // RIGHT SIDE: Run, More (2 buttons) + traffic light placeholders (Close, Pin, Fullscreen)
    menuItems.push({
        icon: Play,
        label: 'Run',
        color: '#22c55e', // green
        hotkey: '⌘⏎',
        action: async () => {
            await spawnTerminalWithNewContextNode(nodeId, cy);
        },
        // Context nodes: show contained nodes. Normal nodes: preview what would be captured.
        onHoverEnter: isContextNode
            ? () => highlightContainedNodes(cy, nodeId)
            : () => highlightPreviewNodes(cy, nodeId),
        onHoverLeave: () => clearContainedHighlights(cy),
        sliderConfig, // Show distance slider on hover for non-context nodes
        subMenu: [
            { icon: GitBranch, label: 'Run in Worktree', action: () => spawnTerminalWithNewContextNode(nodeId, cy, undefined, true) },
            { icon: Edit2, label: 'Edit Command', action: () => spawnTerminalWithCommandEditor(nodeId, cy) },
        ],
    });

    // Expandable "more" menu with Copy Content and additional agents
    const moreSubMenu: HorizontalMenuItem[] = [
        {
            icon: Clipboard,
            label: 'Copy Content',
            action: async () => {
                const graphNode: GraphNode = await getNodeFromMainToUI(nodeId);
                void navigator.clipboard.writeText(graphNode.contentWithoutYamlOrLinks);
            },
        },
    ];

    // Add non-default agents (skip first which is default, used by Run button)
    for (const agent of agents.slice(1)) {
        moreSubMenu.push({
            icon: Play,
            label: agent.name,
            color: '#6366f1', // indigo to distinguish from default Run
            action: async () => {
                await spawnTerminalWithNewContextNode(nodeId, cy, agent.command);
            },
            // Context nodes: show contained nodes. Normal nodes: preview what would be captured.
            onHoverEnter: isContextNode
                ? () => highlightContainedNodes(cy, nodeId)
                : () => highlightPreviewNodes(cy, nodeId),
            onHoverLeave: () => clearContainedHighlights(cy),
            sliderConfig, // Show distance slider on hover for non-context nodes
        });
    }
    menuItems.push({
        icon: ChevronDown,
        label: 'More',
        action: () => {}, // No-op, submenu handles interaction
        subMenu: moreSubMenu,
    });

    return menuItems;
}

/** Output from createHorizontalMenuElement */
export interface HorizontalMenuElements {
    readonly leftGroup: HTMLDivElement;
    readonly spacer: HTMLDivElement;
    readonly rightGroup: HTMLDivElement;
}

/**
 * Create the horizontal menu DOM elements (left pill group + spacer + right pill group).
 * Returns the individual elements so they can be assembled into any container.
 * Extracted for reuse by floating window chrome.
 *
 * @param menuItems - Menu items to render
 * @param onClose - Callback when menu should close (for hover menus)
 * @param trafficLights - Optional traffic light buttons to append
 */
export function createHorizontalMenuElement(
    menuItems: HorizontalMenuItem[],
    onClose: () => void,
    trafficLights?: HTMLDivElement
): HorizontalMenuElements {
    // Create left group (first 3 buttons: Delete, Copy, Add)
    // Uses .horizontal-menu-pill CSS class for styling (supports dark mode)
    const leftGroup: HTMLDivElement = document.createElement('div');
    leftGroup.className = 'horizontal-menu-pill horizontal-menu-left-group';

    // Create right group (Run, More + traffic light placeholders)
    const rightGroup: HTMLDivElement = document.createElement('div');
    rightGroup.className = 'horizontal-menu-pill horizontal-menu-right-group';

    // Split point: first 3 items go left (Delete, Copy, Add), rest go right (Run, More)
    const SPLIT_INDEX: number = 3;

    for (let i: number = 0; i < menuItems.length; i++) {
        const item: HorizontalMenuItem = menuItems[i];
        const itemContainer: HTMLDivElement = document.createElement('div');
        itemContainer.style.position = 'relative';

        const menuItemEl: HTMLElement = createMenuItemElement(item, onClose);
        itemContainer.appendChild(menuItemEl);

        // Handle submenu
        if (item.subMenu) {
            const submenu: HTMLElement = createSubMenuElement(item.subMenu, onClose);
            itemContainer.appendChild(submenu);

            // Show/hide submenu on hover
            itemContainer.addEventListener('mouseenter', () => {
                submenu.style.display = 'flex';
            });
            itemContainer.addEventListener('mouseleave', () => {
                submenu.style.display = 'none';
            });
        }

        // Add to left or right group
        if (i < SPLIT_INDEX) {
            leftGroup.appendChild(itemContainer);
        } else {
            rightGroup.appendChild(itemContainer);
        }
    }

    const defaultTrafficLights: HTMLDivElement = createTrafficLights({
        onClose: () => {},
        onPin: () => false,
        isPinned: false,
    });
    const trafficLightContainer: HTMLDivElement = trafficLights ?? defaultTrafficLights;

    // Append buttons directly to preserve existing right-group structure
    const trafficLightButtons: Element[] = Array.from(trafficLightContainer.children);
    trafficLightButtons.forEach((button: Element) => {
        rightGroup.appendChild(button);
    });

    // Spacer in middle (gap for node circle, no background)
    const spacer: HTMLDivElement = document.createElement('div');
    spacer.className = 'horizontal-menu-spacer';
    spacer.style.cssText = `
        width: 50px;
        height: 1px;
        pointer-events: none;
    `;

    return { leftGroup, spacer, rightGroup };
}

export class HorizontalMenuService {
    private cy: Core | null = null;
    private currentMenu: HTMLElement | null = null;
    private clickOutsideHandler: ((e: MouseEvent) => void) | null = null;

    initialize(cy: Core): void {
        this.cy = cy;
        this.setupNodeHoverMenu();
    }

    private setupNodeHoverMenu(): void {
        if (!this.cy) return;

        if (!this.cy.container()) {
            console.log('[HorizontalMenuService] Skipping - cytoscape is in headless mode');
            return;
        }

        if (typeof document === 'undefined' || !document.body || !document.documentElement) {
            console.log('[HorizontalMenuService] Skipping - DOM not available');
            return;
        }

        // Show horizontal menu on node hover
        this.cy.on('mouseover', 'node', (event) => {
            const node: NodeSingular = event.target as NodeSingular;
            const nodeId: string = node.id();

            // Only open horizontal menu for markdown nodes (nodes with file extensions)
            // Terminal nodes, shadow nodes, etc. don't have file extensions
            const hasFileExtension: boolean = /\.\w+$/.test(nodeId);
            if (!hasFileExtension) {
                return;
            }

            // Skip hover menu if node has any editor or image viewer open (anchored or hover)
            // Both types now have traffic lights in their window chrome
            const existingEditor: O.Option<EditorData> = getEditorByNodeId(nodeId);
            if (O.isSome(existingEditor)) {
                return;
            }
            const existingImageViewer: O.Option<ImageViewerData> = getImageViewerByNodeId(nodeId);
            if (O.isSome(existingImageViewer)) {
                return;
            }

            // Use graph position (not rendered position) since menu is in the overlay
            const position: Position = node.position();

            void this.showMenu(node, position);
        });
    }

    private async showMenu(node: NodeSingular, position: {x: number; y: number}): Promise<void> {
        if (!this.cy) return;

        // Close any existing menu
        this.hideMenu();

        // Load settings to get agents list and context distance
        const settings: VTSettings | null = await window.electronAPI?.main.loadSettings() ?? null;
        const agents: readonly AgentConfig[] = settings?.agents ?? [];
        const currentDistance: number = settings?.contextNodeMaxDistance ?? 5;

        const nodeId: string = node.id();
        const isContextNode: boolean = node.data('isContextNode') === true;
        const overlay: HTMLElement = getOrCreateOverlay(this.cy);

        // Create menu container first (transparent, just for positioning)
        // pointer-events: none so the gap in the middle allows clicking the node
        const menu: HTMLDivElement = document.createElement('div');
        menu.className = 'cy-horizontal-context-menu';
        menu.style.cssText = `
            position: absolute;
            display: flex;
            flex-direction: row;
            align-items: center;
            background: transparent;
            pointer-events: none;
            z-index: 10000;
        `;

        // Get menu items with menuAnchor and overlay for floating slider
        const menuItems: HorizontalMenuItem[] = getNodeMenuItems({
            nodeId,
            cy: this.cy,
            agents,
            isContextNode,
            currentDistance,
            menuAnchor: menu,
            overlay,
        });

        // Store graph position for zoom updates (menu uses CSS transform scaling)
        const zoom: number = this.cy.zoom();
        menu.dataset.graphX = String(position.x);
        menu.dataset.graphY = String(position.y);
        const screenPos: { readonly x: number; readonly y: number } = graphToScreenPosition(position, zoom);
        menu.style.left = `${screenPos.x}px`;
        menu.style.top = `${screenPos.y}px`;
        menu.style.transform = getWindowTransform('css-transform', zoom, 'center');
        menu.style.transformOrigin = getTransformOrigin('center');

        const closeMenu: () => void = () => this.hideMenu();

        const trafficLights: HTMLDivElement = createTrafficLightsForTarget({
            kind: 'hover-menu',
            nodeId,
            cy: this.cy,
            closeMenu,
        });

        const { leftGroup, spacer, rightGroup } = createHorizontalMenuElement(menuItems, closeMenu, trafficLights);

        // Assemble: left group, spacer, right group
        menu.appendChild(leftGroup);
        menu.appendChild(spacer);
        menu.appendChild(rightGroup);

        overlay.appendChild(menu);
        this.currentMenu = menu;

        // Setup click-outside handler (same logic as hover editors)
        // Add listener after a short delay to prevent immediate closure
        setTimeout(() => {
            this.clickOutsideHandler = (e: MouseEvent) => {
                if (this.currentMenu && !this.currentMenu.contains(e.target as Node)) {
                    this.hideMenu();
                }
            };
            document.addEventListener('mousedown', this.clickOutsideHandler);
        }, 100);
    }

    private hideMenu(): void {
        // Destroy floating slider when menu closes
        destroyFloatingSlider();

        if (this.currentMenu) {
            this.currentMenu.remove();
            this.currentMenu = null;
        }
        if (this.clickOutsideHandler) {
            document.removeEventListener('mousedown', this.clickOutsideHandler);
            this.clickOutsideHandler = null;
        }
    }

    destroy(): void {
        this.hideMenu();

        if (this.cy) {
            this.cy.removeListener('mouseover', 'node');
        }
        this.cy = null;
    }
}
