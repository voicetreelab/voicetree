/**
 * DOM creation utilities for horizontal menu items.
 * Pure DOM-building functions with no business logic.
 */

import type { IconNode } from 'lucide';
import { createElement } from 'lucide';
import type { HorizontalMenuItem } from './horizontalMenuTypes';
import { showFloatingSlider, hideFloatingSlider } from './DistanceSlider';

/** Render a Lucide icon to SVG element with optional color */
export function createIconElement(icon: IconNode, color?: string): SVGElement {
    const svgElement: SVGElement = createElement(icon);
    svgElement.setAttribute('width', '20');
    svgElement.setAttribute('height', '20');
    if (color) svgElement.setAttribute('stroke', color);
    return svgElement;
}

/** Create a menu item button element
 * @param alwaysShowLabel - if true, label is always visible (for vertical submenus)
 * @returns container element with button (and slider if configured)
 */
export function createMenuItemElement(item: HorizontalMenuItem, onClose: () => void, alwaysShowLabel: boolean = false): HTMLElement {
    // Wrap button in container for slider positioning
    const container: HTMLDivElement = document.createElement('div');
    // For submenu items: row layout. For main menu: column layout with centered alignment.
    container.style.cssText = alwaysShowLabel
        ? 'position: relative; display: inline-flex; flex-direction: row; align-items: center;'
        : 'position: relative; display: inline-flex; flex-direction: column; align-items: center;';

    const button: HTMLButtonElement = document.createElement('button');
    button.className = 'horizontal-menu-item';
    // For submenu items: row layout with icon and text side by side
    // For main menu: column layout with icon on top, text below (shown on hover)
    button.style.cssText = alwaysShowLabel
        ? `
            position: relative;
            display: inline-flex;
            flex-direction: row;
            align-items: center;
            gap: 8px;
            padding: 4px 12px;
            margin: 0;
            border: none;
            background: transparent;
            cursor: pointer;
            color: inherit;
            white-space: nowrap;
        `
        : `
            position: relative;
            display: inline-flex;
            flex-direction: column;
            align-items: center;
            padding: 6px 14px;
            margin: 0 3px;
            border: none;
            background: transparent;
            cursor: pointer;
            color: inherit;
        `;

    // Add icon or checkbox (fixed position, doesn't move on hover)
    const iconWrapper: HTMLSpanElement = document.createElement('span');
    if (item.isCheckbox) {
        const checkbox: HTMLInputElement = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = item.checked ?? false;
        checkbox.style.cssText = `
            margin: 0;
            width: 16px;
            height: 16px;
            cursor: pointer;
            pointer-events: none;
        `;
        iconWrapper.appendChild(checkbox);
    } else {
        iconWrapper.appendChild(createIconElement(item.icon, item.color));
    }
    button.appendChild(iconWrapper);

    // Add label container - position depends on whether label is always shown
    const labelContainer: HTMLSpanElement = document.createElement('span');
    labelContainer.className = 'horizontal-menu-label';

    if (alwaysShowLabel) {
        // For vertical submenus: inline label, always visible
        labelContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
            white-space: nowrap;
        `;
    } else {
        // For horizontal menu: positioned absolutely below icon, hidden until hover
        labelContainer.style.cssText = `
            position: absolute;
            top: 100%;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            align-items: center;
            gap: 4px;
            white-space: nowrap;
            visibility: hidden;
            opacity: 0;
            transition: opacity 0.1s ease;
        `;
    }

    const labelText: HTMLSpanElement = document.createElement('span');
    labelText.style.fontSize = '13px';
    labelText.textContent = item.label;
    labelContainer.appendChild(labelText);

    // Add hotkey hint if provided
    if (item.hotkey) {
        const hotkeyHint: HTMLSpanElement = document.createElement('span');
        hotkeyHint.style.cssText = `
            font-size: 10px;
            color: var(--muted-foreground);
            opacity: 0.7;
        `;
        hotkeyHint.textContent = item.hotkey;
        labelContainer.appendChild(hotkeyHint);
    }

    button.appendChild(labelContainer);

    // For submenu items with a secondary action, make the main button take available space
    if (alwaysShowLabel && item.secondaryAction) {
        button.style.flex = '1';
    }

    container.appendChild(button);

    // Render secondary action button (e.g., trash icon on worktree submenu items)
    if (alwaysShowLabel && item.secondaryAction) {
        const secondaryBtn: HTMLButtonElement = document.createElement('button');
        secondaryBtn.style.cssText = `
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 4px;
            margin-right: 4px;
            border: none;
            background: transparent;
            cursor: pointer;
            color: inherit;
            border-radius: 4px;
            opacity: 0.5;
            transition: opacity 0.15s ease, background 0.15s ease;
        `;
        if (item.secondaryAction.tooltip) {
            secondaryBtn.title = item.secondaryAction.tooltip;
        }
        const secondaryIcon: SVGElement = createIconElement(item.secondaryAction.icon, item.secondaryAction.color);
        secondaryIcon.setAttribute('width', '16');
        secondaryIcon.setAttribute('height', '16');
        secondaryBtn.appendChild(secondaryIcon);

        secondaryBtn.addEventListener('mouseenter', () => {
            secondaryBtn.style.opacity = '1';
            secondaryBtn.style.background = 'var(--accent)';
        });
        secondaryBtn.addEventListener('mouseleave', () => {
            secondaryBtn.style.opacity = '0.5';
            secondaryBtn.style.background = 'transparent';
        });
        secondaryBtn.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            void item.secondaryAction!.action();
            onClose();
        });

        container.appendChild(secondaryBtn);
    }

    // Hover effect - for horizontal menu, show label; for vertical, just highlight
    // Also show/hide floating slider on hover (slider is appended to overlay, not container)
    // Use CSS variable for dark mode support
    button.addEventListener('mouseenter', () => {
        button.style.background = 'var(--accent)';
        if (!alwaysShowLabel) {
            labelContainer.style.visibility = 'visible';
            labelContainer.style.opacity = '1';
        }
        if (item.sliderConfig) {
            showFloatingSlider({
                menuElement: item.sliderConfig.menuElement,
                currentDistance: item.sliderConfig.currentDistance,
                onDistanceChange: item.sliderConfig.onDistanceChange,
                onRun: item.sliderConfig.onRun ?? item.action,  // Use sliderConfig.onRun or fall back to item.action
            });
        }
        if (item.onHoverEnter) {
            void item.onHoverEnter();
        }
    });
    button.addEventListener('mouseleave', () => {
        button.style.background = 'transparent';
        if (!alwaysShowLabel) {
            labelContainer.style.visibility = 'hidden';
            labelContainer.style.opacity = '0';
        }
        // Hide slider on button mouseleave - handles case where mouse leaves without
        // passing through slider (especially important for anchored editor menus which don't close)
        if (item.sliderConfig) {
            hideFloatingSlider();
        }
        if (item.onHoverLeave) {
            item.onHoverLeave();
        }
    });

    // Click handler
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        // Toggle checkbox visual state before calling action
        if (item.isCheckbox) {
            const checkbox: HTMLInputElement | null = button.querySelector('input[type="checkbox"]');
            if (checkbox) checkbox.checked = !checkbox.checked;
        }
        void item.action();
        if (!item.subMenu && !item.getSubMenuItems && !item.preventClose) {
            onClose();
        }
    });

    return container;
}

/** Create submenu container (vertical dropdown)
 * Styles are defined in floating-windows.css (.horizontal-menu-submenu) for dark mode support */
export function createSubMenuElement(items: HorizontalMenuItem[], onClose: () => void): HTMLElement {
    const submenu: HTMLDivElement = document.createElement('div');
    submenu.className = 'horizontal-menu-submenu';

    for (const item of items) {
        // Pass alwaysShowLabel=true for vertical submenu items (row layout handled in createMenuItemElement)
        const menuItem: HTMLElement = createMenuItemElement(item, onClose, true);

        // Handle nested submenu (static or dynamic) — mirrors hover logic from createHorizontalMenuElement
        if (item.subMenu || item.getSubMenuItems) {
            let nestedSubmenuEl: HTMLElement = item.subMenu
                ? createSubMenuElement(item.subMenu, onClose)
                : createSubMenuElement([], onClose);
            // Position nested submenu to the right of the parent item (not below)
            nestedSubmenuEl.style.left = '100%';
            nestedSubmenuEl.style.top = '0';
            nestedSubmenuEl.style.transform = 'none';
            menuItem.appendChild(nestedSubmenuEl);

            let isHovered: boolean = false;

            menuItem.addEventListener('mouseenter', () => {
                isHovered = true;
                if (item.getSubMenuItems) {
                    void item.getSubMenuItems().then((dynamicItems: HorizontalMenuItem[]) => {
                        const newSubmenuEl: HTMLElement = createSubMenuElement(dynamicItems, onClose);
                        newSubmenuEl.style.left = '100%';
                        newSubmenuEl.style.top = '0';
                        newSubmenuEl.style.transform = 'none';
                        menuItem.replaceChild(newSubmenuEl, nestedSubmenuEl);
                        nestedSubmenuEl = newSubmenuEl;
                        if (isHovered) {
                            newSubmenuEl.style.display = 'flex';
                        }
                    });
                } else {
                    nestedSubmenuEl.style.display = 'flex';
                }
            });
            menuItem.addEventListener('mouseleave', () => {
                isHovered = false;
                nestedSubmenuEl.style.display = 'none';
            });
        }

        submenu.appendChild(menuItem);
    }

    return submenu;
}
