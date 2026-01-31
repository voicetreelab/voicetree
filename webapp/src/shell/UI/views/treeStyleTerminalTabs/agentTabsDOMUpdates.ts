/**
 * Targeted DOM updates for agent tabs
 * Updates specific DOM elements without triggering full re-renders.
 * This fixes the click race condition by avoiding innerHTML = '' on frequent updates.
 */

import type { TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';

/**
 * Update the status dot (running/done indicator) for a specific terminal tab.
 * Finds the tab by data-terminal-id and updates the status dot class.
 */
export function updateTerminalStatusDot(terminalId: TerminalId, isDone: boolean): void {
    // Try pinned tab wrapper first
    const pinnedWrapper: HTMLElement | null = document.querySelector(
        `.agent-tab-wrapper[data-terminal-id="${terminalId}"]`
    );
    if (pinnedWrapper) {
        const dot: Element | null = pinnedWrapper.querySelector('.agent-tab-status-running, .agent-tab-status-done');
        if (dot) {
            dot.className = isDone ? 'agent-tab-status-done' : 'agent-tab-status-running';
        }
        return;
    }

    // Try unpinned tab
    const unpinnedTab: HTMLElement | null = document.querySelector(
        `.agent-tab-unpinned[data-terminal-id="${terminalId}"]`
    );
    if (unpinnedTab) {
        const dot: Element | null = unpinnedTab.querySelector('.agent-tab-status-running, .agent-tab-status-done');
        if (dot) {
            dot.className = isDone ? 'agent-tab-status-done' : 'agent-tab-status-running';
        }
    }
}

/**
 * Update the activity dots (blue node creation indicators) for a specific terminal tab.
 * Only applies to pinned tabs since unpinned tabs don't show activity dots.
 */
export function updateTerminalActivityDots(terminalId: TerminalId, count: number): void {
    const wrapper: HTMLElement | null = document.querySelector(
        `.agent-tab-wrapper[data-terminal-id="${terminalId}"]`
    );
    if (!wrapper) return;

    const tab: HTMLElement | null = wrapper.querySelector('.agent-tab');
    if (!tab) return;

    // Remove existing activity dots
    tab.querySelectorAll('.agent-tab-activity-dot').forEach(dot => dot.remove());

    // Add new activity dots
    for (let i: number = 0; i < count; i++) {
        const dot: HTMLSpanElement = document.createElement('span');
        dot.className = 'agent-tab-activity-dot';
        dot.style.left = `${4 + i * 12}px`;
        tab.appendChild(dot);
    }
}
