/**
 * TerminalTreeSidebar - Tree-style vertical tabs for terminals
 *
 * Features:
 * - Vertical sidebar showing terminals in hierarchical tree structure
 * - Child terminals (spawned via spawn_agent) indented under parent
 * - Status indicators: ◌ running (dashed border animated), ● done (green filled)
 * - Click to navigate to terminal
 * - Close button appears on hover
 * - Resizable sidebar (60-300px range)
 *
 * Architecture:
 * - Uses buildTerminalTree() from pure module for tree construction
 * - Module-level state for DOM references (same pattern as AgentTabsBar)
 * - Delegates to TerminalStore for terminal state
 */

import type { TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import { getTerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType';
import { buildTerminalTree, type TerminalTreeNode } from '@/pure/agentTabs/terminalTree';
import {
    getActiveTerminalId,
    setActiveTerminalId,
} from '@/shell/edge/UI-edge/state/AgentTabsStore';
import { clearTerminals } from '@/shell/edge/UI-edge/state/TerminalStore';
import {
    startTerminalActivityPolling,
    stopTerminalActivityPolling,
} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalActivityPolling';
// Re-export activity tracking functions for backwards compatibility
export { markTerminalActivityForContextNode, clearActivityForTerminal } from './agentTabsActivity';

// =============================================================================
// DOM Element Refs (UI-only state)
// =============================================================================

let sidebarElement: HTMLElement | null = null;
let containerElement: HTMLElement | null = null;
let resizeHandle: HTMLElement | null = null;

// =============================================================================
// Create/Mount Sidebar
// =============================================================================

/**
 * Create and mount the terminal tree sidebar into a parent container.
 * Returns a cleanup function.
 */
export function createTerminalTreeSidebar(container: HTMLElement): () => void {
    // Clean up any existing instance
    disposeTerminalTreeSidebar();

    // Create main sidebar container
    sidebarElement = document.createElement('div');
    sidebarElement.className = 'terminal-tree-sidebar';
    sidebarElement.setAttribute('data-testid', 'terminal-tree-sidebar');

    // Create header
    const header: HTMLDivElement = document.createElement('div');
    header.className = 'terminal-tree-header';
    header.textContent = 'Terminals';

    // Create scrollable container for tree nodes
    containerElement = document.createElement('div');
    containerElement.className = 'terminal-tree-container';

    // Create resize handle
    resizeHandle = document.createElement('div');
    resizeHandle.className = 'terminal-tree-resize-handle';

    sidebarElement.appendChild(header);
    sidebarElement.appendChild(containerElement);
    sidebarElement.appendChild(resizeHandle);
    container.appendChild(sidebarElement);

    // Initially hidden until we have terminals
    sidebarElement.style.display = 'none';

    // Setup resize behavior
    setupResizeHandler();

    // Start activity polling (marks terminals as done/running based on inactivity)
    startTerminalActivityPolling();

    return disposeTerminalTreeSidebar;
}

// =============================================================================
// Resize Logic
// =============================================================================

function setupResizeHandler(): void {
    if (!resizeHandle || !sidebarElement) return;

    let isResizing: boolean = false;
    let startX: number = 0;
    let startWidth: number = 0;

    const onMouseDown: (e: MouseEvent) => void = (e: MouseEvent): void => {
        isResizing = true;
        startX = e.clientX;
        startWidth = sidebarElement!.offsetWidth;
        resizeHandle!.classList.add('dragging');
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        e.preventDefault();
    };

    const onMouseMove: (e: MouseEvent) => void = (e: MouseEvent): void => {
        if (!isResizing || !sidebarElement) return;
        const deltaX: number = e.clientX - startX;
        const newWidth: number = Math.min(300, Math.max(60, startWidth + deltaX));
        sidebarElement.style.width = `${newWidth}px`;
    };

    const onMouseUp: () => void = (): void => {
        isResizing = false;
        resizeHandle?.classList.remove('dragging');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    };

    resizeHandle.addEventListener('mousedown', onMouseDown);
}

// =============================================================================
// Render Tree
// =============================================================================

/**
 * Render terminal tree from flat list of terminals.
 * Called on terminal changes by setupViewSubscriptions.
 */
export function renderTerminalTree(
    terminals: TerminalData[],
    onSelect: (terminal: TerminalData) => void
): void {
    if (!containerElement || !sidebarElement) {
        console.warn('[TerminalTreeSidebar] Not mounted, cannot render');
        return;
    }

    // Clear existing nodes
    containerElement.innerHTML = '';

    // Build tree structure
    const treeNodes: TerminalTreeNode[] = buildTerminalTree(terminals);
    const activeTerminalId: TerminalId | null = getActiveTerminalId();

    // Create DOM nodes for each tree node
    for (const treeNode of treeNodes) {
        const nodeElement: HTMLElement = createTreeNode(treeNode, activeTerminalId, onSelect);
        containerElement.appendChild(nodeElement);
    }

    // Update visibility based on whether we have terminals
    sidebarElement.style.display = terminals.length > 0 ? 'flex' : 'none';
}

/**
 * Create a DOM element for a single tree node.
 */
function createTreeNode(
    treeNode: TerminalTreeNode,
    activeTerminalId: TerminalId | null,
    onSelect: (terminal: TerminalData) => void
): HTMLElement {
    const { terminal, depth } = treeNode;
    const terminalId: TerminalId = getTerminalId(terminal);

    const node: HTMLDivElement = document.createElement('div');
    node.className = 'terminal-tree-node';
    node.setAttribute('data-depth', String(depth));
    node.setAttribute('data-terminal-id', terminalId);

    if (terminalId === activeTerminalId) {
        node.classList.add('active');
    }

    // Status indicator
    const status: HTMLSpanElement = document.createElement('span');
    status.className = `terminal-tree-status ${terminal.isDone ? 'done' : 'running'}`;
    node.appendChild(status);

    // Title
    const title: HTMLSpanElement = document.createElement('span');
    title.className = 'terminal-tree-title';
    title.textContent = terminal.title;
    node.appendChild(title);

    // Close button
    const closeBtn: HTMLButtonElement = document.createElement('button');
    closeBtn.className = 'terminal-tree-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        // Dispatch close event - terminal windows listen for this
        const terminalElement: Element | null = document.querySelector(`[data-floating-window-id="${terminalId}"]`);
        if (terminalElement) {
            terminalElement.dispatchEvent(new CustomEvent('traffic-light-close', { bubbles: true }));
        }
    });
    node.appendChild(closeBtn);

    // Click handler - navigate to terminal
    node.addEventListener('click', () => {
        onSelect(terminal);
    });

    // Prevent drag in sidebar
    node.addEventListener('mousedown', (e: MouseEvent) => {
        e.stopPropagation();
    });

    return node;
}

// =============================================================================
// Set Active Terminal
// =============================================================================

/**
 * Update which terminal is highlighted as active.
 */
export function setActiveTerminal(terminalId: TerminalId | null): void {
    setActiveTerminalId(terminalId);

    if (!containerElement) return;

    // Update active class on all nodes
    const nodes: HTMLCollectionOf<Element> = containerElement.getElementsByClassName('terminal-tree-node');
    for (let i: number = 0; i < nodes.length; i++) {
        const node: Element = nodes[i];
        const nodeTerminalId: string | null = node.getAttribute('data-terminal-id');

        if (nodeTerminalId === terminalId) {
            node.classList.add('active');
        } else {
            node.classList.remove('active');
        }
    }
}

// =============================================================================
// Cleanup
// =============================================================================

/**
 * Dispose the terminal tree sidebar and clean up resources.
 * Also clears terminal stores to ensure clean state when switching projects.
 */
export function disposeTerminalTreeSidebar(): void {
    // Stop activity polling
    stopTerminalActivityPolling();

    if (sidebarElement && sidebarElement.parentNode) {
        sidebarElement.parentNode.removeChild(sidebarElement);
    }

    sidebarElement = null;
    containerElement = null;
    resizeHandle = null;

    // Clear terminal stores to ensure clean state when switching projects
    // (clearTerminals also resets derived AgentTabsStore state)
    clearTerminals();
}

/**
 * Check if the sidebar is mounted.
 */
export function isTerminalTreeSidebarMounted(): boolean {
    return sidebarElement !== null && sidebarElement.parentNode !== null;
}
