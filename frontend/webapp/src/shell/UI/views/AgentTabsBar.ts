/**
 * AgentTabsBar - Renders open terminal/agent tabs in top-right of title bar
 *
 * Features:
 * - Pinned section (90px tabs with title + status dot) and unpinned section (24px status dot only)
 * - Status indicators: ◌ running (dotted border animated), ● done (green filled)
 * - Positioned in macOS title bar area (right: 80px, mirroring RecentNodeTabsBar)
 * - Clicking a tab navigates to and focuses that terminal
 * - Highlights currently active terminal
 *
 * Architecture:
 * - Terminal state (isPinned, isDone, etc.) lives in TerminalData via TerminalStore
 * - Global UI state (activeTerminalId, displayOrder) lives in AgentTabsStore
 * - Pure logic (shortcuts, inactivity) lives in @/pure/agentTabs
 * - This file handles DOM rendering only
 */

import type { TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import { getTerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import { updateTerminal } from '@/shell/edge/UI-edge/state/TerminalStore';
import {
    getActiveTerminalId,
    setActiveTerminalId,
    getDisplayOrder,
    getPinnedDisplayOrder,
    syncDisplayOrder,
    suppressInactivityDuringZoom as storeSuppress,
    resetAgentTabsStore,
} from '@/shell/edge/UI-edge/state/AgentTabsStore';
import { getShortcutHintForTab } from '@/pure/agentTabs';
import { createPinnedTab, createUnpinnedTab, type TabCreationDeps } from './agentTabElements';
import type {} from '@/shell/electron';
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType';
import {
    startTerminalActivityPolling,
    stopTerminalActivityPolling,
} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalActivityPolling';
// Re-export activity tracking functions for backwards compatibility
export { markTerminalActivityForContextNode, clearActivityForTerminal } from './agentTabsActivity';

// =============================================================================
// DOM Element Refs (UI-only state)
// =============================================================================

let container: HTMLElement | null = null;
let pinnedContainer: HTMLElement | null = null;
let unpinnedContainer: HTMLElement | null = null;
let dividerElement: HTMLElement | null = null;

// Cached for re-render
let lastTerminals: TerminalData[] = [];

// =============================================================================
// Display Order (delegates to store)
// =============================================================================

/**
 * Get the current display order for pinned terminals (for GraphNavigationService cycling)
 */
export function getDisplayOrderForNavigation(): TerminalId[] {
    return getPinnedDisplayOrder(lastTerminals);
}

// =============================================================================
// Divider Visibility
// =============================================================================

function updateDividerVisibility(terminals: TerminalData[]): void {
    if (!dividerElement) return;

    const hasPinned: boolean = terminals.some(t => t.isPinned);
    const hasUnpinned: boolean = terminals.some(t => !t.isPinned);

    dividerElement.style.display = (hasPinned && hasUnpinned) ? 'block' : 'none';
}

// =============================================================================
// Pin/Unpin Terminals
// =============================================================================

/**
 * Unpin a terminal (move from pinned to unpinned section)
 * Exported for use by terminal traffic light buttons
 */
export function unpinTerminal(terminalId: TerminalId): void {
    updateTerminal(terminalId, { isPinned: false });
}

/**
 * Pin a terminal (move from unpinned to pinned section)
 * Exported for use by terminal traffic light buttons
 */
export function pinTerminal(terminalId: TerminalId): void {
    updateTerminal(terminalId, { isPinned: true });
}

// =============================================================================
// Create/Mount Tabs Bar
// =============================================================================

/**
 * Create and mount the agent tabs bar into a parent container
 */
export function createAgentTabsBar(parentContainer: HTMLElement): () => void {
    // Clean up any existing instance
    disposeAgentTabsBar();

    // Create main container
    container = document.createElement('div');
    container.className = 'agent-tabs-bar';
    container.setAttribute('data-testid', 'agent-tabs-bar');

    // Create pinned tabs container
    pinnedContainer = document.createElement('div');
    pinnedContainer.className = 'agent-tabs-pinned';

    // Create divider
    dividerElement = document.createElement('div');
    dividerElement.className = 'agent-tabs-divider';
    dividerElement.style.display = 'none';

    // Create unpinned tabs container
    unpinnedContainer = document.createElement('div');
    unpinnedContainer.className = 'agent-tabs-unpinned';

    container.appendChild(pinnedContainer);
    container.appendChild(dividerElement);
    container.appendChild(unpinnedContainer);
    parentContainer.appendChild(container);

    // Initially hidden until we have terminals
    container.style.display = 'none';

    // Subscribe to terminal data events for inactivity tracking (edge layer)
    startTerminalActivityPolling();

    return disposeAgentTabsBar;
}

// =============================================================================
// Render Tabs
// =============================================================================

/**
 * Render tabs from the terminals array
 */
export function renderAgentTabs(
    terminals: TerminalData[],
    onSelect: (terminal: TerminalData) => void
): void {
    if (!pinnedContainer || !unpinnedContainer || !container) {
        console.warn('[AgentTabsBar] Not mounted, cannot render');
        return;
    }

    // Cache for active terminal lookup
    lastTerminals = terminals;

    // Clear existing tabs
    pinnedContainer.innerHTML = '';
    unpinnedContainer.innerHTML = '';

    // Sync display order with actual terminals
    const displayOrder: TerminalId[] = syncDisplayOrder(terminals);
    const activeTerminalId: TerminalId | null = getActiveTerminalId();

    // Split into pinned and unpinned based on terminal state
    const pinnedIds: TerminalId[] = displayOrder.filter(id => {
        const t: TerminalData | undefined = terminals.find(term => getTerminalId(term) === id);
        return t?.isPinned ?? false;
    });
    const unpinnedIds: TerminalId[] = displayOrder.filter(id => {
        const t: TerminalData | undefined = terminals.find(term => getTerminalId(term) === id);
        return t ? !t.isPinned : false;
    });

    // Find active index for shortcut hints
    const activeIndex: number = activeTerminalId && pinnedIds.includes(activeTerminalId)
        ? pinnedIds.indexOf(activeTerminalId)
        : -1;

    // Create pinned tabs
    const deps: TabCreationDeps = getTabCreationDeps();
    for (let i: number = 0; i < pinnedIds.length; i++) {
        const terminalId: TerminalId = pinnedIds[i];
        const terminal: TerminalData | undefined = terminals.find(t => getTerminalId(t) === terminalId);
        if (terminal) {
            const tab: HTMLElement = createPinnedTab(terminal, activeTerminalId, onSelect, i, activeIndex, pinnedIds.length, deps);
            pinnedContainer.appendChild(tab);
        }
    }

    // Create unpinned tabs
    for (const terminalId of unpinnedIds) {
        const terminal: TerminalData | undefined = terminals.find(t => getTerminalId(t) === terminalId);
        if (terminal) {
            const tab: HTMLElement = createUnpinnedTab(terminal, activeTerminalId, onSelect, deps);
            unpinnedContainer.appendChild(tab);
        }
    }

    // Update divider visibility
    updateDividerVisibility(terminals);

    // Update visibility based on whether we have terminals
    container.style.display = terminals.length > 0 ? 'flex' : 'none';
}

// =============================================================================
// Set Active Terminal
// =============================================================================

/**
 * Update which terminal is highlighted as active
 */
export function setActiveTerminal(terminalId: TerminalId | null): void {
    setActiveTerminalId(terminalId);

    if (!pinnedContainer || !unpinnedContainer) return;

    const displayOrder: TerminalId[] = getDisplayOrder();
    const pinnedIds: TerminalId[] = displayOrder.filter(id => {
        const t: TerminalData | undefined = lastTerminals.find(term => getTerminalId(term) === id);
        return t?.isPinned ?? false;
    });
    const activeIndex: number = terminalId && pinnedIds.includes(terminalId)
        ? pinnedIds.indexOf(terminalId)
        : -1;
    const totalPinnedTabs: number = pinnedIds.length;

    // Update active class on pinned tabs and shortcut hints
    const pinnedWrappers: HTMLCollectionOf<Element> = pinnedContainer.getElementsByClassName('agent-tab-wrapper');
    for (let i: number = 0; i < pinnedWrappers.length; i++) {
        const wrapper: Element = pinnedWrappers[i];
        const tab: Element | null = wrapper.querySelector('.agent-tab');
        const tabTerminalId: string | null = wrapper.getAttribute('data-terminal-id');

        if (tab) {
            if (tabTerminalId === terminalId) {
                tab.classList.add('agent-tab-active');
            } else {
                tab.classList.remove('agent-tab-active');
            }
        }

        // Update shortcut hint
        const existingHint: Element | null = wrapper.querySelector('.agent-tab-shortcut-hint');
        if (existingHint) {
            existingHint.remove();
        }

        const shortcutText: string | null = getShortcutHintForTab(i, activeIndex, totalPinnedTabs);
        if (shortcutText !== null) {
            const shortcutHint: HTMLSpanElement = document.createElement('span');
            shortcutHint.className = 'agent-tab-shortcut-hint';
            shortcutHint.textContent = shortcutText;
            wrapper.appendChild(shortcutHint);
        }
    }

    // Update active class on unpinned tabs
    const unpinnedTabs: HTMLCollectionOf<Element> = unpinnedContainer.getElementsByClassName('agent-tab-unpinned');
    for (let i: number = 0; i < unpinnedTabs.length; i++) {
        const tab: Element = unpinnedTabs[i];
        const tabTerminalId: string | null = tab.getAttribute('data-terminal-id');

        if (tabTerminalId === terminalId) {
            tab.classList.add('agent-tab-active');
        } else {
            tab.classList.remove('agent-tab-active');
        }
    }
}

// =============================================================================
// Tab Creation Dependencies
// =============================================================================

function getTabCreationDeps(): TabCreationDeps {
    return {
        unpinTerminal,
        pinTerminal,
    };
}


// =============================================================================
// Zoom Suppression (re-export from store)
// =============================================================================

export function suppressInactivityDuringZoom(): void {
    storeSuppress();
}

// =============================================================================
// Cleanup
// =============================================================================

export function disposeAgentTabsBar(): void {
    // Stop activity polling (handled by edge layer)
    stopTerminalActivityPolling();

    // Clean up terminal exit listener
    window.electronAPI?.removeAllListeners('terminal:exit');

    if (container && container.parentNode) {
        container.parentNode.removeChild(container);
    }

    container = null;
    pinnedContainer = null;
    unpinnedContainer = null;
    dividerElement = null;
    lastTerminals = [];

    resetAgentTabsStore();
}

export function isAgentTabsBarMounted(): boolean {
    return container !== null && container.parentNode !== null;
}
