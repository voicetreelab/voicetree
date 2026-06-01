import type {Core, NodeCollection, Position as CyPosition, EventObject, NodeSingular} from 'cytoscape';
import ctxmenu from '@/shell/UI/lib/ctxmenu.js';
import {mergeSelectedNodesFromUI} from "@/shell/edge/UI-edge/graph/actions/mergeSelectedNodesFromUI";
import {extractIntoFolderFromUI} from "@/shell/edge/UI-edge/graph/actions/extractIntoFolderFromUI";
import {deleteSelectedNodesAction} from "@/shell/UI/cytoscape-graph-ui/actions/graphActions";
import {getNextTerminalCount, getTerminals} from "@/shell/edge/UI-edge/state/stores/TerminalStore";
import type {TerminalId} from "@/shell/edge/UI-edge/floating-windows/anchoring/types";
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import {showTaskInputPopup, type SelectedNodeInfo, type TaskInputResult} from "@/shell/edge/UI-edge/graph/popups/taskInputPopup";
import {showExtractIntoFolderPopup, type ExtractIntoFolderSelectedNode} from "@/shell/edge/UI-edge/graph/popups/extractIntoFolderPopup";
import type {NodeIdAndFilePath} from "@vt/graph-model/graph";
import {getExtractIntoFolderSelectionSupport} from "@vt/graph-model/graph";
import {flushEditorForNode} from "@/shell/edge/UI-edge/floating-windows/editors/flushEditorForNode";
import '@/shell/electron.d.ts';
import { formatShortcut } from '@vt/graph-model/utils';
import { getShortcutPlatform } from '@/shell/UI/platform/shortcutPlatform';

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

export class VerticalMenuService {
    private cy: Core | null = null;
    private deps: VerticalMenuDependencies | null = null;
    private ctrlClickHandler: ((event: EventObject) => void) | null = null;

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

        // Handle right-click on background or input-inert folder body - show vertical menu
        this.cy.on('cxttap', (event) => {
            if (shouldShowCanvasMenuForTarget(event.target, this.cy!)) {
                this.showCanvasMenu(
                    event.position ?? { x: 0, y: 0 },
                    event.renderedPosition ?? event.position ?? { x: 0, y: 0 },
                );
            }
        });

        // Handle ctrl+click on background or input-inert folder body as right-click
        this.ctrlClickHandler = (event: EventObject) => {
            if (shouldShowCanvasMenuForTarget(event.target, this.cy!) && event.originalEvent?.ctrlKey) {
                this.showCanvasMenu(
                    event.position ?? { x: 0, y: 0 },
                    event.renderedPosition ?? event.position ?? { x: 0, y: 0 },
                );
            }
        };
        this.cy.on('tap', this.ctrlClickHandler);
    }

    private showCanvasMenu(position: CyPosition, renderedPosition: CyPosition): void {
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

    private getCanvasVerticalMenuItems(position: Position): MenuItem[] {
        const menuItems: MenuItem[] = [];

        // Check if click position is inside a folder node's bounding box
        const folderAtPosition: NodeSingular = (this.cy!.nodes('[?isFolderNode]') as NodeCollection).filter(node => {
            const bb: ReturnType<NodeSingular['boundingBox']> = node.boundingBox()
            return position.x >= bb.x1 && position.x <= bb.x2 && position.y >= bb.y1 && position.y <= bb.y2
        }).sort((a, b) => (b as NodeSingular).ancestors().length - (a as NodeSingular).ancestors().length).first() as NodeSingular

        if (folderAtPosition.length) {
            const folderId: string = folderAtPosition.id()
            const folderLabel: string = folderAtPosition.data('folderLabel') as string
            menuItems.push(
                {
                    text: `Expand "${folderLabel}"`,
                    action: async () => {
                        const { expandFolder } = await import('@/shell/edge/UI-edge/graph/view/folderCollapse')
                        void expandFolder(this.cy!, folderId)
                    },
                },
                {
                    text: `Collapse "${folderLabel}"`,
                    action: async () => {
                        const { collapseFolder } = await import('@/shell/edge/UI-edge/graph/view/folderCollapse')
                        void collapseFolder(this.cy!, folderId)
                    },
                },
                {
                    text: `Hide "${folderLabel}"`,
                    action: async () => {
                        const { hideFolder } = await import('@/shell/edge/UI-edge/graph/view/folderCollapse')
                        void hideFolder(this.cy!, folderId)
                    },
                },
            )
        }

        const shortcutPlatform = getShortcutPlatform();

        if (this.deps) {
            menuItems.push({
                html: `<span style="display: flex; justify-content: space-between; align-items: center; gap: 16px; white-space: nowrap;">Add Node Here <span style="font-size: 10px; color: #888; opacity: 0.7;">${formatShortcut('N', shortcutPlatform)}</span></span>`,
                action: async () => {
                    //console.log('[VerticalMenuService] Creating node at position:', position);
                    await this.deps!.handleAddNodeAtPosition(position);
                },
            });
        }

        // Selection-based actions - always show but disable when no nodes selected
        const selectedNodes = this.cy!.$(':selected').nodes();
        const selectedCount: number = selectedNodes.size();
        const noNodesSelected: boolean = selectedCount === 0;
        const selectedGraphItemIds: readonly NodeIdAndFilePath[] = typeof selectedNodes.map === 'function'
            ? selectedNodes
                .map((node) => node.data('isShadowNode') ? null : node.id() as NodeIdAndFilePath)
                .filter((nodeId): nodeId is NodeIdAndFilePath => nodeId !== null)
            : []
        const extractSupport = getExtractIntoFolderSelectionSupport(selectedGraphItemIds)

        const deleteText: string = noNodesSelected ? 'Delete (0 nodes selected)' : `Delete Selected (${selectedCount})`;
        menuItems.push({
            html: `<span style="display: flex; justify-content: space-between; align-items: center; gap: 16px; white-space: nowrap;">${deleteText} <span style="font-size: 10px; color: #888; opacity: 0.7;">${formatShortcut('Backspace', shortcutPlatform)}</span></span>`,
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

        const extractMenuText: string = !extractSupport.canExtract || extractSupport.selectionsShareParent
            ? 'Extract Into Folder'
            : `Extract into subfolder at common ancestor: ${formatAncestorForDisplay(extractSupport.commonParentPath)}`;
        menuItems.push({
            text: extractMenuText,
            disabled: !extractSupport.canExtract,
            action: async () => {
                if (!extractSupport.canExtract) return;
                if (extractSupport.selectionsShareParent) {
                    await extractIntoFolderFromUI(selectedGraphItemIds, this.cy!);
                    return;
                }
                const selectedNodesForPopup: readonly ExtractIntoFolderSelectedNode[] = selectedGraphItemIds.map((nodeId) => {
                    const cyNode = this.cy!.getElementById(nodeId);
                    const title: string = (cyNode?.data('label') as string) ?? nodeId;
                    return {
                        id: nodeId,
                        title,
                        parentFolderDisplay: formatAncestorForDisplay(getImmediateParentFolderForDisplay(nodeId)),
                    };
                });
                const result = await showExtractIntoFolderPopup({
                    selectedNodes: selectedNodesForPopup,
                    commonAncestorDisplay: formatAncestorForDisplay(extractSupport.commonParentPath),
                    defaultFolderName: 'extracted',
                });
                if (!result) return;
                await extractIntoFolderFromUI(selectedGraphItemIds, this.cy!, result.folderName);
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
                    await Promise.all(selectedNodeIds.map(nodeId => flushEditorForNode(nodeId)));
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
                await window.electronAPI?.main.spawnPlainTerminalWithNode({ position, terminalCount });
            },
        });

        return menuItems;
    }

    destroy(): void {
        ctxmenu.hide();

        if (this.cy) {
            this.cy.removeListener('cxttap');
            if (this.ctrlClickHandler) {
                this.cy.off('tap', this.ctrlClickHandler);
            }
        }

        this.ctrlClickHandler = null;
        this.cy = null;
        this.deps = null;
    }
}

function formatAncestorForDisplay(folderPath: string | null): string {
    if (folderPath === null || folderPath === '' || folderPath === '/') {
        return '(root)';
    }
    return folderPath;
}

function getImmediateParentFolderForDisplay(nodeId: string): string | null {
    const trimmed: string = nodeId.endsWith('/') ? nodeId.slice(0, -1) : nodeId;
    const lastSlash: number = trimmed.lastIndexOf('/');
    return lastSlash === -1 ? null : trimmed.slice(0, lastSlash + 1);
}

function shouldShowCanvasMenuForTarget(target: EventObject['target'], cy: Core): boolean {
    if (target === cy) return true;
    return typeof target?.data === 'function' && target.data('isFolderNode') === true;
}
