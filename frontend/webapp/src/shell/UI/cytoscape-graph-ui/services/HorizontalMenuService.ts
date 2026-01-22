/**
 * HorizontalMenuService - Hover menu lifecycle orchestration for cytoscape nodes.
 */

import type { Core, NodeSingular, Position } from 'cytoscape';
import * as O from 'fp-ts/lib/Option.js';
import { getEditorByNodeId } from "@/shell/edge/UI-edge/state/EditorStore";
import { getImageViewerByNodeId } from "@/shell/edge/UI-edge/state/ImageViewerStore";
import type { EditorData } from "@/shell/edge/UI-edge/floating-windows/editors/editorDataType";
import type { ImageViewerData } from "@/shell/edge/UI-edge/floating-windows/image-viewers/imageViewerDataType";
import { getOrCreateOverlay } from "@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows";
import { graphToScreenPosition, getWindowTransform, getTransformOrigin } from '@/pure/floatingWindowScaling';
import type { AgentConfig, VTSettings } from "@/pure/settings";
import { createTrafficLightsForTarget } from "@/shell/edge/UI-edge/floating-windows/traffic-lights";
import { destroyFloatingSlider } from './DistanceSlider';
import {
    getNodeMenuItems,
    createHorizontalMenuElement,
    type HorizontalMenuItem,
} from './HorizontalMenuItems';

// Re-export types for consumers
export type { SliderConfig, HorizontalMenuItem, NodeMenuItemsInput, HorizontalMenuElements } from './HorizontalMenuItems';
export { getNodeMenuItems, createHorizontalMenuElement } from './HorizontalMenuItems';

export class HorizontalMenuService {
    private cy: Core | null = null;
    private currentMenu: HTMLElement | null = null;
    private clickOutsideHandler: ((e: MouseEvent) => void) | null = null;

    initialize(cy: Core): void {
        this.cy = cy;
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

        // Create menu container first (transparent, just for positioning)
        // pointer-events: none so the gap in the middle allows clicking the node
        const menu: HTMLDivElement = document.createElement('div');
        menu.className = 'cy-horizontal-context-menu';
        menu.style.cssText = `
            position: absolute;
            display: flex;
            flex-direction: row;
            align-items: center;
            background: transparent;
            pointer-events: none;
            z-index: 10000;
        `;

        // Get menu items with menuAnchor and overlay for floating slider
        const menuItems: HorizontalMenuItem[] = getNodeMenuItems({
            nodeId,
            cy: this.cy,
            agents,
            isContextNode,
            currentDistance,
            menuAnchor: menu,
            overlay,
        });

        // Store graph position for zoom updates (menu uses CSS transform scaling)
        const zoom: number = this.cy.zoom();
        menu.dataset.graphX = String(position.x);
        menu.dataset.graphY = String(position.y);
        const screenPos: { readonly x: number; readonly y: number } = graphToScreenPosition(position, zoom);
        menu.style.left = `${screenPos.x}px`;
        menu.style.top = `${screenPos.y}px`;
        menu.style.transform = getWindowTransform('css-transform', zoom, 'center');
        menu.style.transformOrigin = getTransformOrigin('center');

        const closeMenu: () => void = () => this.hideMenu();

        const trafficLights: HTMLDivElement = createTrafficLightsForTarget({
            kind: 'hover-menu',
            nodeId,
            cy: this.cy,
            closeMenu,
        });

        const { leftGroup, spacer, rightGroup } = createHorizontalMenuElement(menuItems, closeMenu, trafficLights);

        // Assemble: left group, spacer, right group
        menu.appendChild(leftGroup);
        menu.appendChild(spacer);
        menu.appendChild(rightGroup);

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
        // Destroy floating slider when menu closes
        destroyFloatingSlider();

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
