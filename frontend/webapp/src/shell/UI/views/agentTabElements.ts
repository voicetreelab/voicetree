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

/** Dependencies injected from AgentTabsBar */
export interface TabCreationDeps {
    readonly unpinTerminal: (terminalId: TerminalId) => void;
    readonly pinTerminal: (terminalId: TerminalId) => void;
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

    // Click handler - navigate to terminal
    tab.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        onSelect(terminal);
    });

    // Double-click handler - unpin the tab
    tab.addEventListener('dblclick', (e: MouseEvent) => {
        e.stopPropagation();
        deps.unpinTerminal(terminalId);
    });

    // Prevent window drag in title bar area
    tab.addEventListener('mousedown', (e: MouseEvent) => {
        e.stopPropagation();
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
