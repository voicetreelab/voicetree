import type {Core, NodeSingular} from 'cytoscape';
// @ts-expect-error - cytoscape-cxtmenu doesn't have proper TypeScript definitions
import cxtmenu from 'cytoscape-cxtmenu';
import cytoscape from 'cytoscape';
import {createNewChildNodeFromUI, deleteNodesFromUI} from "@/shell/edge/UI-edge/graph/handleUIActions";
import {
    spawnTerminalWithNewContextNode
} from "@/shell/edge/UI-edge/floating-windows/terminals/spawnTerminalWithCommandFromUI";
import {createAnchoredFloatingEditor} from "@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD";
import {getFilePathForNode} from "@/shell/edge/UI-edge/graph/getNodeFromMainToUI";

// Register the extension with cytoscape
cytoscape.use(cxtmenu);

interface RadialMenuCommand {
    content: string | HTMLElement;
    select: (ele: NodeSingular) => void | Promise<void>;
    enabled: boolean;
}

export class RadialMenuService {
    private cy: Core | null = null;
    private radialMenuInstance: unknown = null;

    initialize(cy: Core): void {
        this.cy = cy;
        this.setupRadialMenuOnHover();
        this.setupMenuCloseOnMouseLeave();
    }

    private setupRadialMenuOnHover(): void {
        if (!this.cy) return;

        // Skip if cytoscape is in headless mode (no container)
        if (!this.cy.container()) {
            console.log('[RadialMenuService] Skipping radial menu setup - cytoscape is in headless mode');
            return;
        }

        // Skip if DOM is not available (e.g., in test environment)
        if (typeof document === 'undefined' || !document.body || !document.documentElement) {
            console.log('[RadialMenuService] Skipping radial menu setup - DOM not available');
            return;
        }

        // Get theme colors from CSS variables or use defaults
        const style: CSSStyleDeclaration = getComputedStyle(document.body);
        const isDarkMode: boolean = document.documentElement.classList.contains('dark');

        const selectColor: string = style.getPropertyValue('--text-selection').trim() ||
            (isDarkMode ? '#3b82f6' : '#2563eb');
        const backgroundColor: string = style.getPropertyValue('--background-secondary').trim() ||
            (isDarkMode ? '#1f2937' : '#f3f4f6');
        const textColor: string = style.getPropertyValue('--text-normal').trim() ||
            (isDarkMode ? '#ffffff' : '#111827');

        const menuOptions: { menuRadius: number; selector: string; commands: (node: NodeSingular) => RadialMenuCommand[]; fillColor: string; activeFillColor: string; activePadding: number; indicatorSize: number; separatorWidth: number; spotlightPadding: number; adaptativeNodeSpotlightRadius: boolean; openMenuEvents: string; itemColor: string; itemTextShadowColor: string; zIndex: number; atMouse: boolean; outsideMenuCancel: number; } = {
            menuRadius: 75,
            selector: 'node',
            commands: (node: NodeSingular) => this.getRadialMenuCommands(node),
            fillColor: backgroundColor,
            activeFillColor: selectColor,
            activePadding: 20,
            indicatorSize: 24,
            separatorWidth: 3,
            spotlightPadding: 4,
            adaptativeNodeSpotlightRadius: true,
            openMenuEvents: 'mouseover', // Radial menu on hover
            itemColor: textColor,
            itemTextShadowColor: 'transparent',
            zIndex: 9999,
            atMouse: false,
            outsideMenuCancel: 10,
        };

        // @ts-expect-error - cxtmenu doesn't have proper TypeScript definitions
        this.radialMenuInstance = this.cy.cxtmenu(menuOptions);
    }

    private setupMenuCloseOnMouseLeave(): void {
        if (!this.cy) return;

        // Close radial menu when mouse moves to background (not over any node)
        this.cy.on('mouseover', (event) => {
            if (event.target === this.cy) {
                const menuCanvas: HTMLElement | null = document.querySelector('.cxtmenu-canvas') as HTMLElement | null;
                if (menuCanvas) {
                    menuCanvas.style.display = 'none';
                }
            }
        });
    }

    private getRadialMenuCommands(node: NodeSingular): RadialMenuCommand[] {
        if (!this.cy) return [];

        const commands: RadialMenuCommand[] = [];
        const nodeId: string = node.id();
        const cy: Core = this.cy;

        // Open in Editor
        commands.push({
            content: this.createSvgIcon('edit', 'Edit'),
            select: async () => {
                await createAnchoredFloatingEditor(cy, nodeId);
            },
            enabled: true,
        });

        // Create child node
        commands.push({
            content: this.createSvgIcon('expand', 'Create Child'),
            select: this.createChildNodeFromContextMenu(nodeId),
            enabled: true,
        });

        // Terminal
        commands.push({
            content: this.createSvgIcon('terminal', 'Terminal'),
            select: this.createTerminalFromContextMenu(nodeId),
            enabled: true,
        });

        // Delete node(s) - shows count when multiple nodes are selected
        const selectedCount: number = this.cy.$(':selected').nodes().size();
        const deleteLabel: string = selectedCount > 1 ? `Delete (${selectedCount})` : 'Delete';
        commands.push({
            content: this.createSvgIcon('trash', deleteLabel),
            select: this.deleteNode(nodeId),
            enabled: true,
        });

        // Copy path
        commands.push({
            content: this.createSvgIcon('copy', 'Copy'),
            select: () => {
                const absolutePath: string = getFilePathForNode(nodeId);
                void navigator.clipboard.writeText(absolutePath);
            },
            enabled: true,
        });

        return commands;
    }

    private createChildNodeFromContextMenu(nodeId: string) {
        return async () => {
            console.log('[RadialMenuService] adding child node to:', nodeId);
            // Editor auto-pinning handled by file watcher in VoiceTreeGraphView
            await createNewChildNodeFromUI(nodeId, this.cy!);
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
                const selectedNodeIds: string[] = this.cy!.$(':selected').nodes().map((n) => n.id());

                // If clicked node is in selection, delete all selected nodes
                // Otherwise just delete the clicked node
                const nodesToDelete: string[] = selectedNodeIds.includes(nodeId) && selectedNodeIds.length > 1
                    ? selectedNodeIds
                    : [nodeId];

                await deleteNodesFromUI(nodesToDelete, this.cy!);
            } catch (error) {
                console.error('[RadialMenuService] Error deleting node:', error);
                alert(`Error deleting node: ${error}`);
            }
        };
    }

    private createSvgIcon(type: string, tooltip: string): HTMLElement {
        // Defensive check for DOM availability
        if (typeof document === 'undefined') {
            // Return a minimal placeholder in non-DOM environments
            return {textContent: type} as HTMLElement;
        }

        const div: HTMLDivElement = document.createElement('div');
        div.style.width = '24px';
        div.style.height = '24px';
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.justifyContent = 'center';
        div.title = tooltip;

        const svg: SVGSVGElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
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

        const path: SVGPathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', paths[type] || paths.edit);
        svg.appendChild(path);
        div.appendChild(svg);

        return div;
    }

    destroy(): void {
        // Destroy radial menu instance
        if (this.radialMenuInstance && typeof (this.radialMenuInstance as Record<string, unknown>).destroy === 'function') {
            (this.radialMenuInstance as { destroy: () => void }).destroy();
        }

        // Remove event listeners
        if (this.cy) {
            this.cy.removeListener('mouseover');
        }

        this.radialMenuInstance = null;
        this.cy = null;
    }
}
