import type cytoscape from "cytoscape";
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import type {Core} from 'cytoscape';
import {createTrafficLightsForTarget} from "@/shell/edge/UI-edge/floating-windows/traffic-lights";

/**
 * Check if a node ID represents a context node
 * Context nodes have 'ctx-nodes/' prefix or '_context_' in their path
 */
function isContextNodeId(nodeId: string): boolean {
    return nodeId.startsWith('ctx-nodes/') || nodeId.includes('_context_');
}

/**
 * Truncate title to max length, adding ellipsis if needed
 */
function truncateTitle(title: string, maxLength: number): string {
    if (title.length <= maxLength) {
        return title;
    }
    return title.slice(0, maxLength) + '...';
}

/**
 * Create terminal-specific title bar with traffic lights at far right
 * Phase 4: Terminals have minimal chrome - just traffic lights, no horizontal menu
 *
 * @param windowElement - The window element to attach events to
 * @param cy - Cytoscape instance
 * @param terminal - Terminal data
 * @param closeTerminal - Optional close callback (falls back to event dispatch)
 */
export function createTerminalTitleBar(
    windowElement: HTMLDivElement,
    cy: cytoscape.Core,
    terminal: TerminalData,
    closeTerminal?: (terminal: TerminalData, cy: Core) => Promise<void>
): HTMLDivElement {
    const titleBar: HTMLDivElement = document.createElement('div');
    titleBar.className = 'terminal-title-bar';

    // Get the attached node ID for context detection
    const attachedNodeId: string = terminal.attachedToContextNodeId;
    const hasContextNode: boolean = isContextNodeId(attachedNodeId);

    // Create context badge for terminals with context nodes
    if (hasContextNode) {
        const contextBadge: HTMLDivElement = createContextBadge(terminal.title, windowElement, terminal.worktreeName, terminal.terminalId);
        titleBar.appendChild(contextBadge);
    }

    const trafficLights: HTMLDivElement = createTrafficLightsForTarget({
        kind: 'terminal-window',
        terminal,
        cy,
        closeTerminal: closeTerminal ?? (async (): Promise<void> => {
            windowElement.dispatchEvent(new CustomEvent('traffic-light-close', { bubbles: true }));
        }),
    });
    trafficLights.classList.add('terminal-traffic-lights');
    trafficLights.style.position = 'absolute';
    trafficLights.style.right = '10px';
    trafficLights.style.top = '50%';
    trafficLights.style.transform = 'translateY(-50%)';

    titleBar.appendChild(trafficLights);

    return titleBar;
}

/**
 * Create context badge for terminals with context nodes
 * Shows truncated title, optionally with worktree indicator
 */
function createContextBadge(title: string, _windowElement: HTMLDivElement, worktreeName?: string, terminalId?: string): HTMLDivElement {
    const badge: HTMLDivElement = document.createElement('div');
    badge.className = 'terminal-context-badge';

    // Truncated title (max 100 chars)
    const titleSpan: HTMLSpanElement = document.createElement('span');
    titleSpan.className = 'terminal-context-badge-title';
    titleSpan.textContent = truncateTitle(title, 100);
    badge.appendChild(titleSpan);

    // Subtitle row: agent ID + worktree on same line
    if (worktreeName || terminalId) {
        const subtitleRow: HTMLSpanElement = document.createElement('span');
        subtitleRow.className = 'terminal-context-badge-subtitle';

        if (terminalId) {
            const agentSpan: HTMLSpanElement = document.createElement('span');
            agentSpan.className = 'terminal-context-badge-agent-id';
            agentSpan.textContent = terminalId;
            agentSpan.title = terminalId;
            subtitleRow.appendChild(agentSpan);
        }

        if (worktreeName) {
            const wtSpan: HTMLSpanElement = document.createElement('span');
            wtSpan.className = 'terminal-context-badge-worktree';
            wtSpan.textContent = `\u2387 ${worktreeName}`;
            wtSpan.title = worktreeName;
            subtitleRow.appendChild(wtSpan);
        }

        badge.appendChild(subtitleRow);
    }

    return badge;
}
