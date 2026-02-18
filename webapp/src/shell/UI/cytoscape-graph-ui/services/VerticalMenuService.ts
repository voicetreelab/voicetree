import type {Core, Position as CyPosition} from 'cytoscape';
import ctxmenu from '@/shell/UI/lib/ctxmenu.js';
import {mergeSelectedNodesFromUI} from "@/shell/edge/UI-edge/graph/mergeSelectedNodesFromUI";
import {deleteSelectedNodesAction} from "@/shell/UI/cytoscape-graph-ui/actions/graphActions";
import {getNextTerminalCount, getTerminals} from "@/shell/edge/UI-edge/state/TerminalStore";
import type {TerminalId} from "@/shell/edge/UI-edge/floating-windows/types";
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import {showTaskInputPopup, type SelectedNodeInfo, type TaskInputResult} from "@/shell/edge/UI-edge/graph/taskInputPopup";
import type {NodeIdAndFilePath} from "@/pure/graph";
import '@/shell/electron.d.ts';
import { formatShortcut } from '@/pure/utils/keyboardShortcutDisplay';

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
    disabled?: boolean;
}

/** Helper to show menu with optional direction config */
export function showCtxMenu(
    items: MenuItem[],
    event: MouseEvent,
    direction: 'vertical' | 'horizontal' = 'vertical'
): void {
    const config: { attributes: { class: string; }; onShow: (menu: HTMLElement) => void; } | { attributes?: undefined; onShow?: undefined; } = direction === 'horizontal'
        ? {
            attributes: { class: 'ctxmenu horizontal' },
            // Center horizontal menu after rendering (can't use CSS transform - breaks submenu positioning)
            onShow: (menu: HTMLElement) => {
                const menuWidth: number = menu.offsetWidth;
                const currentLeft: number = parseFloat(menu.style.left) || 0;
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
            //console.log('[VerticalMenuService] Skipping canvas context menu setup - cytoscape is in headless mode');
            return;
        }

        if (typeof document === 'undefined' || !document.body || !document.documentElement) {
            //console.log('[VerticalMenuService] Skipping canvas context menu setup - DOM not available');
            return;
        }

        // Handle right-click on background - show vertical menu
        this.cy.on('cxttap', (event) => {
            if (event.target === this.cy) {
                const position: CyPosition = event.position ?? { x: 0, y: 0 };
                const renderedPosition: CyPosition = event.renderedPosition ?? position;

                const container: HTMLElement | null = this.cy!.container();
                if (!container) return;

                const containerRect: DOMRect = container.getBoundingClientRect();
                const x: number = containerRect.left + (renderedPosition.x ?? 0);
                const y: number = containerRect.top + (renderedPosition.y ?? 0);

                const menuItems: MenuItem[] = this.getCanvasVerticalMenuItems(position);
                const syntheticEvent: MouseEvent = new MouseEvent('contextmenu', {
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
                html: `<span style="display: flex; justify-content: space-between; align-items: center; gap: 16px; white-space: nowrap;">Add Node Here <span style="font-size: 10px; color: #888; opacity: 0.7;">${formatShortcut('N')}</span></span>`,
                action: async () => {
                    //console.log('[VerticalMenuService] Creating node at position:', position);
                    await this.deps!.handleAddNodeAtPosition(position);
                },
            });
        }

        // Selection-based actions - always show but disable when no nodes selected
        const selectedCount: number = this.cy!.$(':selected').nodes().size();
        const noNodesSelected: boolean = selectedCount === 0;

        const deleteText: string = noNodesSelected ? 'Delete (0 nodes selected)' : `Delete Selected (${selectedCount})`;
        menuItems.push({
            html: `<span style="display: flex; justify-content: space-between; align-items: center; gap: 16px; white-space: nowrap;">${deleteText} <span style="font-size: 10px; color: #888; opacity: 0.7;">${formatShortcut('Backspace')}</span></span>`,
            disabled: noNodesSelected,
            action: deleteSelectedNodesAction(this.cy!),
        });

        // Merge selected nodes - always show but disable when less than 2 nodes selected
        const cannotMerge: boolean = selectedCount < 2;
        menuItems.push({
            text: cannotMerge
                ? (noNodesSelected ? 'Merge (0 nodes selected)' : `Merge (${selectedCount} node selected)`)
                : `Merge Selected (${selectedCount})`,
            disabled: cannotMerge,
            action: async () => {
                if (cannotMerge) return;
                const selectedNodeIds: string[] = this.cy!.$(':selected').nodes().map(n => n.id());
                await mergeSelectedNodesFromUI(selectedNodeIds, this.cy!);
            },
        });

        // Run Agent on Selected - always show but disable when no nodes selected
        const runAgentText: string = noNodesSelected
            ? 'Run Agent on Selected (0 nodes selected)'
            : `Run Agent on Selected (${selectedCount})`;
        menuItems.push({
            text: runAgentText,
            disabled: noNodesSelected,
            action: async () => {
                if (noNodesSelected) return;

                // Get selected node IDs and titles for popup
                const selectedNodes: SelectedNodeInfo[] = this.cy!.$(':selected').nodes().map((node): SelectedNodeInfo => {
                    const id: string = node.id();
                    const title: string = (node.data('label') as string) ?? id;
                    return { id, title };
                });

                // Show task input popup
                const result: TaskInputResult | null = await showTaskInputPopup(selectedNodes);
                if (!result) {
                    // User cancelled
                    return;
                }

                // Call main process to create task node, context node, and spawn agent
                const selectedNodeIds: NodeIdAndFilePath[] = selectedNodes.map(
                    (n: SelectedNodeInfo) => n.id as NodeIdAndFilePath
                );

                try {
                    await window.electronAPI?.main.runAgentOnSelectedNodes({
                        selectedNodeIds,
                        taskDescription: result.taskDescription,
                        position,
                    });
                } catch (error: unknown) {
                    console.error('[VerticalMenuService] Failed to run agent on selected nodes:', error);
                }
            },
        });

        // Terminal icon SVG (Lucide Terminal icon)
        const terminalIcon: string = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>';
        menuItems.push({
            html: `<span style="display: flex; align-items: center; gap: 8px; white-space: nowrap;">${terminalIcon} Plain Terminal</span>`,
            action: async () => {
                const terminalsMap: Map<TerminalId, TerminalData> = getTerminals();
                const terminalCount: number = getNextTerminalCount(terminalsMap, 'plain-terminal');
                await window.electronAPI?.main.spawnPlainTerminalWithNode(position, terminalCount);
            },
        });

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
