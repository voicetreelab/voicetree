/**
 * Type definitions for horizontal menu items.
 * Used by menuItemDom.ts, getNodeMenuItems.ts, and HorizontalMenuItems.ts.
 */

import type { Core } from 'cytoscape';
import type { IconNode } from 'lucide';
import type { AgentConfig } from "@/pure/settings";

/** Config for attaching a distance slider to a menu item */
export interface SliderConfig {
    readonly currentDistance: number;
    readonly onDistanceChange: (newDistance: number) => void;
    readonly onRun?: () => void | Promise<void>;  // Called when user clicks a slider square
    readonly menuElement: HTMLElement;  // Menu element to append slider to (slider becomes child of menu)
}

/** Secondary action button (e.g., trash icon) rendered at the right edge of a submenu item */
export interface SecondaryAction {
    icon: IconNode;
    color?: string;
    tooltip?: string;
    action: () => void | Promise<void>;
}

/** Menu item interface for the custom horizontal menu */
export interface HorizontalMenuItem {
    icon: IconNode;
    label: string;
    color?: string;
    action: () => void | Promise<void>;
    subMenu?: HorizontalMenuItem[];
    getSubMenuItems?: () => Promise<HorizontalMenuItem[]>;
    hotkey?: string; // e.g., "⌘⏎" for cmd+enter
    onHoverEnter?: () => void | Promise<void>; // Optional callback on mouseenter
    onHoverLeave?: () => void; // Optional callback on mouseleave
    sliderConfig?: SliderConfig; // Optional distance slider shown on hover
    secondaryAction?: SecondaryAction; // Optional action button at right edge (submenu items only)
}

/** Input parameters for getNodeMenuItems */
export interface NodeMenuItemsInput {
    readonly nodeId: string;
    readonly cy: Core;
    readonly agents: readonly AgentConfig[];
    readonly isContextNode: boolean;
    readonly currentDistance?: number; // Current context retrieval distance (for slider)
    readonly menuElement?: HTMLElement;  // Menu element to append slider to (required for slider)
}

/** Output from createHorizontalMenuElement */
export interface HorizontalMenuElements {
    readonly leftGroup: HTMLDivElement;
    readonly spacer: HTMLDivElement;
    readonly rightGroup: HTMLDivElement;
}
