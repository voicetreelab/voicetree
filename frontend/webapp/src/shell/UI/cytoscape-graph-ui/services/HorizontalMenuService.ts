import type {Core, NodeSingular} from 'cytoscape';
import type {NodeIdAndFilePath} from "@/pure/graph";
import {createNewChildNodeFromUI, deleteNodeFromUI} from "@/shell/edge/UI-edge/graph/handleUIActions";
import {
    spawnTerminalWithNewContextNode
} from "@/shell/edge/UI-edge/floating-windows/terminals/spawnTerminalWithCommandFromUI";
import {getFilePathForNode, getNodeFromMainToUI} from "@/shell/edge/UI-edge/graph/getNodeFromMainToUI";
import {type MenuItem, showCtxMenu} from "./VerticalMenuService";
import {Plus, Play, Trash2, Pencil, Clipboard, MoreHorizontal, createElement, type IconNode} from 'lucide';

/** Render a Lucide icon to HTML string with optional color */
function iconHtml(icon: IconNode, label: string, color?: string): string {
    const svgElement: SVGElement = createElement(icon);
    svgElement.setAttribute('width', '16');
    svgElement.setAttribute('height', '16');
    if (color) svgElement.setAttribute('stroke', color);
    const labelHtml: string = label ? `<span style="font-size:11px">${label}</span>` : '';
    return `<span style="display:inline-flex;flex-direction:column;align-items:center;gap:2px"><span>${svgElement.outerHTML}</span>${labelHtml}</span>`;
}

export interface HorizontalMenuDependencies {
    createAnchoredFloatingEditor: (nodeId: NodeIdAndFilePath) => Promise<void>;
}

export class HorizontalMenuService {
    private cy: Core | null = null;
    private deps: HorizontalMenuDependencies | null = null;

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
            const renderedPosition: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/node_modules/cytoscape/index").Position = event.renderedPosition ?? event.position ?? {x: 0, y: 0};

            const container: HTMLElement | null = this.cy!.container();
            if (!container) return;

            const containerRect: DOMRect = container.getBoundingClientRect();
            const x: number = containerRect.left + (renderedPosition.x ?? 0);
            const y: number = containerRect.top + (renderedPosition.y ?? 0) - 40; // Position above node

            const menuItems: MenuItem[] = this.getNodeMenuItems(node);
            const syntheticEvent: MouseEvent = new MouseEvent('contextmenu', {
                clientX: x,
                clientY: y,
                bubbles: true,
                cancelable: true,
            });
            showCtxMenu(menuItems, syntheticEvent, 'horizontal');
        });

        // Hide menu when mouse leaves node and goes to background
        this.cy.on('mouseover', (event) => {
            if (event.target === this.cy) {
                // Use dynamic import to avoid circular dependency
                void import('@/shell/UI/lib/ctxmenu.js').then(module => {
                    module.default.hide();
                });
            }
        });
    }

    private getNodeMenuItems(node: NodeSingular): MenuItem[] {
        if (!this.cy || !this.deps) return [];

        const menuItems: MenuItem[] = [];
        const nodeId: string = node.id();

        menuItems.push(
            {
                html: iconHtml(Clipboard, 'Copy Path'),
                action:
                    async () => {
                        const absolutePath: string | undefined = await getFilePathForNode(nodeId);
                        void navigator.clipboard.writeText(absolutePath ?? nodeId);
                    },

            });

        menuItems.push({
            html: iconHtml(Plus, 'Add'),
            action: async () => {
                const childId: NodeIdAndFilePath = await createNewChildNodeFromUI(nodeId, this.cy!);
                await this.deps!.createAnchoredFloatingEditor(childId);
            },
        });

        menuItems.push({
            html: iconHtml(Play, 'Run', '#22c55e'), // green
            action: async () => {
                await spawnTerminalWithNewContextNode(nodeId, this.cy!);
            },
        });



        const selectedCount: number = this.cy.$(':selected').nodes().size();
        const deleteLabel: string = selectedCount > 1 ? `Delete (${selectedCount})` : 'Delete';
        menuItems.push({
            html: iconHtml(Trash2, deleteLabel),
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
        const moreSubMenu: { html: string; action: () => Promise<void>; }[] = [
            {
                html: iconHtml(Pencil, 'Pin Editor'),
                action: async () => {
                    await this.deps!.createAnchoredFloatingEditor(nodeId);
                },
            },

            {
                html: iconHtml(Clipboard, 'Copy Content'),
                action: async () => {
                    const absolutePath: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").GraphNode = await getNodeFromMainToUI(nodeId);
                    void navigator.clipboard.writeText(absolutePath.contentWithoutYamlOrLinks);
                },
            },
        ];
        menuItems.push({
            html: iconHtml(MoreHorizontal, 'More'),
            subMenu: moreSubMenu,
        });

        return menuItems;
    }

    destroy(): void {
        // Hide menu
        void import('@/shell/UI/lib/ctxmenu.js').then(module => {
            module.default.hide();
        });

        if (this.cy) {
            this.cy.removeListener('mouseover', 'node');
            this.cy.removeListener('mouseover');
        }
        this.cy = null;
        this.deps = null;
    }
}
