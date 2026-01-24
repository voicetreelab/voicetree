/**
 * Horizontal menu item types and DOM creation utilities.
 * Used by HorizontalMenuService and floating window chrome.
 */

import type { Core } from 'cytoscape';
import type { IconNode } from 'lucide';
import { Plus, Play, Trash2, Clipboard, ChevronDown, Edit2, createElement } from 'lucide';
import type { GraphNode } from "@/pure/graph";
import { createNewChildNodeFromUI, deleteNodesFromUI } from "@/shell/edge/UI-edge/graph/handleUIActions";
import {
    spawnTerminalWithNewContextNode,
    spawnTerminalWithCommandEditor,
} from "@/shell/edge/UI-edge/floating-windows/terminals/spawnTerminalWithCommandFromUI";
import { getFilePathForNode, getNodeFromMainToUI } from "@/shell/edge/UI-edge/graph/getNodeFromMainToUI";
import type { AgentConfig, VTSettings } from "@/pure/settings";
import { highlightContainedNodes, highlightPreviewNodes, clearContainedHighlights } from '@/shell/UI/cytoscape-graph-ui/highlightContextNodes';
import { createTrafficLights } from "@/shell/edge/UI-edge/floating-windows/traffic-lights";
import { showFloatingSlider, hideFloatingSlider } from './DistanceSlider';

/** Config for attaching a distance slider to a menu item */
export interface SliderConfig {
    readonly currentDistance: number;
    readonly onDistanceChange: (newDistance: number) => void;
    readonly onRun?: () => void | Promise<void>;  // Called when user clicks a slider square
    readonly menuAnchor: HTMLElement;  // Element to position slider above
    readonly overlay: HTMLElement;      // Overlay to append slider to
}

/** Menu item interface for the custom horizontal menu */
export interface HorizontalMenuItem {
    icon: IconNode;
    label: string;
    color?: string;
    action: () => void | Promise<void>;
    subMenu?: HorizontalMenuItem[];
    hotkey?: string; // e.g., "⌘⏎" for cmd+enter
    onHoverEnter?: () => void | Promise<void>; // Optional callback on mouseenter
    onHoverLeave?: () => void; // Optional callback on mouseleave
    sliderConfig?: SliderConfig; // Optional distance slider shown on hover
}

/** Input parameters for getNodeMenuItems */
export interface NodeMenuItemsInput {
    readonly nodeId: string;
    readonly cy: Core;
    readonly agents: readonly AgentConfig[];
    readonly isContextNode: boolean;
    readonly currentDistance?: number; // Current context retrieval distance (for slider)
    readonly menuAnchor?: HTMLElement;  // Element to position slider above (required for slider)
    readonly overlay?: HTMLElement;      // Overlay to append slider to (required for slider)
}

/** Output from createHorizontalMenuElement */
export interface HorizontalMenuElements {
    readonly leftGroup: HTMLDivElement;
    readonly spacer: HTMLDivElement;
    readonly rightGroup: HTMLDivElement;
}

/** Render a Lucide icon to SVG element with optional color */
function createIconElement(icon: IconNode, color?: string): SVGElement {
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
function createMenuItemElement(item: HorizontalMenuItem, onClose: () => void, alwaysShowLabel: boolean = false): HTMLElement {
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
            padding: 6px 10px;
            margin: 0 2px;
            border: none;
            background: transparent;
            cursor: pointer;
            color: inherit;
        `;

    // Add icon (fixed position, doesn't move on hover)
    const iconWrapper: HTMLSpanElement = document.createElement('span');
    iconWrapper.appendChild(createIconElement(item.icon, item.color));
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
    container.appendChild(button);

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
                anchorElement: item.sliderConfig.menuAnchor,
                currentDistance: item.sliderConfig.currentDistance,
                onDistanceChange: item.sliderConfig.onDistanceChange,
                onRun: item.sliderConfig.onRun ?? item.action,  // Use sliderConfig.onRun or fall back to item.action
                overlay: item.sliderConfig.overlay,
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
        void item.action();
        if (!item.subMenu) {
            onClose();
        }
    });

    return container;
}

/** Create submenu container (vertical dropdown)
 * Styles are defined in floating-windows.css (.horizontal-menu-submenu) for dark mode support */
function createSubMenuElement(items: HorizontalMenuItem[], onClose: () => void): HTMLElement {
    const submenu: HTMLDivElement = document.createElement('div');
    submenu.className = 'horizontal-menu-submenu';

    for (const item of items) {
        // Pass alwaysShowLabel=true for vertical submenu items (row layout handled in createMenuItemElement)
        const menuItem: HTMLElement = createMenuItemElement(item, onClose, true);
        submenu.appendChild(menuItem);
    }

    return submenu;
}

/**
 * Create slider config for run buttons (non-context nodes only).
 * The slider allows adjusting context retrieval distance and shows preview.
 */
function createRunButtonSliderConfig(
    cy: Core,
    nodeId: string,
    currentDistance: number,
    menuAnchor: HTMLElement,
    overlay: HTMLElement
): SliderConfig {
    return {
        currentDistance,
        onDistanceChange: (newDistance: number): void => {
            void (async (): Promise<void> => {
                const currentSettings: VTSettings | null = await window.electronAPI?.main.loadSettings() ?? null;
                if (currentSettings && window.electronAPI) {
                    await window.electronAPI.main.saveSettings({...currentSettings, contextNodeMaxDistance: newDistance});
                }
                clearContainedHighlights(cy);
                await highlightPreviewNodes(cy, nodeId);
            })();
        },
        menuAnchor,
        overlay,
    };
}

/**
 * Get menu items for a node - pure function that returns menu item definitions.
 * Extracted for reuse by floating window chrome.
 */
export function getNodeMenuItems(input: NodeMenuItemsInput): HorizontalMenuItem[] {
    const { nodeId, cy, agents, isContextNode, currentDistance, menuAnchor, overlay } = input;
    const menuItems: HorizontalMenuItem[] = [];

    // Create slider config for non-context nodes (context nodes don't need distance slider)
    // Only create if menuAnchor and overlay are provided (required for floating slider)
    const sliderConfig: SliderConfig | undefined = !isContextNode && currentDistance !== undefined && menuAnchor && overlay
        ? createRunButtonSliderConfig(cy, nodeId, currentDistance, menuAnchor, overlay)
        : undefined;

    // LEFT SIDE: Delete, Copy, Add (3 buttons)
    menuItems.push({
        icon: Trash2, label: 'Delete', hotkey: '⌘⌫',
        action: () => deleteNodesFromUI([nodeId], cy),
    });
    menuItems.push({
        icon: Clipboard, label: 'Copy Path',
        action: () => { void navigator.clipboard.writeText(getFilePathForNode(nodeId)); },
    });
    menuItems.push({
        icon: Plus, label: 'Add Child', hotkey: '⌘N',
        action: () => { void createNewChildNodeFromUI(nodeId, cy); },
    });

    // RIGHT SIDE: Run, More (2 buttons) + traffic light placeholders (Close, Pin, Fullscreen)
    menuItems.push({
        icon: Play,
        label: 'Run',
        color: '#22c55e', // green
        hotkey: '⌘⏎',
        action: async () => {
            await spawnTerminalWithNewContextNode(nodeId, cy);
        },
        // Context nodes: show contained nodes. Normal nodes: preview what would be captured.
        onHoverEnter: isContextNode
            ? () => highlightContainedNodes(cy, nodeId)
            : () => highlightPreviewNodes(cy, nodeId),
        onHoverLeave: () => clearContainedHighlights(cy),
        sliderConfig, // Show distance slider on hover for non-context nodes
        subMenu: [
            // Worktree toggle is now available in the Edit Command popup
            { icon: Edit2, label: 'Edit Command', action: () => spawnTerminalWithCommandEditor(nodeId, cy) },
        ],
    });

    // Expandable "more" menu with Copy Content and additional agents
    const moreSubMenu: HorizontalMenuItem[] = [
        {
            icon: Clipboard,
            label: 'Copy Content',
            action: async () => {
                const graphNode: GraphNode = await getNodeFromMainToUI(nodeId);
                void navigator.clipboard.writeText(graphNode.contentWithoutYamlOrLinks);
            },
        },
    ];

    // Add non-default agents (skip first which is default, used by Run button)
    for (const agent of agents.slice(1)) {
        moreSubMenu.push({
            icon: Play,
            label: agent.name,
            color: '#6366f1', // indigo to distinguish from default Run
            action: async () => {
                await spawnTerminalWithNewContextNode(nodeId, cy, agent.command);
            },
            // Context nodes: show contained nodes. Normal nodes: preview what would be captured.
            onHoverEnter: isContextNode
                ? () => highlightContainedNodes(cy, nodeId)
                : () => highlightPreviewNodes(cy, nodeId),
            onHoverLeave: () => clearContainedHighlights(cy),
            // TODO: Re-enable slider for secondary agents once hover leniency is improved
            // (slider should stay open when navigating between button and slider, not just on direct hover)
            // sliderConfig,
        });
    }
    menuItems.push({
        icon: ChevronDown,
        label: 'More',
        action: () => {}, // No-op, submenu handles interaction
        subMenu: moreSubMenu,
    });

    return menuItems;
}

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

        // Handle submenu
        if (item.subMenu) {
            const submenu: HTMLElement = createSubMenuElement(item.subMenu, onClose);
            itemContainer.appendChild(submenu);

            // Show/hide submenu on hover
            itemContainer.addEventListener('mouseenter', () => {
                submenu.style.display = 'flex';
            });
            itemContainer.addEventListener('mouseleave', () => {
                submenu.style.display = 'none';
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
    const spacer: HTMLDivElement = document.createElement('div');
    spacer.className = 'horizontal-menu-spacer';
    spacer.style.cssText = `
        width: 35px;
        height: 1px;
        pointer-events: none;
    `;

    return { leftGroup, spacer, rightGroup };
}
