/**
 * Type definitions for ctxmenu library v2.0.2
 * Based on: https://github.com/nkappler/ctxmenu
 *
 * ctxMenu is a lightweight context menu library with support for:
 * - Text items with actions
 * - Submenus with hover triggers
 * - Dividers
 * - Headings
 * - Anchors (links)
 * - Custom HTML elements
 * - Icons
 * - Disabled states
 * - Custom attributes and styles
 * - Lifecycle hooks (onBeforeShow, onShow, onHide, onBeforeHide)
 */

/**
 * A property that can be either a static value or a function returning that value.
 * Functions are evaluated lazily when the menu is displayed.
 */
type MaybeLazy<T> = T | (() => T);

/**
 * Event handler definition for menu items.
 * Can be either a simple function or an object with listener and options.
 */
type EventHandler = ((event: Event) => void) | {
    listener: (event: Event) => void;
    options?: AddEventListenerOptions;
};

/**
 * Base menu item interface.
 * Properties can be static values or functions that return values (lazy evaluation).
 */
export interface BaseMenuItem {
    /** Tooltip text shown on hover */
    tooltip?: MaybeLazy<string>;
    /** Custom inline CSS styles */
    style?: MaybeLazy<string>;
    /** Custom HTML attributes to add to the menu item */
    attributes?: MaybeLazy<Record<string, string>>;
    /** Event handlers for the menu item */
    events?: MaybeLazy<Record<string, EventHandler>>;
    /** URL to an icon image to display */
    icon?: MaybeLazy<string>;
    /** Whether this item is disabled (grayed out and non-interactive) */
    disabled?: MaybeLazy<boolean>;
}

/**
 * A text menu item with an action callback.
 */
export interface ActionMenuItem extends BaseMenuItem {
    /** Display text for the menu item */
    text: MaybeLazy<string>;
    /** Action to perform when the item is clicked */
    action: (event: MouseEvent) => void;
}

/**
 * A menu item that acts as a hyperlink.
 */
export interface AnchorMenuItem extends BaseMenuItem {
    /** Display text for the menu item */
    text: MaybeLazy<string>;
    /** URL to navigate to */
    href: MaybeLazy<string>;
    /** Optional download attribute for the link */
    download?: MaybeLazy<string>;
    /** Target for the link (e.g., '_blank') */
    target?: MaybeLazy<string>;
}

/**
 * A menu item with a submenu.
 */
export interface SubMenuItem extends BaseMenuItem {
    /** Display text for the menu item */
    text: MaybeLazy<string>;
    /** Array of menu items to display in the submenu */
    subMenu: MaybeLazy<MenuItem[]>;
    /** Optional attributes for the submenu container */
    subMenuAttributes?: MaybeLazy<Record<string, string>>;
}

/**
 * A horizontal divider line between menu items.
 */
export interface DividerMenuItem {
    /** Must be true to indicate this is a divider */
    isDivider: true;
}

/**
 * A non-interactive heading item (text only, no action).
 */
export interface HeadingMenuItem extends BaseMenuItem {
    /** Display text for the heading */
    text: MaybeLazy<string>;
}

/**
 * A custom menu item with raw HTML or a DOM element.
 */
export interface CustomMenuItem extends BaseMenuItem {
    /** Raw HTML string to render */
    html?: MaybeLazy<string>;
    /** DOM element to insert */
    element?: MaybeLazy<HTMLElement>;
}

/**
 * Union type of all possible menu item types.
 */
export type MenuItem =
    | ActionMenuItem
    | AnchorMenuItem
    | SubMenuItem
    | DividerMenuItem
    | HeadingMenuItem
    | CustomMenuItem;

/**
 * Configuration options for displaying a context menu.
 */
export interface MenuConfig {
    /** Called after the menu is shown */
    onShow?: (menu: HTMLUListElement) => void;
    /** Called after the menu is hidden */
    onHide?: (menu: HTMLUListElement) => void;
    /** Called before the menu is shown. Can modify the menu items array. */
    onBeforeShow?: (menu: MenuItem[], event?: MouseEvent) => MenuItem[] | void;
    /** Called before the menu is hidden */
    onBeforeHide?: (menu: HTMLUListElement) => void;
    /** Custom HTML attributes to add to the menu container */
    attributes?: Record<string, string>;
}

/**
 * Main ctxmenu API interface.
 */
export interface CtxMenu {
    /**
     * Attach a context menu to a target element via CSS selector.
     * The menu will be shown when the user right-clicks on the target.
     *
     * @param target - CSS selector for the target element(s)
     * @param menuItems - Array of menu items to display
     * @param config - Optional configuration for the menu
     *
     * @example
     * ctxmenu.attach('#my-element', [
     *   { text: 'Copy', action: () => console.log('copied') },
     *   { isDivider: true },
     *   { text: 'Paste', action: () => console.log('pasted') }
     * ]);
     */
    attach(target: string, menuItems: MenuItem[], config?: MenuConfig): void;

    /**
     * Update the menu definition or config for an already attached target.
     *
     * @param target - CSS selector for the target element
     * @param menuItems - New array of menu items (optional, keeps existing if not provided)
     * @param config - New configuration (merged with existing config)
     */
    update(target: string, menuItems?: MenuItem[], config?: MenuConfig): void;

    /**
     * Remove the context menu from a target element.
     *
     * @param target - CSS selector for the target element
     */
    delete(target: string): void;

    /**
     * Show a context menu at a specific position or event location.
     * This is useful for programmatically showing a menu without attaching to an element.
     *
     * @param menuItems - Array of menu items to display
     * @param eventOrElement - Mouse event or DOM element to position the menu relative to
     * @param config - Optional configuration for the menu
     *
     * @example
     * // Show at mouse position
     * ctxmenu.show(menuItems, event);
     *
     * // Show relative to an element
     * const elem = document.querySelector('#my-element');
     * ctxmenu.show(menuItems, elem);
     */
    show(menuItems: MenuItem[], eventOrElement: MouseEvent | Element, config?: MenuConfig): void;

    /**
     * Hide the currently displayed context menu.
     */
    hide(): void;
}

declare global {
    interface Window {
        ctxmenu: CtxMenu;
    }
}

declare const ctxmenu: CtxMenu;
export default ctxmenu;
