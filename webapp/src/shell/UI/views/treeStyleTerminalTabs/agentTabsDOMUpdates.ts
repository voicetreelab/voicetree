/**
 * Targeted DOM updates for terminal tree sidebar
 * Updates specific DOM elements without triggering full re-renders.
 * This fixes the click race condition by avoiding innerHTML = '' on frequent updates.
 */

import type { TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';

/**
 * Update the status dot (running/done indicator) for a specific terminal.
 * Finds the tree node by data-terminal-id and updates the status dot class.
 */
export function updateTerminalStatusDot(terminalId: TerminalId, isDone: boolean): void {
    const treeNode: HTMLElement | null = document.querySelector(
        `.terminal-tree-node[data-terminal-id="${terminalId}"]`
    );
    if (treeNode) {
        const status: Element | null = treeNode.querySelector('.terminal-tree-status');
        if (status) {
            status.className = `terminal-tree-status ${isDone ? 'done' : 'running'}`;
        }
    }
}

/**
 * Update the activity dots (blue node creation indicators) for a specific terminal.
 * Targets the TerminalTreeSidebar DOM structure.
 */
export function updateTerminalActivityDots(terminalId: TerminalId, count: number): void {
    const treeNode: HTMLElement | null = document.querySelector(
        `.terminal-tree-node[data-terminal-id="${terminalId}"]`
    );
    if (!treeNode) return;

    // Remove existing activity dots
    treeNode.querySelectorAll('.terminal-tree-activity-dot').forEach(dot => dot.remove());

    // Add new activity dots (positioned after title, before close button)
    const closeBtn: Element | null = treeNode.querySelector('.terminal-tree-close');
    const title: Element | null = treeNode.querySelector('.terminal-tree-title');
    for (let i: number = 0; i < count; i++) {
        const dot: HTMLSpanElement = document.createElement('span');
        dot.className = 'terminal-tree-activity-dot';
        if (closeBtn) {
            treeNode.insertBefore(dot, closeBtn);
        } else if (title) {
            title.after(dot);
        } else {
            treeNode.appendChild(dot);
        }
    }
}
