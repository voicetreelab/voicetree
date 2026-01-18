/**
 * Tab element creation for AgentTabsBar
 * Handles DOM creation for pinned and unpinned terminal tabs
 */

import type { TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import { getTerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType';
import {
    TAB_WIDTH_PINNED,
    TAB_WIDTH_UNPINNED,
    getShortcutHintForTab,
    truncateTabTitle,
} from '@/pure/agentTabs';
import {
    cleanupDragState,
    calculateAdjustedTargetIndex,
} from '@/shell/UI/behaviors/dragReorder';

// Minimum distance (in pixels) mouse must move to initiate drag vs click
const DRAG_THRESHOLD_PX: number = 5;

/** Dependencies injected from AgentTabsBar */
export interface TabCreationDeps {
    readonly dragState: { draggingFromIndex: number | null; ghostElement: HTMLElement | null; ghostTargetIndex: number | null };
    readonly pinnedContainer: HTMLElement | null;
    readonly unpinTerminal: (terminalId: TerminalId) => void;
    readonly pinTerminal: (terminalId: TerminalId) => void;
    readonly triggerDeferredRenderIfNeeded: () => void;
    readonly reorderTerminal: (fromIndex: number, toIndex: number) => void;
    readonly createGhostElement: () => HTMLElement;
}

export function createPinnedTab(
    terminal: TerminalData,
    activeTerminalId: TerminalId | null,
    onSelect: (terminal: TerminalData) => void,
    index: number,
    activeIndex: number,
    totalTabs: number,
    deps: TabCreationDeps
): HTMLElement {
    const terminalId: TerminalId = getTerminalId(terminal);
    const displayTitle: string = truncateTabTitle(terminal.title);

    // Track mousedown position and drag state for click vs drag detection
    let mouseDownPos: { x: number; y: number } | null = null;
    let isDragActive: boolean = false;

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

    // Double-click handler - unpin the tab
    tab.addEventListener('dblclick', (e: MouseEvent) => {
        e.stopPropagation();
        deps.unpinTerminal(terminalId);
    });

    // Drag-and-drop for reordering
    tab.draggable = true;

    // Record mousedown position and reset drag state
    tab.addEventListener('mousedown', (e: MouseEvent) => {
        e.stopPropagation();
        mouseDownPos = { x: e.clientX, y: e.clientY };
        isDragActive = false;
    });

    // Handle selection on mouseup - this fires reliably regardless of drag state
    tab.addEventListener('mouseup', (e: MouseEvent) => {
        if (mouseDownPos !== null && !isDragActive) {
            const dx: number = e.clientX - mouseDownPos.x;
            const dy: number = e.clientY - mouseDownPos.y;
            const distance: number = Math.sqrt(dx * dx + dy * dy);

            if (distance < DRAG_THRESHOLD_PX) {
                onSelect(terminal);
            }
        }
        mouseDownPos = null;
    });

    tab.addEventListener('dragstart', (e: DragEvent) => {
        if (mouseDownPos !== null) {
            const dx: number = e.clientX - mouseDownPos.x;
            const dy: number = e.clientY - mouseDownPos.y;
            const distance: number = Math.sqrt(dx * dx + dy * dy);

            if (distance < DRAG_THRESHOLD_PX) {
                e.preventDefault();
                return;
            }
        }

        isDragActive = true;
        e.stopPropagation();
        tab.classList.add('agent-tab-dragging');
        e.dataTransfer?.setData('text/plain', String(index));
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
        }
        deps.dragState.draggingFromIndex = index;
        deps.dragState.ghostElement = deps.createGhostElement();
    });

    tab.addEventListener('dragend', (e: DragEvent) => {
        e.stopPropagation();
        tab.classList.remove('agent-tab-dragging');
        isDragActive = false;
        cleanupDragState(deps.dragState);
        deps.triggerDeferredRenderIfNeeded();
    });

    tab.addEventListener('dragover', (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move';
        }
        if (deps.dragState.draggingFromIndex === index) {
            return;
        }
        if (deps.dragState.ghostElement && deps.pinnedContainer) {
            const rect: DOMRect = wrapper.getBoundingClientRect();
            const midpoint: number = rect.left + rect.width / 2;
            const isRightHalf: boolean = e.clientX > midpoint;

            if (isRightHalf) {
                const nextSibling: Element | null = wrapper.nextElementSibling;
                if (nextSibling && !nextSibling.classList.contains('agent-tab-ghost')) {
                    deps.pinnedContainer.insertBefore(deps.dragState.ghostElement, nextSibling);
                } else if (!nextSibling) {
                    deps.pinnedContainer.appendChild(deps.dragState.ghostElement);
                }
                deps.dragState.ghostTargetIndex = index + 1;
            } else {
                deps.pinnedContainer.insertBefore(deps.dragState.ghostElement, wrapper);
                deps.dragState.ghostTargetIndex = index;
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
        const targetIndex: number | null = deps.dragState.ghostTargetIndex;
        cleanupDragState(deps.dragState);

        if (fromIndex >= 0 && targetIndex !== null && fromIndex !== targetIndex) {
            const adjustedTarget: number = calculateAdjustedTargetIndex(fromIndex, targetIndex);
            deps.reorderTerminal(fromIndex, adjustedTarget);
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

export function createUnpinnedTab(
    terminal: TerminalData,
    activeTerminalId: TerminalId | null,
    onSelect: (terminal: TerminalData) => void,
    deps: Pick<TabCreationDeps, 'pinTerminal'>
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
        deps.pinTerminal(terminalId);
        onSelect(terminal);
    });

    tab.addEventListener('mousedown', (e: MouseEvent) => {
        e.stopPropagation();
    });

    return tab;
}
