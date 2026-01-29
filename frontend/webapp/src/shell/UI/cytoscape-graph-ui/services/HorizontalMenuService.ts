/**
 * HorizontalMenuService - Hover menu lifecycle orchestration for cytoscape nodes.
 */

import type { Core, NodeSingular, Position } from 'cytoscape';
import * as O from 'fp-ts/lib/Option.js';
import { getEditorByNodeId, getHoverEditor } from "@/shell/edge/UI-edge/state/EditorStore";
import { getImageViewerByNodeId } from "@/shell/edge/UI-edge/state/ImageViewerStore";
import type { EditorData } from "@/shell/edge/UI-edge/floating-windows/editors/editorDataType";
import type { ImageViewerData } from "@/shell/edge/UI-edge/floating-windows/image-viewers/imageViewerDataType";
import { getOrCreateOverlay } from "@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows";
import { graphToScreenPosition, getWindowTransform, getTransformOrigin } from '@/pure/floatingWindowScaling';
import type { AgentConfig, VTSettings } from "@/pure/settings";
import {
    getNodeMenuItems,
    createHorizontalMenuElement,
    type HorizontalMenuItem,
} from './HorizontalMenuItems';
import { createNodeMenu, type MenuKind, type CreateNodeMenuOptions } from './createNodeMenu';
import {
    isMouseInHoverZone,
    closeHoverEditor,
} from "@/shell/edge/UI-edge/floating-windows/editors/HoverEditor";

// Re-export types for consumers
export type { SliderConfig, HorizontalMenuItem, NodeMenuItemsInput, HorizontalMenuElements } from './HorizontalMenuItems';
export { getNodeMenuItems, createHorizontalMenuElement } from './HorizontalMenuItems';
export type { MenuKind, CreateNodeMenuOptions } from './createNodeMenu';
export { createNodeMenu } from './createNodeMenu';

export class HorizontalMenuService {
    private cy: Core | null = null;
    private currentMenu: HTMLElement | null = null;
    private menuCleanup: (() => void) | null = null;
    private clickOutsideHandler: ((e: MouseEvent) => void) | null = null;

    initialize(cy: Core): void {
        this.cy = cy;
        this.setupNodeHoverMenu();
    }

    private setupNodeHoverMenu(): void {
        if (!this.cy) return;

        if (!this.cy.container()) {
            //console.log('[HorizontalMenuService] Skipping - cytoscape is in headless mode');
            return;
        }

        if (typeof document === 'undefined' || !document.body || !document.documentElement) {
            //console.log('[HorizontalMenuService] Skipping - DOM not available');
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

            // Skip hover menu if node has any editor or image viewer open (anchored or hover)
            // Both types now have traffic lights in their window chrome
            const existingEditor: O.Option<EditorData> = getEditorByNodeId(nodeId);
            if (O.isSome(existingEditor)) {
                return;
            }
            const existingImageViewer: O.Option<ImageViewerData> = getImageViewerByNodeId(nodeId);
            if (O.isSome(existingImageViewer)) {
                return;
            }

            // Use graph position (not rendered position) since menu is in the overlay
            const position: Position = node.position();

            void this.showMenu(node, position);
        });
    }

    private async showMenu(node: NodeSingular, position: {x: number; y: number}): Promise<void> {
        if (!this.cy) return;

        // Close any existing menu
        this.hideMenu();

        // Load settings to get agents list and context distance
        const settings: VTSettings | null = await window.electronAPI?.main.loadSettings() ?? null;
        const agents: readonly AgentConfig[] = settings?.agents ?? [];
        const currentDistance: number = settings?.contextNodeMaxDistance ?? 5;

        const nodeId: string = node.id();
        const isContextNode: boolean = node.data('isContextNode') === true;
        const overlay: HTMLElement = getOrCreateOverlay(this.cy);

        // Create menu using factory function
        const closeMenu: () => void = () => this.hideMenu();
        const { wrapper: menu, cleanup: menuCleanup } = createNodeMenu({
            nodeId,
            cy: this.cy,
            agents,
            isContextNode,
            currentDistance,
            menuKind: { kind: 'hover-menu', closeMenu },
        });
        this.menuCleanup = menuCleanup;

        // Add positioning styles for hover menu
        menu.className = 'cy-horizontal-context-menu';
        menu.style.position = 'absolute';
        menu.style.zIndex = '10000';

        // Store graph position for zoom updates (menu uses CSS transform scaling)
        const zoom: number = this.cy.zoom();
        menu.dataset.graphX = String(position.x);
        menu.dataset.graphY = String(position.y);
        const screenPos: { readonly x: number; readonly y: number } = graphToScreenPosition(position, zoom);
        menu.style.left = `${screenPos.x}px`;
        menu.style.top = `${screenPos.y}px`;
        menu.style.transform = getWindowTransform('css-transform', zoom, 'center');
        menu.style.transformOrigin = getTransformOrigin('center');

        overlay.appendChild(menu);
        this.currentMenu = menu;

        // Listen for close-requested event from hover editor
        menu.addEventListener('close-requested', () => {
            this.hideMenu();
        });

        // Close on mouse leave (when mouse exits the hover zone)
        const handleMouseLeave: (e: MouseEvent) => void = (e: MouseEvent): void => {
            if (!this.cy) return;
            // Get the hover editor window for zone check
            const hoverEditorOption: O.Option<EditorData> = getHoverEditor();
            const hoverEditorWindow: HTMLElement | null = O.isSome(hoverEditorOption)
                ? hoverEditorOption.value.ui?.windowElement ?? null
                : null;
            const stillInZone: boolean = isMouseInHoverZone(
                e.clientX,
                e.clientY,
                this.cy,
                nodeId,
                hoverEditorWindow
            );
            if (!stillInZone) {
                this.hideMenu();
                closeHoverEditor(this.cy);
            }
        };
        menu.addEventListener('mouseleave', handleMouseLeave);

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
        // Call cleanup function (destroys floating slider)
        this.menuCleanup?.();
        this.menuCleanup = null;

        if (this.currentMenu) {
            this.currentMenu.remove();
            this.currentMenu = null;
        }
        if (this.clickOutsideHandler) {
            document.removeEventListener('mousedown', this.clickOutsideHandler);
            this.clickOutsideHandler = null;
        }
    }

    destroy(): void {
        this.hideMenu();

        if (this.cy) {
            this.cy.removeListener('mouseover', 'node');
        }
        this.cy = null;
    }
}
