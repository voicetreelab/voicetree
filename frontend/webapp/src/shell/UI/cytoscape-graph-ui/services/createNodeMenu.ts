/**
 * Factory function for creating node menus.
 * Consolidates orchestration from HorizontalMenuService.showMenu() and create-window-chrome.ts.
 */

import type { Core } from 'cytoscape';
import type { AgentConfig } from "@/pure/settings";
import type { EditorData } from "@/shell/edge/UI-edge/floating-windows/editors/editorDataType";
import { createTrafficLightsForTarget } from "@/shell/edge/UI-edge/floating-windows/traffic-lights";
import { destroyFloatingSlider } from './DistanceSlider';
import { getNodeMenuItems, createHorizontalMenuElement, type HorizontalMenuItem } from './HorizontalMenuItems';

/** Discriminated union for menu context: hover menu vs editor window chrome */
export type MenuKind =
    | {
        readonly kind: 'hover-menu';
        readonly closeMenu: () => void;
    }
    | {
        readonly kind: 'editor-window';
        readonly editor: EditorData;
        readonly closeEditor: (cy: Core, editor: EditorData) => void;
    };

/** Options for createNodeMenu factory function */
export interface CreateNodeMenuOptions {
    readonly nodeId: string;
    readonly cy: Core;
    readonly agents: readonly AgentConfig[];
    readonly isContextNode: boolean;
    readonly currentDistance?: number;
    readonly menuKind: MenuKind;
    readonly spacerWidth?: number;  // default: 35 for hover, 10 for editor
}

/**
 * Factory function to create a complete node menu with traffic lights.
 * Consolidates orchestration from HorizontalMenuService.showMenu() and create-window-chrome.ts.
 *
 * @returns wrapper element and cleanup function
 */
export function createNodeMenu(options: CreateNodeMenuOptions): {
    readonly wrapper: HTMLDivElement;
    readonly cleanup: () => void;
} {
    const { nodeId, cy, agents, isContextNode, currentDistance, menuKind, spacerWidth } = options;

    // Create wrapper div with flex layout
    // position: relative ensures slider (position: absolute) positions relative to this wrapper
    // overflow: visible ensures slider isn't clipped when it renders above the menu
    const wrapper: HTMLDivElement = document.createElement('div');
    wrapper.style.cssText = `
        position: relative;
        display: flex;
        flex-direction: row;
        align-items: center;
        background: transparent;
        pointer-events: none;
        overflow: visible;
    `;

    // Get menu items with wrapper as menuElement for slider positioning
    const menuItems: HorizontalMenuItem[] = getNodeMenuItems({
        nodeId,
        cy,
        agents,
        isContextNode,
        currentDistance,
        menuElement: wrapper,
    });

    // Create traffic lights based on menuKind
    const trafficLights: HTMLDivElement = menuKind.kind === 'hover-menu'
        ? createTrafficLightsForTarget({
            kind: 'hover-menu',
            nodeId,
            cy,
            closeMenu: menuKind.closeMenu,
        })
        : createTrafficLightsForTarget({
            kind: 'editor-window',
            editor: menuKind.editor,
            cy,
            closeEditor: menuKind.closeEditor,
        });

    // Create menu elements
    const onClose: () => void = menuKind.kind === 'hover-menu' ? menuKind.closeMenu : () => {};
    const { leftGroup, spacer, rightGroup } = createHorizontalMenuElement(menuItems, onClose, trafficLights);

    // Set spacer width: 35px for hover-menu, 10px for editor-window, or explicit value
    const defaultSpacerWidth: number = menuKind.kind === 'hover-menu' ? 35 : 10;
    spacer.style.width = `${spacerWidth ?? defaultSpacerWidth}px`;

    // Assemble wrapper
    wrapper.appendChild(leftGroup);
    wrapper.appendChild(spacer);
    wrapper.appendChild(rightGroup);

    // Cleanup function destroys floating slider
    const cleanup: () => void = (): void => {
        destroyFloatingSlider();
    };

    return { wrapper, cleanup };
}
