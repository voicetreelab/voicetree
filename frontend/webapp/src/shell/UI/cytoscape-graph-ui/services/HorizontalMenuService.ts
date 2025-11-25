import type {Core, NodeSingular} from 'cytoscape';
import type {NodeIdAndFilePath} from "@/pure/graph";
import {createNewChildNodeFromUI, deleteNodeFromUI} from "@/shell/edge/UI-edge/graph/handleUIActions.ts";
import {spawnTerminalWithNewContextNode} from "@/shell/edge/UI-edge/floating-windows/terminals/spawnTerminalWithCommandFromUI.ts";
import {getFilePathForNode} from "@/shell/edge/UI-edge/graph/getNodeFromMainToUI.ts";
import {type MenuItem, showCtxMenu} from "./VerticalMenuService.ts";

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

        // TODO: Replace radial menu with horizontal menu on node hover
        // this.cy.on('mouseover', 'node', (event) => { ... });
    }

    /** Get menu items for a node - can be used by other services */
    getNodeMenuItems(node: NodeSingular): MenuItem[] {
        if (!this.cy || !this.deps) return [];

        const menuItems: MenuItem[] = [];
        const nodeId = node.id();

        menuItems.push({
            text: 'Edit',
            action: async () => {
                await this.deps!.createAnchoredFloatingEditor(nodeId);
            },
        });

        menuItems.push({
            text: 'Create Child',
            action: async () => {
                const childId: NodeIdAndFilePath = await createNewChildNodeFromUI(nodeId, this.cy!);
                await this.deps!.createAnchoredFloatingEditor(childId);
            },
        });

        menuItems.push({
            text: 'Terminal',
            action: async () => {
                await spawnTerminalWithNewContextNode(nodeId, this.cy!);
            },
        });

        const selectedCount = this.cy.$(':selected').nodes().size();
        const deleteLabel = selectedCount > 1 ? `Delete (${selectedCount})` : 'Delete';
        menuItems.push({
            text: deleteLabel,
            action: async () => {
                const selectedNodeIds = this.cy!.$(':selected').nodes().map((n) => n.id());
                const nodesToDelete = selectedNodeIds.includes(nodeId) && selectedNodeIds.length > 1
                    ? selectedNodeIds
                    : [nodeId];
                for (const id of nodesToDelete) {
                    await deleteNodeFromUI(id, this.cy!);
                }
            },
        });

        menuItems.push({
            text: 'Copy Path',
            action: async () => {
                const absolutePath = await getFilePathForNode(nodeId);
                void navigator.clipboard.writeText(absolutePath ?? nodeId);
            },
        });

        return menuItems;
    }

    /** Show horizontal menu at position */
    showHorizontalMenu(items: MenuItem[], event: MouseEvent): void {
        showCtxMenu(items, event, 'horizontal');
    }

    destroy(): void {
        if (this.cy) {
            this.cy.removeListener('mouseover', 'node');
        }
        this.cy = null;
        this.deps = null;
    }
}
