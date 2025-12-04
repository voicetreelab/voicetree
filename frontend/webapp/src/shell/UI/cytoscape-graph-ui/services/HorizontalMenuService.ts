import type {Core, NodeSingular, Position} from 'cytoscape';
import type {NodeIdAndFilePath, GraphNode} from "@/pure/graph";
import {createNewChildNodeFromUI, deleteNodesFromUI} from "@/shell/edge/UI-edge/graph/handleUIActions";
import {
    spawnTerminalWithNewContextNode
} from "@/shell/edge/UI-edge/floating-windows/terminals/spawnTerminalWithCommandFromUI";
import {getFilePathForNode, getNodeFromMainToUI} from "@/shell/edge/UI-edge/graph/getNodeFromMainToUI";
import {Plus, Play, Trash2, Pencil, Clipboard, MoreHorizontal, createElement, type IconNode} from 'lucide';
import {getOrCreateOverlay} from "@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows";
import type {AgentConfig} from "@/pure/settings";

/** Menu item interface for the custom horizontal menu */
interface HorizontalMenuItem {
    icon: IconNode;
    label: string;
    color?: string;
    action: () => void | Promise<void>;
    subMenu?: HorizontalMenuItem[];
    hotkey?: string; // e.g., "⌘⏎" for cmd+enter
}

/** Render a Lucide icon to SVG element with optional color */
function createIconElement(icon: IconNode, color?: string): SVGElement {
    const svgElement: SVGElement = createElement(icon);
    svgElement.setAttribute('width', '20');
    svgElement.setAttribute('height', '20');
    if (color) svgElement.setAttribute('stroke', color);
    return svgElement;
}

/** Create a menu item button element */
function createMenuItemElement(item: HorizontalMenuItem, onClose: () => void): HTMLElement {
    const button: HTMLButtonElement = document.createElement('button');
    button.className = 'horizontal-menu-item';
    button.style.cssText = `
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        padding: 6px 14px;
        border: none;
        background: transparent;
        cursor: pointer;
        color: inherit;
    `;

    // Add icon
    const iconWrapper: HTMLSpanElement = document.createElement('span');
    iconWrapper.appendChild(createIconElement(item.icon, item.color));
    button.appendChild(iconWrapper);

    // Add label container with text and optional hotkey hint
    const labelContainer: HTMLSpanElement = document.createElement('span');
    labelContainer.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 4px;
    `;

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

    // Hover effect
    button.addEventListener('mouseenter', () => {
        button.style.background = 'rgba(0,0,0,0.1)';
    });
    button.addEventListener('mouseleave', () => {
        button.style.background = 'transparent';
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

/** Create submenu container */
function createSubMenuElement(items: HorizontalMenuItem[], onClose: () => void): HTMLElement {
    const submenu: HTMLDivElement = document.createElement('div');
    submenu.className = 'horizontal-menu-submenu';
    submenu.style.cssText = `
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        display: none;
        flex-direction: column;
        background: #fff;
        border: 1px solid #999;
        box-shadow: #aaa 3px 3px 3px;
        padding: 2px 0;
        z-index: 10001;
        pointer-events: auto;
    `;

    for (const item of items) {
        const menuItem: HTMLElement = createMenuItemElement(item, onClose);
        menuItem.style.flexDirection = 'row';
        menuItem.style.justifyContent = 'flex-start';
        menuItem.style.gap = '8px';
        menuItem.style.padding = '4px 12px';
        menuItem.style.whiteSpace = 'nowrap';
        submenu.appendChild(menuItem);
    }

    return submenu;
}

export interface HorizontalMenuDependencies {
    createAnchoredFloatingEditor: (nodeId: NodeIdAndFilePath) => Promise<void>;
}

// Module-level reference for access from FloatingEditorCRUD
let horizontalMenuServiceInstance: HorizontalMenuService | null = null;

function setHorizontalMenuServiceInstance(instance: HorizontalMenuService): void {
    horizontalMenuServiceInstance = instance;
}

/**
 * Get the current HorizontalMenuService instance.
 * Used by FloatingEditorCRUD to show/hide persistent menus.
 */
export function getHorizontalMenuService(): HorizontalMenuService | null {
    return horizontalMenuServiceInstance;
}

export class HorizontalMenuService {
    private cy: Core | null = null;
    private deps: HorizontalMenuDependencies | null = null;

    // Hover menu state (single menu, existing behavior)
    private currentMenu: HTMLElement | null = null;
    private currentMenuNodeId: string | null = null;
    private clickOutsideHandler: ((e: MouseEvent) => void) | null = null;

    // Persistent menus for anchored editors (separate, independent)
    private persistentMenus: Map<string, HTMLElement> = new Map();

    initialize(cy: Core, deps: HorizontalMenuDependencies): void {
        this.cy = cy;
        this.deps = deps;
        this.setupNodeHoverMenu();
        // Register this instance for access from FloatingEditorCRUD
        setHorizontalMenuServiceInstance(this);
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

            // Skip hover menu if this node already has a persistent menu (from anchored editor)
            if (this.persistentMenus.has(nodeId)) {
                return;
            }

            // Use graph position (not rendered position) since menu is in the overlay
            const position: Position = node.position();

            void this.showHoverMenu(node, position);
        });
    }

    /**
     * Show a persistent menu for a node (won't close on click-outside).
     * Called by FloatingEditorCRUD when an anchored editor is created.
     */
    showPersistentMenu(nodeId: string): void {
        if (!this.cy || !this.deps) return;

        // Already has a persistent menu for this node
        if (this.persistentMenus.has(nodeId)) {
            return;
        }

        const node: NodeSingular | undefined = this.cy.$id(nodeId);
        if (!node || node.length === 0) {
            console.log('[HorizontalMenuService] Cannot show persistent menu - node not found:', nodeId);
            return;
        }

        // Close hover menu if it's for this node (persistent menu replaces it)
        if (this.currentMenuNodeId === nodeId) {
            this.hideHoverMenu();
        }

        const position: Position = node.position();
        void this.createPersistentMenuElement(node, position);
    }

    /**
     * Hide the persistent menu for a node.
     * Called by FloatingEditorCRUD when an anchored editor is closed.
     */
    hidePersistentMenu(nodeId: string): void {
        const menu: HTMLElement | undefined = this.persistentMenus.get(nodeId);
        if (menu) {
            menu.remove();
            this.persistentMenus.delete(nodeId);
        }
    }

    /**
     * Create a persistent menu element for an anchored editor.
     */
    private async createPersistentMenuElement(node: NodeSingular, position: {x: number; y: number}): Promise<void> {
        if (!this.cy || !this.deps) return;

        const nodeId: string = node.id();

        // Load settings to get agents list
        const settings: { agents?: readonly AgentConfig[] } | null = await window.electronAPI.main.loadSettings();
        const agents: readonly AgentConfig[] = settings?.agents ?? [];

        const menuItems: HorizontalMenuItem[] = this.getNodeMenuItems(node, agents);
        const overlay: HTMLElement = getOrCreateOverlay(this.cy);

        const menu: HTMLDivElement = this.createMenuElement(position, menuItems, () => {
            // Persistent menus don't close on item click
        });

        overlay.appendChild(menu);
        this.persistentMenus.set(nodeId, menu);
    }

    /**
     * Show hover menu for a node (closes on click-outside or hover away).
     */
    private async showHoverMenu(node: NodeSingular, position: {x: number; y: number}): Promise<void> {
        if (!this.cy || !this.deps) return;

        const nodeId: string = node.id();

        // If already showing hover menu for this node, do nothing
        if (this.currentMenu && this.currentMenuNodeId === nodeId) {
            return;
        }

        // Close any existing hover menu
        this.hideHoverMenu();

        // Load settings to get agents list
        const settings: { agents?: readonly AgentConfig[] } | null = await window.electronAPI.main.loadSettings();
        const agents: readonly AgentConfig[] = settings?.agents ?? [];

        const menuItems: HorizontalMenuItem[] = this.getNodeMenuItems(node, agents);
        const overlay: HTMLElement = getOrCreateOverlay(this.cy);

        const menu: HTMLDivElement = this.createMenuElement(position, menuItems, () => {
            this.hideHoverMenu();
        });

        overlay.appendChild(menu);
        this.currentMenu = menu;
        this.currentMenuNodeId = nodeId;

        // Setup click-outside handler for hover menu
        setTimeout(() => {
            this.clickOutsideHandler = (e: MouseEvent): void => {
                if (this.currentMenu && !this.currentMenu.contains(e.target as Node)) {
                    this.hideHoverMenu();
                }
            };
            document.addEventListener('mousedown', this.clickOutsideHandler);
        }, 100);
    }

    /**
     * Create a menu DOM element with the given items.
     */
    private createMenuElement(
        position: {x: number; y: number},
        menuItems: HorizontalMenuItem[],
        onClose: () => void
    ): HTMLDivElement {
        const menu: HTMLDivElement = document.createElement('div');
        menu.className = 'cy-horizontal-context-menu';
        menu.style.cssText = `
            position: absolute;
            display: flex;
            flex-direction: row;
            align-items: center;
            background: transparent;
            pointer-events: auto;
            z-index: 10000;
        `;

        // Position above the node (in graph coordinates)
        menu.style.left = `${position.x}px`;
        menu.style.top = `${position.y - 60}px`;
        menu.style.transform = 'translateX(-50%)';

        // Create menu items
        for (const item of menuItems) {
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

            menu.appendChild(itemContainer);
        }

        return menu;
    }

    private hideHoverMenu(): void {
        if (this.currentMenu) {
            this.currentMenu.remove();
            this.currentMenu = null;
        }
        this.currentMenuNodeId = null;
        if (this.clickOutsideHandler) {
            document.removeEventListener('mousedown', this.clickOutsideHandler);
            this.clickOutsideHandler = null;
        }
    }

    private getNodeMenuItems(node: NodeSingular, agents: readonly AgentConfig[]): HorizontalMenuItem[] {
        if (!this.cy || !this.deps) return [];

        const menuItems: HorizontalMenuItem[] = [];
        const nodeId: string = node.id();

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
            label: 'Add',
            hotkey: '⌘N',
            action: async () => {
                const childId: NodeIdAndFilePath = await createNewChildNodeFromUI(nodeId, this.cy!);
                await this.deps!.createAnchoredFloatingEditor(childId);
            },
        });

        menuItems.push({
            icon: Play,
            label: 'Run',
            color: '#22c55e', // green
            hotkey: '⌘⏎',
            action: async () => {
                await spawnTerminalWithNewContextNode(nodeId, this.cy!);
            },
        });

        menuItems.push({
            icon: Trash2,
            label: 'Delete',
            hotkey: '⌘⌫',
            action: async () => {
                await deleteNodesFromUI([nodeId], this.cy!);
            },
        });

        // Expandable "more" menu with Edit, Copy, and additional agents
        const moreSubMenu: HorizontalMenuItem[] = [
            {
                icon: Pencil,
                label: 'Pin Editor',
                action: async () => {
                    await this.deps!.createAnchoredFloatingEditor(nodeId);
                },
            },
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
                    await spawnTerminalWithNewContextNode(nodeId, this.cy!, agent.command);
                },
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

    destroy(): void {
        this.hideHoverMenu();

        // Clean up all persistent menus
        for (const menu of this.persistentMenus.values()) {
            menu.remove();
        }
        this.persistentMenus.clear();

        if (this.cy) {
            this.cy.removeListener('mouseover', 'node');
        }
        this.cy = null;
        this.deps = null;
    }
}
