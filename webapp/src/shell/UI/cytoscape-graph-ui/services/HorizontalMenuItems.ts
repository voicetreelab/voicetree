/**
 * Horizontal menu assembly — creates the left/right pill groups with traffic lights.
 * Re-exports types, DOM utilities, and business logic from extracted modules
 * so existing consumers don't need import path changes.
 */

import { createTrafficLights } from "@/shell/edge/UI-edge/floating-windows/traffic-lights";
import type { HorizontalMenuItem, HorizontalMenuElements } from './horizontalMenuTypes';
import { createMenuItemElement, createSubMenuElement } from './menuItemDom';

// Re-export everything that was previously exported from this file
export type { SliderConfig, SecondaryAction, HorizontalMenuItem, NodeMenuItemsInput, HorizontalMenuElements } from './horizontalMenuTypes';
export { getNodeMenuItems } from './getNodeMenuItems';

/**
 * Create the horizontal menu DOM elements (left pill group + spacer + right pill group).
 * Returns the individual elements so they can be assembled into any container.
 * Extracted for reuse by floating window chrome.
 *
 * @param menuItems - Menu items to render
 * @param onClose - Callback when menu should close (for hover menus)
 * @param trafficLights - Optional traffic light buttons to append
 */
export function createHorizontalMenuElement(
    menuItems: HorizontalMenuItem[],
    onClose: () => void,
    trafficLights?: HTMLDivElement
): HorizontalMenuElements {
    // Create left group (first 3 buttons: Delete, Copy, Add)
    // Uses .horizontal-menu-pill CSS class for styling (supports dark mode)
    const leftGroup: HTMLDivElement = document.createElement('div');
    leftGroup.className = 'horizontal-menu-pill horizontal-menu-left-group';

    // Create right group (Run, More + traffic light placeholders)
    const rightGroup: HTMLDivElement = document.createElement('div');
    rightGroup.className = 'horizontal-menu-pill horizontal-menu-right-group';

    // Split point: first 3 items go left (Delete, Copy, Add), rest go right (Run, More)
    const SPLIT_INDEX: number = 3;

    for (let i: number = 0; i < menuItems.length; i++) {
        const item: HorizontalMenuItem = menuItems[i];
        const itemContainer: HTMLDivElement = document.createElement('div');
        itemContainer.style.position = 'relative';

        const menuItemEl: HTMLElement = createMenuItemElement(item, onClose);
        itemContainer.appendChild(menuItemEl);

        // Handle submenu (static or dynamic)
        if (item.subMenu || item.getSubMenuItems) {
            let submenuEl: HTMLElement = item.subMenu
                ? createSubMenuElement(item.subMenu, onClose)
                : createSubMenuElement([], onClose);
            itemContainer.appendChild(submenuEl);

            let isHovered: boolean = false;

            // Show/hide submenu on hover, with dynamic loading support
            itemContainer.addEventListener('mouseenter', () => {
                isHovered = true;
                if (item.getSubMenuItems) {
                    void item.getSubMenuItems().then((dynamicItems: HorizontalMenuItem[]) => {
                        const newSubmenuEl: HTMLElement = createSubMenuElement(dynamicItems, onClose);
                        itemContainer.replaceChild(newSubmenuEl, submenuEl);
                        submenuEl = newSubmenuEl;
                        if (isHovered) {
                            newSubmenuEl.style.display = 'flex';
                        }
                    });
                } else {
                    submenuEl.style.display = 'flex';
                }
            });
            itemContainer.addEventListener('mouseleave', () => {
                isHovered = false;
                submenuEl.style.display = 'none';
            });
        }

        // Add to left or right group
        if (i < SPLIT_INDEX) {
            leftGroup.appendChild(itemContainer);
        } else {
            rightGroup.appendChild(itemContainer);
        }
    }

    const defaultTrafficLights: HTMLDivElement = createTrafficLights({
        onClose: () => {},
        onPin: () => false,
        isPinned: false,
    });
    const trafficLightContainer: HTMLDivElement = trafficLights ?? defaultTrafficLights;

    // Append buttons directly to preserve existing right-group structure
    const trafficLightButtons: Element[] = Array.from(trafficLightContainer.children);
    trafficLightButtons.forEach((button: Element) => {
        rightGroup.appendChild(button);
    });

    // Spacer in middle (gap for node circle, no background)
    // Default: non-interactive so clicks pass through to node (for hover menu)
    // Grab behavior is conditionally enabled in createNodeMenu for editor-window mode only
    const spacer: HTMLDivElement = document.createElement('div');
    spacer.className = 'horizontal-menu-spacer';
    spacer.style.cssText = `
        width: 35px;
        min-height: 32px;
        pointer-events: none;
    `;

    return { leftGroup, spacer, rightGroup };
}
