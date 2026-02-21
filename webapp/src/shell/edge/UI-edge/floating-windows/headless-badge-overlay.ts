/**
 * Headless Badge Overlay — lightweight status badges on task nodes for headless agents.
 *
 * Renders HTML badge divs in the floating window overlay, positioned on task nodes.
 * No Cytoscape shadow nodes — just DOM management over the existing overlay.
 *
 * Data flow: syncTerminals → updateHeadlessBadges() → DOM
 * Position sync: Cytoscape zoom → badge repositioning (pan handled by overlay transform)
 */

import type {Core, CollectionReturnValue} from 'cytoscape';
import type {TerminalId} from '@/shell/edge/UI-edge/floating-windows/types';
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType';
import type {TerminalStatus} from '@/shell/edge/main/terminals/terminal-registry';
import {getTerminals, getTerminalStatus} from '@/shell/edge/UI-edge/state/TerminalStore';
import {getCyInstance} from '@/shell/edge/UI-edge/state/cytoscape-state';
import {getOrCreateOverlay} from '@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows';
import {graphToScreenPosition} from '@/pure/graph/floating-windows/floatingWindowScaling';
import * as O from 'fp-ts/lib/Option.js';

// ─── Module State ─────────────────────────────────────────────────────────────

const badgeElements: Map<TerminalId, HTMLElement> = new Map();
// Track which Cytoscape node each badge is anchored to (needed for cleanup after terminal removal)
const badgeNodeIds: Map<TerminalId, string> = new Map();
let zoomListenerRegistered: boolean = false;

// Hover popover state
let activePopover: HTMLElement | null = null;
let activePopoverTerminalId: TerminalId | null = null;
let hoverDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const HOVER_DEBOUNCE_MS: number = 150;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Update headless agent badges on the overlay.
 * Called from api.ts syncTerminals after TerminalStore is updated.
 * Lazy-initializes overlay access and zoom listener on first headless terminal.
 */
export function updateHeadlessBadges(): void {
    let cy: Core;
    try {
        cy = getCyInstance();
    } catch {
        return; // Cytoscape not initialized yet
    }

    const terminals: Map<TerminalId, TerminalData> = getTerminals();
    const headlessTerminals: TerminalData[] = [];
    for (const terminal of terminals.values()) {
        if (terminal.isHeadless) {
            headlessTerminals.push(terminal);
        }
    }

    // Nothing to do if no headless terminals and no existing badges
    if (headlessTerminals.length === 0 && badgeElements.size === 0) return;

    // Lazy-register zoom listener for badge repositioning
    if (!zoomListenerRegistered) {
        cy.on('zoom', repositionBadges);
        zoomListenerRegistered = true;
    }

    const overlay: HTMLElement = getOrCreateOverlay(cy);

    // Remove badges for terminals that no longer exist in the store
    const activeIds: Set<TerminalId> = new Set(headlessTerminals.map(t => t.terminalId));
    for (const [terminalId, element] of badgeElements) {
        if (!activeIds.has(terminalId)) {
            element.remove();
            badgeElements.delete(terminalId);

            // Clear hasRunningTerminal on task node if no other terminals remain
            const nodeId: string | undefined = badgeNodeIds.get(terminalId);
            badgeNodeIds.delete(terminalId);
            if (nodeId && !hasTerminalsOnNode(nodeId)) {
                const node: CollectionReturnValue = cy.getElementById(nodeId);
                if (node.length > 0) {
                    node.data('hasRunningTerminal', false);
                }
            }
        }
    }

    // Create or update badges for each headless terminal
    for (const terminal of headlessTerminals) {
        const status: TerminalStatus = getTerminalStatus(terminal.terminalId) ?? 'running';
        const existing: HTMLElement | undefined = badgeElements.get(terminal.terminalId);

        if (existing) {
            updateBadgeContent(existing, terminal, status);
        } else {
            const badge: HTMLElement = createBadgeElement(terminal, status);
            overlay.appendChild(badge);
            badgeElements.set(terminal.terminalId, badge);

            // Track anchored node and mark it as having a running terminal (shape → square)
            if (O.isSome(terminal.anchoredToNodeId)) {
                badgeNodeIds.set(terminal.terminalId, terminal.anchoredToNodeId.value);
                const node: CollectionReturnValue = cy.getElementById(terminal.anchoredToNodeId.value);
                if (node.length > 0) {
                    node.data('hasRunningTerminal', true);
                }
            }
        }
    }

    repositionBadges();
}

/**
 * Destroy all headless badges. Called on project switch / cleanup.
 */
export function destroyHeadlessBadges(): void {
    dismissPopover();
    for (const element of badgeElements.values()) {
        element.remove();
    }
    badgeElements.clear();
    badgeNodeIds.clear();
    zoomListenerRegistered = false;
}

// ─── Internal Functions ───────────────────────────────────────────────────────

function createBadgeElement(terminal: TerminalData, status: TerminalStatus): HTMLElement {
    const badge: HTMLElement = document.createElement('div');
    badge.className = 'headless-agent-badge';
    badge.dataset.terminalId = terminal.terminalId;
    updateBadgeContent(badge, terminal, status);

    // Attach hover listeners for output popover
    badge.addEventListener('mouseenter', () => {
        onBadgeMouseEnter(terminal.terminalId, badge);
    });
    badge.addEventListener('mouseleave', () => {
        onBadgeMouseLeave();
    });

    return badge;
}

function updateBadgeContent(badge: HTMLElement, terminal: TerminalData, status: TerminalStatus): void {
    const statusClass: string = status === 'running' ? 'running' : 'exited';
    const statusIcon: string = status === 'running' ? '\u21BB' : '\u2713'; // ↻ or ✓
    const statusLabel: string = status === 'running' ? 'running' : 'done';

    badge.className = `headless-agent-badge ${statusClass}`;
    badge.innerHTML =
        `<span class="headless-badge-dot"></span>` +
        `<span class="headless-badge-name">${escapeHtml(terminal.agentName)}</span>` +
        `<span class="headless-badge-status">${statusIcon} ${statusLabel}</span>`;
}

/**
 * Reposition all badge elements based on current Cytoscape node positions and zoom.
 * Called on zoom events and after badge creation/updates.
 */
function repositionBadges(): void {
    let cy: Core;
    try {
        cy = getCyInstance();
    } catch {
        return;
    }

    const zoom: number = cy.zoom();
    const terminals: Map<TerminalId, TerminalData> = getTerminals();

    for (const [terminalId, badge] of badgeElements) {
        const terminal: TerminalData | undefined = terminals.get(terminalId);
        if (!terminal || !O.isSome(terminal.anchoredToNodeId)) continue;

        const node: CollectionReturnValue = cy.getElementById(terminal.anchoredToNodeId.value);
        if (node.length === 0) continue;

        const pos: { x: number; y: number } = node.position();
        const nodeHeight: number = node.height() ?? 40;
        // Position badge just below the node bottom edge
        const screenPos: { readonly x: number; readonly y: number } = graphToScreenPosition(
            { x: pos.x, y: pos.y + nodeHeight / 2 + 15 },
            zoom
        );
        badge.style.left = `${screenPos.x}px`;
        badge.style.top = `${screenPos.y}px`;
    }
}

/**
 * Check if any terminal (headless or interactive) is still anchored to a node.
 * Used to determine whether to clear hasRunningTerminal flag.
 */
function hasTerminalsOnNode(nodeId: string): boolean {
    const terminals: Map<TerminalId, TerminalData> = getTerminals();
    for (const terminal of terminals.values()) {
        if (O.isSome(terminal.anchoredToNodeId) && terminal.anchoredToNodeId.value === nodeId) {
            return true;
        }
    }
    return false;
}

// ─── Hover Popover ────────────────────────────────────────────────────────────

/**
 * Debounced mouseenter handler: fetch output from main process and show popover.
 */
function onBadgeMouseEnter(terminalId: TerminalId, badge: HTMLElement): void {
    if (hoverDebounceTimer !== null) {
        clearTimeout(hoverDebounceTimer);
    }
    hoverDebounceTimer = setTimeout(() => {
        void showOutputPopover(terminalId, badge);
    }, HOVER_DEBOUNCE_MS);
}

function onBadgeMouseLeave(): void {
    if (hoverDebounceTimer !== null) {
        clearTimeout(hoverDebounceTimer);
        hoverDebounceTimer = null;
    }
    dismissPopover();
}

/**
 * Fetch headless agent output via IPC and display in a floating popover near the badge.
 */
async function showOutputPopover(terminalId: TerminalId, badge: HTMLElement): Promise<void> {
    // Dismiss any existing popover first
    dismissPopover();

    const output: string = await window.electronAPI?.main.getHeadlessAgentOutput(terminalId) as string;

    // Check if mouse has already left (race condition with async IPC)
    if (hoverDebounceTimer === null && activePopoverTerminalId !== terminalId) {
        return;
    }

    const popover: HTMLElement = document.createElement('div');
    popover.className = 'headless-output-popover';

    if (!output || output.trim().length === 0) {
        popover.textContent = '(no output yet)';
    } else {
        // Show last ~2000 chars to keep popover manageable
        const truncated: string = output.length > 2000
            ? '…' + output.slice(-2000)
            : output;
        popover.textContent = truncated;
    }

    // Also dismiss popover when mouse leaves the popover itself
    popover.addEventListener('mouseenter', () => {
        // Keep popover alive while mouse is over it
        if (hoverDebounceTimer !== null) {
            clearTimeout(hoverDebounceTimer);
            hoverDebounceTimer = null;
        }
    });
    popover.addEventListener('mouseleave', () => {
        dismissPopover();
    });

    // Position above the badge
    const badgeRect: DOMRect = badge.getBoundingClientRect();
    popover.style.position = 'fixed';
    popover.style.left = `${badgeRect.left}px`;
    popover.style.bottom = `${window.innerHeight - badgeRect.top + 4}px`;

    document.body.appendChild(popover);
    activePopover = popover;
    activePopoverTerminalId = terminalId;
}

function dismissPopover(): void {
    if (activePopover) {
        activePopover.remove();
        activePopover = null;
        activePopoverTerminalId = null;
    }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
    const div: HTMLElement = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
