/**
 * InjectBar - Vanilla JS component for manual node injection into agent terminals.
 *
 * Badge button showing unseen node count, popover with checkbox list,
 * "Inject Selected" and "Inject All" actions.
 *
 * Uses createElement (no innerHTML) for security. Matches .cy-floating-window dark theme.
 *
 * The popover is portaled to document.body to escape the terminal's overflow:hidden,
 * and positioned dynamically relative to the badge button via getBoundingClientRect().
 */

import type { TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import type { NodeIdAndFilePath } from '@/pure/graph';
import type {} from '@/shell/electron';

// --- InjectBar Registry ---
// Module-level map of InjectBar handles keyed by terminalId.
// Used by updateInjectBadge (renderer-side IPC handler) to push badge counts.
const injectBarRegistry: Map<TerminalId, InjectBarHandle> = new Map();

export function registerInjectBar(terminalId: TerminalId, handle: InjectBarHandle): void {
    injectBarRegistry.set(terminalId, handle);
}

export function unregisterInjectBar(terminalId: TerminalId): void {
    injectBarRegistry.delete(terminalId);
}

export function getInjectBarHandle(terminalId: TerminalId): InjectBarHandle | undefined {
    return injectBarRegistry.get(terminalId);
}

// Type returned by Phase 1 IPC: getUnseenNodesForTerminal
export interface UnseenNodeInfo {
    readonly nodeId: NodeIdAndFilePath;
    readonly title: string;
    readonly contentPreview: string;
}

// Typed interface for the main-process IPC methods used by InjectBar.
// These exist on mainAPI but TypeScript can't resolve their types in the renderer
// tsconfig because the import chain includes Node.js modules (fs, etc.).
interface InjectBarMainIPC {
    getUnseenNodesForTerminal(terminalId: string): Promise<readonly UnseenNodeInfo[]>;
    injectNodesIntoTerminal(terminalId: string, nodeIds: readonly string[]): Promise<{ success: boolean; injectedCount: number }>;
}

export interface InjectBarOptions {
    readonly terminalId: TerminalId;
    readonly onInject: (nodeIds: NodeIdAndFilePath[]) => Promise<void>;
}

export interface InjectBarHandle {
    readonly element: HTMLElement;
    readonly refresh: () => Promise<void>;
    readonly destroy: () => void;
    readonly updateBadgeCount: (count: number) => void;
}

/**
 * Create an InjectBar component for a terminal window.
 * Queries main process for unseen nodes and lets user selectively inject them.
 */
export function createInjectBar(options: InjectBarOptions): InjectBarHandle {
    const { terminalId, onInject } = options;

    // State
    let currentNodes: UnseenNodeInfo[] = [];
    let popoverVisible: boolean = false;

    // --- DOM Creation ---

    const bar: HTMLDivElement = document.createElement('div');
    bar.className = 'inject-bar';
    bar.style.display = 'none'; // Hidden until unseen nodes found

    // Badge button
    const badge: HTMLButtonElement = document.createElement('button');
    badge.className = 'inject-badge';
    badge.style.display = 'none'; // hidden when 0

    const badgeIcon: HTMLSpanElement = document.createElement('span');
    badgeIcon.className = 'inject-badge-icon';
    badgeIcon.textContent = '\u{1F489}'; // syringe emoji

    const badgeText: HTMLSpanElement = document.createElement('span');
    badgeText.className = 'inject-badge-text';

    badge.appendChild(badgeIcon);
    badge.appendChild(badgeText);

    // Popover — portaled to document.body to escape terminal's overflow:hidden
    const popover: HTMLDivElement = document.createElement('div');
    popover.className = 'inject-popover';
    popover.style.display = 'none';

    const popoverHeader: HTMLDivElement = document.createElement('div');
    popoverHeader.className = 'inject-popover-header';
    popoverHeader.textContent = 'Nearby Unseen Nodes';

    const nodeList: HTMLDivElement = document.createElement('div');
    nodeList.className = 'inject-node-list';

    const buttonRow: HTMLDivElement = document.createElement('div');
    buttonRow.className = 'inject-button-row';

    const injectSelectedBtn: HTMLButtonElement = document.createElement('button');
    injectSelectedBtn.className = 'inject-action-btn inject-selected-btn';
    injectSelectedBtn.textContent = 'Inject Selected';

    const injectAllBtn: HTMLButtonElement = document.createElement('button');
    injectAllBtn.className = 'inject-action-btn inject-all-btn';
    injectAllBtn.textContent = 'Inject All';

    buttonRow.appendChild(injectSelectedBtn);
    buttonRow.appendChild(injectAllBtn);

    popover.appendChild(popoverHeader);
    popover.appendChild(nodeList);
    popover.appendChild(buttonRow);

    bar.appendChild(badge);
    // Popover is appended to document.body (not bar) to escape overflow:hidden
    document.body.appendChild(popover);

    // --- Behavior ---

    function updateBadge(count: number): void {
        if (count === 0) {
            badge.style.display = 'none';
            bar.style.display = 'none';
            bar.classList.remove('inject-bar-visible');
            hidePopover();
        } else {
            badge.style.display = '';
            bar.style.display = '';
            bar.classList.add('inject-bar-visible');
            badgeText.textContent = `${count} unseen`;
        }
    }

    /** Position the popover above the badge button using its screen coordinates. */
    function positionPopover(): void {
        const rect: DOMRect = badge.getBoundingClientRect();
        popover.style.left = `${rect.left}px`;
        popover.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    }

    function showPopover(): void {
        positionPopover();
        popover.style.display = '';
        popoverVisible = true;
        // Always refresh when opening to ensure currentNodes is fresh
        void refresh();
    }

    function hidePopover(): void {
        popover.style.display = 'none';
        popoverVisible = false;
    }

    function rebuildNodeList(nodes: UnseenNodeInfo[]): void {
        // Clear existing items
        while (nodeList.firstChild) {
            nodeList.removeChild(nodeList.firstChild);
        }

        for (const node of nodes) {
            const label: HTMLLabelElement = document.createElement('label');
            label.className = 'inject-node-item';

            const checkbox: HTMLInputElement = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.nodeId = node.nodeId;

            const titleSpan: HTMLSpanElement = document.createElement('span');
            titleSpan.className = 'inject-node-title';
            titleSpan.textContent = node.title;
            titleSpan.title = node.title; // full title on hover

            label.appendChild(checkbox);
            label.appendChild(titleSpan);
            nodeList.appendChild(label);
        }
    }

    function getCheckedNodeIds(): NodeIdAndFilePath[] {
        const checked: NodeIdAndFilePath[] = [];
        const checkboxes: HTMLInputElement[] = Array.from(nodeList.querySelectorAll('input[type="checkbox"]:checked'));
        for (const cb of checkboxes) {
            if (cb.dataset.nodeId) {
                checked.push(cb.dataset.nodeId as NodeIdAndFilePath);
            }
        }
        return checked;
    }

    function getAllNodeIds(): NodeIdAndFilePath[] {
        return currentNodes.map((n: UnseenNodeInfo) => n.nodeId);
    }

    // Badge click toggles popover
    badge.addEventListener('click', (e: MouseEvent): void => {
        e.stopPropagation();
        if (popoverVisible) {
            hidePopover();
        } else {
            showPopover();
        }
    });

    // Inject Selected
    injectSelectedBtn.addEventListener('click', (e: MouseEvent): void => {
        e.stopPropagation();
        const selected: NodeIdAndFilePath[] = getCheckedNodeIds();
        if (selected.length === 0) return;
        injectSelectedBtn.disabled = true;
        injectAllBtn.disabled = true;
        void onInject(selected)
            .then(() => refresh())
            .catch((err: unknown) => {
                console.error('[InjectBar] Inject selected failed:', err);
            })
            .finally(() => {
                injectSelectedBtn.disabled = false;
                injectAllBtn.disabled = false;
            });
    });

    // Inject All
    injectAllBtn.addEventListener('click', (e: MouseEvent): void => {
        e.stopPropagation();
        const all: NodeIdAndFilePath[] = getAllNodeIds();
        if (all.length === 0) {
            console.warn('[InjectBar] Inject All clicked but currentNodes is empty — refreshing');
            void refresh();
            return;
        }
        injectSelectedBtn.disabled = true;
        injectAllBtn.disabled = true;
        void onInject(all)
            .then(() => refresh())
            .catch((err: unknown) => {
                console.error('[InjectBar] Inject all failed:', err);
            })
            .finally(() => {
                injectSelectedBtn.disabled = false;
                injectAllBtn.disabled = false;
            });
    });

    // Click outside popover closes it
    function handleOutsideClick(e: MouseEvent): void {
        if (popoverVisible && !popover.contains(e.target as Node) && !badge.contains(e.target as Node)) {
            hidePopover();
        }
    }
    document.addEventListener('mousedown', handleOutsideClick);

    // Prevent clicks inside popover from propagating to graph
    popover.addEventListener('mousedown', (e: MouseEvent): void => {
        e.stopPropagation();
    });

    // --- IPC ---

    // Cast main to InjectBarMainIPC — these methods exist on mainAPI but their types
    // can't resolve in the renderer tsconfig due to Node.js dependencies in the import chain.
    const mainIPC: InjectBarMainIPC | undefined = window.electronAPI?.main as unknown as InjectBarMainIPC | undefined;

    async function fetchUnseenNodes(): Promise<UnseenNodeInfo[]> {
        try {
            const result: readonly UnseenNodeInfo[] | undefined = await mainIPC?.getUnseenNodesForTerminal(terminalId);
            return result ? [...result] : [];
        } catch (err: unknown) {
            console.warn('[InjectBar] Failed to fetch unseen nodes:', err);
            return [];
        }
    }

    async function refresh(): Promise<void> {
        const nodes: UnseenNodeInfo[] = await fetchUnseenNodes();
        currentNodes = nodes;
        updateBadge(nodes.length);
        rebuildNodeList(nodes);
    }

    function destroy(): void {
        document.removeEventListener('mousedown', handleOutsideClick);
        popover.remove(); // Remove portaled popover from document.body
        bar.remove();
    }

    // Initial fetch
    void refresh();

    return { element: bar, refresh, destroy, updateBadgeCount: updateBadge };
}
