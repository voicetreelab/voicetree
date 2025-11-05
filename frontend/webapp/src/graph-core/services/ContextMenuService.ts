import type {Core, NodeSingular} from 'cytoscape';
// @ts-expect-error - cytoscape-cxtmenu doesn't have proper TypeScript definitions
import cxtmenu from 'cytoscape-cxtmenu';
import cytoscape from 'cytoscape';
import {CLASS_EXPANDED} from '@/graph-core/constants';
import {createNewChildNodeFromUI} from "@/functional_graph/shell/UI/handleUIActions.ts";

export interface Position {
    x: number;
    y: number;
}

// Register the extension with cytoscape
cytoscape.use(cxtmenu);

export interface ContextMenuConfig {
    onOpenEditor?: (nodeId: string) => void;
    onOpenTerminal?: (nodeId: string) => void;
    onCreateChildNode?: (node: NodeSingular) => void;
    onCollapseNode?: (node: NodeSingular) => void;
    onPinNode?: (node: NodeSingular) => void;
    onUnpinNode?: (node: NodeSingular) => void;
    onDeleteNode?: (node: NodeSingular) => void;
    onCopyNodeName?: (nodeId: string) => void;
    onAddNodeAtPosition?: (position: { x: number; y: number }) => void;
}

interface MenuCommand {
    content: string | HTMLElement;
    select: (ele: NodeSingular) => void;
    enabled: boolean;
}


export class ContextMenuService {
    private cy: Core | null = null;
    private config: ContextMenuConfig;
    private menuInstance: unknown = null;
    private canvasMenuInstance: unknown = null;
    private lastCanvasClickPosition: { x: number; y: number } | null = null;

    constructor(config: ContextMenuConfig = {}) {
        this.config = config;
    }

    initialize(cy: Core): void {
        this.cy = cy;
        this.setupContextMenu();
        this.setupCanvasContextMenu();
    }

    private setupContextMenu(): void {
        if (!this.cy) return;

        // Get theme colors from CSS variables or use defaults
        const style = getComputedStyle(document.body);
        const isDarkMode = document.documentElement.classList.contains('dark');

        const selectColor = style.getPropertyValue('--text-selection').trim() ||
            (isDarkMode ? '#3b82f6' : '#2563eb');
        const backgroundColor = style.getPropertyValue('--background-secondary').trim() ||
            (isDarkMode ? '#1f2937' : '#f3f4f6');
        const textColor = style.getPropertyValue('--text-normal').trim() ||
            (isDarkMode ? '#ffffff' : '#111827');

        const menuOptions = {
            menuRadius: 75,
            selector: 'node',
            commands: (node: NodeSingular) => this.getNodeCommands(node),
            fillColor: backgroundColor,
            activeFillColor: selectColor,
            activePadding: 20,
            indicatorSize: 24,
            separatorWidth: 3,
            spotlightPadding: 4,
            adaptativeNodeSpotlightRadius: true,
            openMenuEvents: 'cxttapstart taphold',
            itemColor: textColor,
            itemTextShadowColor: 'transparent',
            zIndex: 9999,
            atMouse: false,
            outsideMenuCancel: 10,
        };

        // @ts-expect-error - cxtmenu doesn't have proper TypeScript definitions
        this.menuInstance = this.cy.cxtmenu(menuOptions);
    }

    private setupCanvasContextMenu(): void {
        if (!this.cy) return;

        // Get theme colors from CSS variables or use defaults
        const style = getComputedStyle(document.body);
        const isDarkMode = document.documentElement.classList.contains('dark');

        const selectColor = style.getPropertyValue('--text-selection').trim() ||
            (isDarkMode ? '#3b82f6' : '#2563eb');
        const backgroundColor = style.getPropertyValue('--background-secondary').trim() ||
            (isDarkMode ? '#1f2937' : '#f3f4f6');
        const textColor = style.getPropertyValue('--text-normal').trim() ||
            (isDarkMode ? '#ffffff' : '#111827');

        // Store the canvas click position before menu opens
        this.cy.on('cxttapstart', (event) => {
            if (event.target === this.cy) {
                this.lastCanvasClickPosition = event.position;
            }
        });

        const canvasMenuOptions = {
            menuRadius: 75,
            selector: 'core', // Use 'core' selector for canvas/background
            commands: () => this.getCanvasCommands(),
            fillColor: backgroundColor,
            activeFillColor: selectColor,
            activePadding: 20,
            indicatorSize: 24,
            separatorWidth: 3,
            spotlightPadding: 4,
            minSpotlightRadius: 24,
            maxSpotlightRadius: 38,
            openMenuEvents: 'cxttapstart taphold',
            itemColor: textColor,
            itemTextShadowColor: 'transparent',
            zIndex: 9999,
            atMouse: true, // Show menu at mouse position for canvas
            outsideMenuCancel: 10,
        };

        // @ts-expect-error - cxtmenu doesn't have proper TypeScript definitions
        this.canvasMenuInstance = this.cy.cxtmenu(canvasMenuOptions);
    }

    private getCanvasCommands(): MenuCommand[] {
        const commands: MenuCommand[] = [];

        // Add Node Here
        if (this.config.onAddNodeAtPosition && this.lastCanvasClickPosition) {
            const position = this.lastCanvasClickPosition;
            commands.push({
                content: this.createSvgIcon('plus', 'Add Node Here'),
                select: () => {
                    if (this.config.onAddNodeAtPosition) {
                        this.config.onAddNodeAtPosition(position);
                    }
                },
                enabled: true,
            });
        }

        return commands;
    }

    private getNodeCommands(node: NodeSingular): MenuCommand[] {
        const commands: MenuCommand[] = [];
        const nodeId = node.id();
        const isExpanded = node.hasClass(CLASS_EXPANDED);

        // Open in Editor
        if (this.config.onOpenEditor) {
            commands.push({
                content: this.createSvgIcon('edit', 'Edit'),
                select: () => this.config.onOpenEditor?.(nodeId),
                enabled: true,
            });
        }

        // Expand/Collapse
        if (isExpanded && this.config.onCollapseNode) {
            commands.push({
                content: this.createSvgIcon('collapse', 'Collapse'),
                select: () => this.config.onCollapseNode?.(node),
                enabled: true,
            });
        } else if (!isExpanded && this.config.onCreateChildNode) {
            commands.push({
                content: this.createSvgIcon('expand', 'Expand'),
                select: () => this.config.onCreateChildNode?.(node),
                enabled: true,
            });
        }

        // Terminal (replaces Pin/Unpin)
        if (this.config.onOpenTerminal) {
            commands.push({
                content: this.createSvgIcon('terminal', 'Terminal'),
                select: () => this.config.onOpenTerminal?.(nodeId),
                enabled: true,
            });
        }

        // Delete node
        if (this.config.onDeleteNode) {
            commands.push({
                content: this.createSvgIcon('trash', 'Delete'),
                select: () => this.config.onDeleteNode?.(node),
                enabled: true,
            });
        }

        // Copy name
        if (this.config.onCopyNodeName) {
            commands.push({
                content: this.createSvgIcon('copy', 'Copy'),
                select: () => this.config.onCopyNodeName?.(nodeId),
                enabled: true,
            });
        }

        return commands;
    }

    private createSvgIcon(type: string, tooltip: string): HTMLElement {
        const div = document.createElement('div');
        div.style.width = '24px';
        div.style.height = '24px';
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.justifyContent = 'center';
        div.title = tooltip;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '20');
        svg.setAttribute('height', '20');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');

        const paths: Record<string, string> = {
            edit: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z',
            expand: 'M12 5v14 M5 12h14',
            collapse: 'M5 12h14',
            plus: 'M12 5v14 M5 12h14',
            pin: 'M12 17v5 M9 10.76a7 7 0 1 0 6 0 M12 2v8',
            unlock: 'M7 11V7a5 5 0 0 1 9.9-1 M3 11h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V11z',
            hide: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
            copy: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2 M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z',
            terminal: 'M4 17l6-6-6-6 M12 19h8',
            trash: 'M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14'
        };

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', paths[type] || paths.edit);
        svg.appendChild(path);
        div.appendChild(svg);

        return div;
    }

    destroy(): void {
        if (this.menuInstance && typeof this.menuInstance.destroy === 'function') {
            this.menuInstance.destroy();
        }
        if (this.canvasMenuInstance && typeof this.canvasMenuInstance.destroy === 'function') {
            this.canvasMenuInstance.destroy();
        }
        this.menuInstance = null;
        this.canvasMenuInstance = null;
        this.lastCanvasClickPosition = null;
        this.cy = null;
    }

    updateConfig(config: Partial<ContextMenuConfig>): void {
        this.config = {...this.config, ...config};
        // Reinitialize menu with new config if cy is available
        if (this.cy) {
            // Destroy existing menu instance
            if (this.menuInstance && typeof this.menuInstance.destroy === 'function') {
                this.menuInstance.destroy();
                this.menuInstance = null;
            }
            // Create new menu with updated config
            this.setupContextMenu();
        }
    }

    /**
     * Setup context menu callbacks for node interactions
     * This configures the high-level behavior when context menu items are selected
     */
    setupContextMenuCallbacks(callbacks: ContextMenuConfig): void {
        this.updateConfig(callbacks);
    }

    /**
     * Get the context menu service instance from a Core
     */
    static getInstance(cy: Core): ContextMenuService | null {
        // Access the private contextMenuService from CytoscapeCore
        // This is a workaround since we can't directly access it
        return (cy as any).__contextMenuService || null;
    }

    /**
     * Store the instance on the Core for later retrieval
     */
    static setInstance(cy: Core, service: ContextMenuService): void {
        (cy as any).__contextMenuService = service;
    }

    /**
     * Setup context menu for node interactions
     * Moved from FloatingWindowManager to centralize context menu logic
     */
    static setupContextMenu(
        cy: Core, // CytoscapeCore with enableContextMenu method
        deps: {
            getGraph: () => import('@/functional_graph/pure/types').Graph;
            getContentForNode: (nodeId: string) => string | undefined;
            getFilePathForNode: (nodeId: string) => string | undefined;
            getVaultPath: () => string | undefined;
            createFloatingEditor: (nodeId: string, filePath: string, content: string, pos: Position) => void;
            extractNodeIdFromPath: (filePath: string) => string;
            createFloatingTerminal: (nodeId: string, metadata: any, pos: Position) => void;
            handleAddNodeAtPosition: (position: Position) => Promise<void>;
        }
    ): void {
        cy.enableContextMenu({
            onOpenEditor: (nodeId: string) => {
                const content = deps.getContentForNode(nodeId);
                const filePath = deps.getFilePathForNode(nodeId);

                if (content && filePath) {
                    const node = cy.getCore().getElementById(nodeId);
                    if (node.length > 0) {
                        const pos = node.position();
                        deps.createFloatingEditor(nodeId, filePath, content, pos);
                    }
                }
            },
            onCreateChildNode: (node: NodeSingular) => {
                const nodeId = node.id();
                console.log('[ContextMenuService] adding child node to:', nodeId);
                createNewChildNodeFromUI(nodeId, cy);
            },
            onDeleteNode: async (node: NodeSingular) => {
                const nodeId = node.id();
                const filePath = deps.getFilePathForNode(nodeId);

                if (filePath && (window as any).electronAPI?.deleteFile) {
                    if (!confirm(`Are you sure you want to delete "${nodeId}"? This will move the file to trash.`)) {
                        return;
                    }

                    try {
                        const result = await (window as any).electronAPI.deleteFile(filePath);
                        if (result.success) {
                            // Graph will handle the delete event from the file watcher
                            cy.hideNode(node);
                        } else {
                            console.error('[ContextMenuService] Failed to delete file:', result.error);
                            alert(`Failed to delete file: ${result.error}`);
                        }
                    } catch (error) {
                        console.error('[ContextMenuService] Error deleting file:', error);
                        alert(`Error deleting file: ${error}`);
                    }
                }
            },
            onOpenTerminal: (nodeId: string) => {
                const filePath = deps.getFilePathForNode(nodeId);
                const nodeMetadata = {
                    id: nodeId,
                    name: nodeId.replace(/_/g, ' '),
                    filePath: filePath
                };

                const node = cy.getCore().getElementById(nodeId);
                if (node.length > 0) {
                    const nodePos = node.position();
                    deps.createFloatingTerminal(nodeId, nodeMetadata, nodePos);
                }
            },
            onCopyNodeName: (nodeId: string) => {
                const absolutePath = deps.getFilePathForNode(nodeId);
                navigator.clipboard.writeText(absolutePath || nodeId);
            },
            onAddNodeAtPosition: async (position: Position) => {
                console.log('[ContextMenuService] Creating node at position:', position);
                await deps.handleAddNodeAtPosition(position);
            }
        });
    }

}