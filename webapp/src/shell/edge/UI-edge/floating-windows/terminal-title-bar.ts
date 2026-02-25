import type cytoscape from "cytoscape";
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import type {Core} from 'cytoscape';
import {createTrafficLightsForTarget} from "@/shell/edge/UI-edge/floating-windows/traffic-lights";
import {createExpandButton} from "./expand-button";

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
): { titleBar: HTMLDivElement; contextPanel: HTMLDivElement | null } {
    const titleBar: HTMLDivElement = document.createElement('div');
    titleBar.className = 'terminal-title-bar';

    // Expand button at far-left of title bar (reads base dimensions from dataset set by createWindowChrome)
    const baseWidth: number = Number(windowElement.dataset.baseWidth ?? '0');
    const baseHeight: number = Number(windowElement.dataset.baseHeight ?? '0');
    const expandButton: HTMLButtonElement = createExpandButton(
        windowElement,
        { width: baseWidth, height: baseHeight },
        'title-bar'
    );
    titleBar.appendChild(expandButton);

    // Get the attached node ID for context detection
    const attachedNodeId: string = terminal.attachedToContextNodeId;
    const hasContextNode: boolean = isContextNodeId(attachedNodeId);

    // Create context dropdown for terminals with context nodes
    let contextPanel: HTMLDivElement | null = null;
    if (hasContextNode) {
        const { dropdown, panel } = createContextDropdown(
            terminal.title, terminal.contextContent, windowElement,
            terminal.worktreeName, terminal.terminalId
        );
        titleBar.appendChild(dropdown);
        contextPanel = panel;
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

    return { titleBar, contextPanel };
}

/**
 * Create context dropdown for terminals with context nodes.
 * Returns a dropdown element (goes in title bar) and a panel element (goes between title bar and content).
 * Click toggles panel visibility and chevron rotation; Escape dismisses.
 */
function createContextDropdown(
    title: string,
    contextContent: string,
    _windowElement: HTMLDivElement,
    worktreeName?: string,
    terminalId?: string
): { dropdown: HTMLDivElement; panel: HTMLDivElement } {
    const dropdown: HTMLDivElement = document.createElement('div');
    dropdown.className = 'terminal-context-badge';

    // Disclosure button: chevron + "ctx" label
    const btn: HTMLDivElement = document.createElement('div');
    btn.className = 'terminal-context-dropdown-btn';

    const chevron: HTMLSpanElement = document.createElement('span');
    chevron.className = 'terminal-context-chevron';
    chevron.textContent = '\u25B6'; // ▶
    btn.appendChild(chevron);

    const label: HTMLSpanElement = document.createElement('span');
    label.textContent = truncateTitle(title, 100);
    btn.appendChild(label);

    dropdown.appendChild(btn);

    // Subtitle row: agent ID + worktree on same line (kept for InjectBar compatibility)
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

        dropdown.appendChild(subtitleRow);
    }

    // Collapsible panel — sibling of title bar, not child
    const panel: HTMLDivElement = document.createElement('div');
    panel.className = 'terminal-context-panel';
    panel.textContent = contextContent;

    // Toggle panel on button click
    btn.addEventListener('click', (e: MouseEvent): void => {
        e.stopPropagation();
        const isVisible: boolean = panel.classList.toggle('visible');
        chevron.classList.toggle('expanded', isVisible);
        dropdown.classList.toggle('terminal-context-expanded', isVisible);
    });

    // Escape dismisses panel
    _windowElement.addEventListener('keydown', (e: KeyboardEvent): void => {
        if (e.key === 'Escape' && panel.classList.contains('visible')) {
            panel.classList.remove('visible');
            chevron.classList.remove('expanded');
            dropdown.classList.remove('terminal-context-expanded');
        }
    });

    return { dropdown, panel };
}
