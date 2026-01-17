/**
 * AgentTabsBar - Renders open terminal/agent tabs in top-right of title bar
 *
 * Features:
 * - Pinned section (90px tabs with title + status dot) and unpinned section (24px status dot only)
 * - Status indicators: ◌ running (dotted border animated), ● done (green filled)
 * - Positioned in macOS title bar area (right: 80px, mirroring RecentNodeTabsBar)
 * - Clicking a tab navigates to and focuses that terminal
 * - Highlights currently active terminal
 * - Drag-and-drop reordering within pinned section
 *
 * Architecture:
 * - Terminal state (isPinned, isDone, etc.) lives in TerminalData via TerminalStore
 * - Global UI state (activeTerminalId, displayOrder) lives in AgentTabsStore
 * - Pure logic (shortcuts, inactivity) lives in @/pure/agentTabs
 * - This file handles DOM rendering only
 */

import type { TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import { getTerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import { getTerminals, updateTerminal } from '@/shell/edge/UI-edge/state/TerminalStore';
import {
    getActiveTerminalId,
    setActiveTerminalId,
    getDisplayOrder,
    getPinnedDisplayOrder,
    syncDisplayOrder,
    reorderInDisplayOrder,
    suppressInactivityDuringZoom as storeSuppress,
    resetAgentTabsStore,
} from '@/shell/edge/UI-edge/state/AgentTabsStore';
import {
    TAB_WIDTH_PINNED,
    TAB_WIDTH_UNPINNED,
    getShortcutHintForTab,
    truncateTabTitle,
} from '@/pure/agentTabs';
import type {} from '@/shell/electron';
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType';
import {
    startTerminalActivityPolling,
    stopTerminalActivityPolling,
} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalActivityPolling';
import {
    createDragState,
    cleanupDragState,
    attachItemDragHandlers,
    calculateAdjustedTargetIndex,
} from '@/shell/UI/behaviors/dragReorder';
import type {} from '@/shell/UI/behaviors/dragReorder';

// =============================================================================
// DOM Element Refs (UI-only state)
// =============================================================================

let container: HTMLElement | null = null;
let pinnedContainer: HTMLElement | null = null;
let unpinnedContainer: HTMLElement | null = null;
let dividerElement: HTMLElement | null = null;

// Drag-drop state (managed by behavior module)
const dragState = createDragState();

// Cached for re-render after drag-drop
let lastTerminals: TerminalData[] = [];
let lastOnSelect: ((terminal: TerminalData) => void) | null = null;

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
// Ghost Element for Drag-Drop Visual Feedback
// =============================================================================

function createGhostElement(): HTMLElement {
    const ghost: HTMLElement = document.createElement('div');
    ghost.className = 'agent-tab-ghost';
    return ghost;
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
// Reorder Terminal (after drag-drop)
// =============================================================================

function reorderTerminal(fromIndex: number, toIndex: number): void {
    reorderInDisplayOrder(lastTerminals, fromIndex, toIndex);

    // Re-render with cached data
    if (lastOnSelect) {
        renderAgentTabs(lastTerminals, lastOnSelect);
    }
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

    // Container-level drag handlers for dropping at the end of the pinned list
    pinnedContainer.addEventListener('dragover', (e: DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move';
        }
        if (dragState.ghostElement && pinnedContainer && dragState.draggingFromIndex !== null) {
            const tabs: HTMLCollectionOf<Element> = pinnedContainer.getElementsByClassName('agent-tab');
            if (tabs.length > 0) {
                const lastTab: Element = tabs[tabs.length - 1];
                const lastTabRect: DOMRect = lastTab.getBoundingClientRect();
                if (e.clientX > lastTabRect.right) {
                    pinnedContainer.appendChild(dragState.ghostElement);
                    const pinnedCount: number = lastTerminals.filter(t => t.isPinned).length;
                    dragState.ghostTargetIndex = pinnedCount;
                }
            }
        }
    });

    pinnedContainer.addEventListener('drop', (e: DragEvent) => {
        e.preventDefault();
        const fromIndex: number = parseInt(e.dataTransfer?.getData('text/plain') ?? '-1');
        const targetIndex: number | null = dragState.ghostTargetIndex;
        cleanupDragState(dragState);

        if (fromIndex >= 0 && targetIndex !== null && fromIndex !== targetIndex) {
            const adjustedTarget: number = calculateAdjustedTargetIndex(fromIndex, targetIndex);
            reorderTerminal(fromIndex, adjustedTarget);
        }
    });

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

    // Cache for re-render after drag-drop
    lastTerminals = terminals;
    lastOnSelect = onSelect;

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
    for (let i: number = 0; i < pinnedIds.length; i++) {
        const terminalId: TerminalId = pinnedIds[i];
        const terminal: TerminalData | undefined = terminals.find(t => getTerminalId(t) === terminalId);
        if (terminal) {
            const tab: HTMLElement = createPinnedTab(terminal, activeTerminalId, onSelect, i, activeIndex, pinnedIds.length);
            pinnedContainer.appendChild(tab);
        }
    }

    // Create unpinned tabs
    for (const terminalId of unpinnedIds) {
        const terminal: TerminalData | undefined = terminals.find(t => getTerminalId(t) === terminalId);
        if (terminal) {
            const tab: HTMLElement = createUnpinnedTab(terminal, activeTerminalId, onSelect);
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
// Create Tab Elements
// =============================================================================

function createPinnedTab(
    terminal: TerminalData,
    activeTerminalId: TerminalId | null,
    onSelect: (terminal: TerminalData) => void,
    index: number,
    activeIndex: number,
    totalTabs: number
): HTMLElement {
    const terminalId: TerminalId = getTerminalId(terminal);
    const displayTitle: string = truncateTabTitle(terminal.title);

    // Create wrapper container for tab + hint
    const wrapper: HTMLDivElement = document.createElement('div');
    wrapper.className = 'agent-tab-wrapper';
    wrapper.setAttribute('data-terminal-id', terminalId);

    const tab: HTMLButtonElement = document.createElement('button');
    tab.className = 'agent-tab';
    if (terminalId === activeTerminalId) {
        tab.classList.add('agent-tab-active');
    }
    tab.setAttribute('data-terminal-id', terminalId);
    tab.setAttribute('data-index', String(index));
    tab.style.width = `${TAB_WIDTH_PINNED}px`;

    // Create status dot
    const statusDot: HTMLSpanElement = document.createElement('span');
    statusDot.className = terminal.isDone ? 'agent-tab-status-done' : 'agent-tab-status-running';
    tab.appendChild(statusDot);

    // Create text span for title
    const textSpan: HTMLSpanElement = document.createElement('span');
    textSpan.className = 'agent-tab-text';
    textSpan.textContent = displayTitle;
    tab.appendChild(textSpan);

    // Add activity dots
    for (let i: number = 0; i < terminal.activityCount; i++) {
        const dot: HTMLSpanElement = document.createElement('span');
        dot.className = 'agent-tab-activity-dot';
        dot.style.left = `${4 + i * 12}px`;
        tab.appendChild(dot);
    }

    // Click handler
    tab.addEventListener('click', () => {
        onSelect(terminal);
    });

    // Double-click handler - unpin the tab
    tab.addEventListener('dblclick', (e: MouseEvent) => {
        e.stopPropagation();
        unpinTerminal(terminalId);
    });

    // Drag-and-drop for reordering
    tab.draggable = true;

    tab.addEventListener('mousedown', (e: MouseEvent) => {
        e.stopPropagation();
    });

    tab.addEventListener('dragstart', (e: DragEvent) => {
        e.stopPropagation();
        tab.classList.add('agent-tab-dragging');
        e.dataTransfer?.setData('text/plain', String(index));
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
        }
        dragState.draggingFromIndex = index;
        dragState.ghostElement = createGhostElement();
    });

    tab.addEventListener('dragend', (e: DragEvent) => {
        e.stopPropagation();
        tab.classList.remove('agent-tab-dragging');
        cleanupDragState(dragState);
    });

    tab.addEventListener('dragover', (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move';
        }
        if (dragState.draggingFromIndex === index) {
            return;
        }
        if (dragState.ghostElement && pinnedContainer) {
            const rect: DOMRect = wrapper.getBoundingClientRect();
            const midpoint: number = rect.left + rect.width / 2;
            const isRightHalf: boolean = e.clientX > midpoint;

            if (isRightHalf) {
                const nextSibling: Element | null = wrapper.nextElementSibling;
                if (nextSibling && !nextSibling.classList.contains('agent-tab-ghost')) {
                    pinnedContainer.insertBefore(dragState.ghostElement, nextSibling);
                } else if (!nextSibling) {
                    pinnedContainer.appendChild(dragState.ghostElement);
                }
                dragState.ghostTargetIndex = index + 1;
            } else {
                pinnedContainer.insertBefore(dragState.ghostElement, wrapper);
                dragState.ghostTargetIndex = index;
            }
        }
    });

    tab.addEventListener('dragleave', (e: DragEvent) => {
        e.stopPropagation();
    });

    tab.addEventListener('drop', (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const fromIndex: number = parseInt(e.dataTransfer?.getData('text/plain') ?? '-1');
        const targetIndex: number | null = dragState.ghostTargetIndex;
        cleanupDragState(dragState);

        if (fromIndex >= 0 && targetIndex !== null && fromIndex !== targetIndex) {
            const adjustedTarget: number = calculateAdjustedTargetIndex(fromIndex, targetIndex);
            reorderTerminal(fromIndex, adjustedTarget);
        }
    });

    wrapper.appendChild(tab);

    // Create shortcut hint element
    const shortcutText: string | null = getShortcutHintForTab(index, activeIndex, totalTabs);
    if (shortcutText !== null) {
        const shortcutHint: HTMLSpanElement = document.createElement('span');
        shortcutHint.className = 'agent-tab-shortcut-hint';
        shortcutHint.textContent = shortcutText;
        wrapper.appendChild(shortcutHint);
    }

    return wrapper;
}

function createUnpinnedTab(
    terminal: TerminalData,
    activeTerminalId: TerminalId | null,
    onSelect: (terminal: TerminalData) => void
): HTMLElement {
    const terminalId: TerminalId = getTerminalId(terminal);

    const tab: HTMLButtonElement = document.createElement('button');
    tab.className = 'agent-tab-unpinned';
    if (terminalId === activeTerminalId) {
        tab.classList.add('agent-tab-active');
    }
    tab.setAttribute('data-terminal-id', terminalId);
    tab.style.width = `${TAB_WIDTH_UNPINNED}px`;
    tab.style.height = `${TAB_WIDTH_UNPINNED}px`;
    tab.title = terminal.title;

    // Create status dot
    const statusDot: HTMLSpanElement = document.createElement('span');
    statusDot.className = terminal.isDone ? 'agent-tab-status-done' : 'agent-tab-status-running';
    tab.appendChild(statusDot);

    // Click handler - re-pin and navigate
    tab.addEventListener('click', () => {
        pinTerminal(terminalId);
        onSelect(terminal);
    });

    tab.addEventListener('mousedown', (e: MouseEvent) => {
        e.stopPropagation();
    });

    return tab;
}

// =============================================================================
// Activity Tracking
// =============================================================================

/**
 * Mark a terminal as having activity (produced a node)
 */
export function markTerminalActivityForContextNode(contextNodeId: string): void {
    const terminals: Map<TerminalId, TerminalData> = getTerminals();
    for (const [terminalId, terminal] of terminals) {
        if (terminal.attachedToNodeId === contextNodeId) {
            updateTerminal(terminalId, { activityCount: terminal.activityCount + 1 });
            console.log(`[AgentTabsBar] Marked activity for terminal ${terminalId}, count: ${terminal.activityCount + 1}`);
            return;
        }
    }
}

/**
 * Clear activity dots for a specific terminal
 */
export function clearActivityForTerminal(terminalId: TerminalId): void {
    updateTerminal(terminalId, { activityCount: 0 });
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
    // Clean up drag state
    cleanupDragState(dragState);

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
    lastOnSelect = null;

    resetAgentTabsStore();
}

export function isAgentTabsBarMounted(): boolean {
    return container !== null && container.parentNode !== null;
}
