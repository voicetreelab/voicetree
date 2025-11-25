import type {Core} from 'cytoscape';
import ctxmenu from '@/shell/UI/lib/ctxmenu.js';
import {deleteNodeFromUI} from "@/shell/edge/UI-edge/graph/handleUIActions.ts";

export interface Position {
    x: number;
    y: number;
}

export interface VerticalMenuDependencies {
    handleAddNodeAtPosition: (position: Position) => Promise<void>;
}

export interface MenuItem {
    text?: string;
    html?: string;
    action?: () => void | Promise<void>;
    subMenu?: MenuItem[];
}

/** Helper to show menu with optional direction config */
export function showCtxMenu(
    items: MenuItem[],
    event: MouseEvent,
    direction: 'vertical' | 'horizontal' = 'vertical'
): void {
    const config = direction === 'horizontal'
        ? {
            attributes: { class: 'ctxmenu horizontal' },
            // Center horizontal menu after rendering (can't use CSS transform - breaks submenu positioning)
            onShow: (menu: HTMLElement) => {
                const menuWidth = menu.offsetWidth;
                const currentLeft = parseFloat(menu.style.left) || 0;
                menu.style.left = `${currentLeft - menuWidth / 2}px`;
            },
        }
        : {};
    ctxmenu.show(items, event, config);
}

export class VerticalMenuService {
    private cy: Core | null = null;
    private deps: VerticalMenuDependencies | null = null;

    initialize(cy: Core, deps: VerticalMenuDependencies): void {
        this.cy = cy;
        this.deps = deps;
        this.setupCanvasContextMenu();
    }

    private setupCanvasContextMenu(): void {
        if (!this.cy) return;

        if (!this.cy.container()) {
            console.log('[VerticalMenuService] Skipping canvas context menu setup - cytoscape is in headless mode');
            return;
        }

        if (typeof document === 'undefined' || !document.body || !document.documentElement) {
            console.log('[VerticalMenuService] Skipping canvas context menu setup - DOM not available');
            return;
        }

        // Handle right-click on background - show vertical menu
        this.cy.on('cxttap', (event) => {
            if (event.target === this.cy) {
                const position = event.position ?? { x: 0, y: 0 };
                const renderedPosition = event.renderedPosition ?? position;

                const container = this.cy!.container();
                if (!container) return;

                const containerRect = container.getBoundingClientRect();
                const x = containerRect.left + (renderedPosition.x ?? 0);
                const y = containerRect.top + (renderedPosition.y ?? 0);

                const menuItems = this.getCanvasVerticalMenuItems(position);
                const syntheticEvent = new MouseEvent('contextmenu', {
                    clientX: x,
                    clientY: y,
                    bubbles: true,
                    cancelable: true,
                });
                ctxmenu.show(menuItems, syntheticEvent);
            }
        });
    }

    private getCanvasVerticalMenuItems(position: Position): MenuItem[] {
        const menuItems: MenuItem[] = [];

        if (this.deps) {
            menuItems.push({
                text: 'Add Node Here',
                action: async () => {
                    console.log('[VerticalMenuService] Creating node at position:', position);
                    await this.deps!.handleAddNodeAtPosition(position);
                },
            });
        }

        // Delete selected nodes (only show if nodes are selected)
        const selectedCount = this.cy!.$(':selected').nodes().size();
        if (selectedCount > 0) {
            menuItems.push({
                text: `Delete Selected (${selectedCount})`,
                action: async () => {
                    const selectedNodeIds = this.cy!.$(':selected').nodes().map(n => n.id());
                    for (const id of selectedNodeIds) {
                        await deleteNodeFromUI(id, this.cy!);
                    }
                },
            });
        }

        return menuItems;
    }

    destroy(): void {
        ctxmenu.hide();

        if (this.cy) {
            this.cy.removeListener('cxttap');
        }

        this.cy = null;
        this.deps = null;
    }
}
