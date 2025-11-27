import type {Core, NodeSingular, Position} from 'cytoscape';
import type {NodeIdAndFilePath, GraphNode} from "@/pure/graph";
import {createNewChildNodeFromUI, deleteNodeFromUI} from "@/shell/edge/UI-edge/graph/handleUIActions";
import {
    spawnTerminalWithNewContextNode
} from "@/shell/edge/UI-edge/floating-windows/terminals/spawnTerminalWithCommandFromUI-v2";
import {getFilePathForNode, getNodeFromMainToUI} from "@/shell/edge/UI-edge/graph/getNodeFromMainToUI";
import {Plus, Play, Trash2, Pencil, Clipboard, MoreHorizontal, createElement, type IconNode} from 'lucide';
import {getOrCreateOverlay} from "@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows-v2";

/** Menu item interface for the custom horizontal menu */
interface HorizontalMenuItem {
    icon: IconNode;
    label: string;
    color?: string;
    action: () => void | Promise<void>;
    subMenu?: HorizontalMenuItem[];
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

    // Add label
    const label: HTMLSpanElement = document.createElement('span');
    label.style.fontSize = '13px';
    label.textContent = item.label;
    button.appendChild(label);

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

export class HorizontalMenuService {
    private cy: Core | null = null;
    private deps: HorizontalMenuDependencies | null = null;
    private currentMenu: HTMLElement | null = null;
    private clickOutsideHandler: ((e: MouseEvent) => void) | null = null;

    initialize(cy: Core, deps: HorizontalMenuDependencies): void {
        this.cy = cy;
        this.deps = deps;
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

            // Use graph position (not rendered position) since menu is in the overlay
            const position: Position = node.position();

            this.showMenu(node, position);
        });
    }

    private showMenu(node: NodeSingular, position: {x: number; y: number}): void {
        if (!this.cy || !this.deps) return;

        // Close any existing menu
        this.hideMenu();

        const menuItems: HorizontalMenuItem[] = this.getNodeMenuItems(node);
        const overlay: HTMLElement = getOrCreateOverlay(this.cy);

        // Create menu container
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
        // Center horizontally, place above with some offset
        menu.style.left = `${position.x}px`;
        menu.style.top = `${position.y - 60}px`;
        menu.style.transform = 'translateX(-50%)';

        const closeMenu: () => void = () => this.hideMenu();

        // Create menu items
        for (const item of menuItems) {
            const itemContainer: HTMLDivElement = document.createElement('div');
            itemContainer.style.position = 'relative';

            const menuItemEl: HTMLElement = createMenuItemElement(item, closeMenu);
            itemContainer.appendChild(menuItemEl);

            // Handle submenu
            if (item.subMenu) {
                const submenu: HTMLElement = createSubMenuElement(item.subMenu, closeMenu);
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

    private getNodeMenuItems(node: NodeSingular): HorizontalMenuItem[] {
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
            action: async () => {
                const childId: NodeIdAndFilePath = await createNewChildNodeFromUI(nodeId, this.cy!);
                await this.deps!.createAnchoredFloatingEditor(childId);
            },
        });

        menuItems.push({
            icon: Play,
            label: 'Run',
            color: '#22c55e', // green
            action: async () => {
                await spawnTerminalWithNewContextNode(nodeId, this.cy!);
            },
        });

        const selectedCount: number = this.cy.$(':selected').nodes().size();
        const deleteLabel: string = selectedCount > 1 ? `Delete (${selectedCount})` : 'Delete';
        menuItems.push({
            icon: Trash2,
            label: deleteLabel,
            action: async () => {
                const selectedNodeIds: string[] = this.cy!.$(':selected').nodes().map((n) => n.id());
                const nodesToDelete: string[] = selectedNodeIds.includes(nodeId) && selectedNodeIds.length > 1
                    ? selectedNodeIds
                    : [nodeId];
                for (const id of nodesToDelete) {
                    await deleteNodeFromUI(id, this.cy!);
                }
            },
        });

        // Expandable "more" menu with Edit and Copy
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
        menuItems.push({
            icon: MoreHorizontal,
            label: 'More',
            action: () => {}, // No-op, submenu handles interaction
            subMenu: moreSubMenu,
        });

        return menuItems;
    }

    destroy(): void {
        this.hideMenu();

        if (this.cy) {
            this.cy.removeListener('mouseover', 'node');
        }
        this.cy = null;
        this.deps = null;
    }
}
