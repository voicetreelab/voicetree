import type {Core} from 'cytoscape';
import ctxmenu from '@/shell/UI/lib/ctxmenu.js';
import {deleteNodeFromUI} from "@/shell/edge/UI-edge/graph/handleUIActions.ts";

export interface Position {
    x: number;
    y: number;
}

export interface VerticalMenuDependencies {
    createAnchoredFloatingEditor: (nodeId: NodeIdAndFilePath) => Promise<void>;
    handleAddNodeAtPosition: (position: Position) => Promise<void>;
}

interface VerticalMenuItem {
    text: string;
    action: () => void | Promise<void>;
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

        // Skip if cytoscape is in headless mode (no container)
        if (!this.cy.container()) {
            console.log('[VerticalMenuService] Skipping canvas context menu setup - cytoscape is in headless mode');
            return;
        }

        // Skip if DOM is not available (e.g., in test environment)
        if (typeof document === 'undefined' || !document.body || !document.documentElement) {
            console.log('[VerticalMenuService] Skipping canvas context menu setup - DOM not available');
            return;
        }

        // Handle right-click on background - show vertical menu
        this.cy.on('cxttap', (event) => {
            console.log('[VerticalMenuService] cxttap event, target:', event.target === this.cy ? 'canvas' : 'node');
            // Only handle background clicks (not nodes)
            if (event.target === this.cy) {
                const position = event.position ?? { x: 0, y: 0 };
                const renderedPosition = event.renderedPosition ?? position;

                // Get the canvas container position to calculate screen coordinates
                const container = this.cy!.container();
                if (!container) return;

                const containerRect = container.getBoundingClientRect();
                const x = containerRect.left + (renderedPosition.x ?? 0);
                const y = containerRect.top + (renderedPosition.y ?? 0);

                const menuItems = this.getCanvasVerticalMenuItems(position);
                // Create a synthetic MouseEvent for ctxmenu
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

    private getCanvasVerticalMenuItems(position: Position): VerticalMenuItem[] {
        const menuItems: VerticalMenuItem[] = [];

        // Add GraphNode Here
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

    private createChildNodeFromContextMenu(nodeId: string) {
        return async () => {
            console.log('[VerticalMenuService] adding child node to:', nodeId);
            const childId: NodeIdAndFilePath = await createNewChildNodeFromUI(nodeId, this.cy!);
            await this.deps!.createAnchoredFloatingEditor(childId);
        };
    }

    private createTerminalFromContextMenu(nodeId: string) {
        return async () => {
            await spawnTerminalWithNewContextNode(
                nodeId,
                this.cy!
            );
        };
    }

    private deleteNode(nodeId: string) {
        return async () =>  {
            try {
                // Get all selected nodes
                const selectedNodeIds = this.cy!.$(':selected').nodes().map((n) => n.id());

                // If clicked node is in selection, delete all selected nodes
                // Otherwise just delete the clicked node
                const nodesToDelete = selectedNodeIds.includes(nodeId) && selectedNodeIds.length > 1
                    ? selectedNodeIds
                    : [nodeId];

                // Delete all nodes
                for (const id of nodesToDelete) {
                    await deleteNodeFromUI(id, this.cy!);
                }
            } catch (error) {
                console.error('[VerticalMenuService] Error deleting node:', error);
                alert(`Error deleting node: ${error}`);
            }
        };
    }

    destroy(): void {
        // Hide vertical menu
        ctxmenu.hide();

        // Remove event listeners
        if (this.cy) {
            this.cy.removeListener('cxttap');
        }

        this.cy = null;
        this.deps = null;
    }
}
