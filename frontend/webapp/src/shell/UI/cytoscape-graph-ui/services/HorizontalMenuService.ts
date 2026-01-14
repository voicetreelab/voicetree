import type {Core, NodeSingular, Position} from 'cytoscape';
import type {GraphNode} from "@/pure/graph";
import {createNewChildNodeFromUI, deleteNodesFromUI} from "@/shell/edge/UI-edge/graph/handleUIActions";
import {
    spawnTerminalWithNewContextNode,
} from "@/shell/edge/UI-edge/floating-windows/terminals/spawnTerminalWithCommandFromUI";
import {createAnchoredFloatingEditor} from "@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD";
import {removeFromAutoPinQueue, getEditorByNodeId} from "@/shell/edge/UI-edge/state/EditorStore";
import * as O from 'fp-ts/lib/Option.js';
import {isAnchored, type EditorData} from "@/shell/edge/UI-edge/floating-windows/types";
import {getFilePathForNode, getNodeFromMainToUI} from "@/shell/edge/UI-edge/graph/getNodeFromMainToUI";
import {Plus, Play, Trash2, Clipboard, MoreHorizontal, Pin, createElement, type IconNode} from 'lucide';
import {getOrCreateOverlay} from "@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows";
import {graphToScreenPosition, getWindowTransform, getTransformOrigin} from '@/pure/floatingWindowScaling';
import type {AgentConfig} from "@/pure/settings";
import {highlightContainedNodes, highlightPreviewNodes, clearContainedHighlights} from '@/shell/UI/cytoscape-graph-ui/highlightContextNodes';

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
 */
function createMenuItemElement(item: HorizontalMenuItem, onClose: () => void, alwaysShowLabel: boolean = false): HTMLElement {
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
            color: #888;
            opacity: 0.7;
        `;
        hotkeyHint.textContent = item.hotkey;
        labelContainer.appendChild(hotkeyHint);
    }

    button.appendChild(labelContainer);

    // Hover effect - for horizontal menu, show label; for vertical, just highlight
    button.addEventListener('mouseenter', () => {
        button.style.background = 'rgba(0,0,0,0.1)';
        if (!alwaysShowLabel) {
            labelContainer.style.visibility = 'visible';
            labelContainer.style.opacity = '1';
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

    return button;
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
        menuItem.style.padding = '4px 12px';
        menuItem.style.whiteSpace = 'nowrap';
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
}

/**
 * Get menu items for a node - pure function that returns menu item definitions.
 * Extracted for reuse by floating window chrome.
 */
export function getNodeMenuItems(input: NodeMenuItemsInput): HorizontalMenuItem[] {
    const { nodeId, cy, agents, isContextNode } = input;
    const menuItems: HorizontalMenuItem[] = [];

    // LEFT SIDE: Pin, Copy, Add (3 buttons)
    menuItems.push({
        icon: Pin,
        label: 'Pin Editor',
        action: async () => {
            // Manual pin: remove from auto-pin queue so this editor won't auto-close
            removeFromAutoPinQueue(nodeId);
            await createAnchoredFloatingEditor(cy, nodeId);
        },
    });

    menuItems.push({
        icon: Clipboard,
        label: 'Copy Path',
        action: async () => {
            const absolutePath: string | undefined = await getFilePathForNode(nodeId);
            void navigator.clipboard.writeText(absolutePath ?? nodeId);
        },
    });

    menuItems.push({
        icon: Plus,
        label: 'Add Child',
        hotkey: '⌘N',
        action: async () => {
            // Editor auto-pinning handled by file watcher in VoiceTreeGraphView
            await createNewChildNodeFromUI(nodeId, cy);
        },
    });

    // RIGHT SIDE: Run, Delete, More (3 buttons)
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
    });

    menuItems.push({
        icon: Trash2,
        label: 'Delete',
        hotkey: '⌘⌫',
        action: async () => {
            await deleteNodesFromUI([nodeId], cy);
        },
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
        });
    }
    menuItems.push({
        icon: MoreHorizontal,
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
 */
export function createHorizontalMenuElement(
    menuItems: HorizontalMenuItem[],
    onClose: () => void
): HorizontalMenuElements {
    // Create left group (first 3 buttons: Pin, Copy, Add)
    // Uses .horizontal-menu-pill CSS class for styling (supports dark mode)
    const leftGroup: HTMLDivElement = document.createElement('div');
    leftGroup.className = 'horizontal-menu-pill horizontal-menu-left-group';

    // Create right group (last 3 buttons: Run, Delete, More)
    const rightGroup: HTMLDivElement = document.createElement('div');
    rightGroup.className = 'horizontal-menu-pill horizontal-menu-right-group';

    // Split point: first 3 items go left, rest go right
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

            // Skip hover menu if node has an anchored (pinned) editor open
            // The menu is already visible on the floating window chrome
            const existingEditor: O.Option<EditorData> = getEditorByNodeId(nodeId);
            if (O.isSome(existingEditor) && isAnchored(existingEditor.value)) {
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

        // Load settings to get agents list
        const settings: { agents?: readonly AgentConfig[] } | null = await window.electronAPI?.main.loadSettings() ?? null;
        const agents: readonly AgentConfig[] = settings?.agents ?? [];

        const nodeId: string = node.id();
        const isContextNode: boolean = node.data('isContextNode') === true;
        const menuItems: HorizontalMenuItem[] = getNodeMenuItems({
            nodeId,
            cy: this.cy,
            agents,
            isContextNode,
        });
        const overlay: HTMLElement = getOrCreateOverlay(this.cy);

        // Create menu container (transparent, just for positioning)
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

        // Use extracted function to create menu elements
        const { leftGroup, spacer, rightGroup } = createHorizontalMenuElement(menuItems, closeMenu);

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
