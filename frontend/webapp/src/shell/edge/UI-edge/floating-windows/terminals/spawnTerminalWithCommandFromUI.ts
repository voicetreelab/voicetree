/**
 * Terminal Flow - V2
 *
 * Rewritten to use types.ts with flat TerminalData type.
 * - IDs are derived, not stored
 * - ui field is populated after DOM creation
 * - No stored callbacks - use disposeFloatingWindow()
 */

import type { NodeIdAndFilePath, Position } from "@/pure/graph";
import type { Core, CollectionReturnValue, NodeCollection } from "cytoscape";
import * as O from 'fp-ts/lib/Option.js';
// Import for global Window.electronAPI type augmentation
import '@/shell/electron.d.ts';
import {
    createWindowChrome,
    anchorToNode,
    disposeFloatingWindow,
    getOrCreateOverlay,
} from "@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows";
import { TerminalVanilla } from "@/shell/UI/floating-windows/terminals/TerminalVanilla";
import posthog from "posthog-js";
import {
    getTerminalId,
    type TerminalData,
    type TerminalId,
    type FloatingWindowUIData,
} from "@/shell/edge/UI-edge/floating-windows/types";
import {
    vanillaFloatingWindowInstances,
} from "@/shell/edge/UI-edge/state/UIAppState";
import { getNextTerminalCount, getTerminals } from "@/shell/edge/UI-edge/state/TerminalStore";

const MAX_TERMINALS: number = 6;

/**
 * Spawn a terminal with a new context node
 *
 * This function now simply delegates to the main process, which orchestrates
 * the entire flow without needing setTimeout hacks. The main process has
 * immediate access to the graph after createContextNode completes.
 *
 * @param parentNodeId - The parent node to create context for
 * @param _cy - Cytoscape instance (unused, kept for backward compatibility)
 * @param agentCommand - Optional agent command. If not provided, uses the default (first) agent from settings.
 */
export async function spawnTerminalWithNewContextNode(
    parentNodeId: NodeIdAndFilePath,
    _cy: Core,
    agentCommand?: string,
): Promise<void> {
    const terminalsMap: Map<TerminalId, TerminalData> = getTerminals();

    // Check terminal limit
    if (terminalsMap.size >= MAX_TERMINALS) {
        alert(`Glad you are trying to power use VT! Limit of ${MAX_TERMINALS} agents at once for now but send over an email 1manumasson@gmail.com if you want to alpha-test higher limits`);
        return;
    }

    const terminalCount: number = getNextTerminalCount(terminalsMap, parentNodeId);

    // Delegate to main process which has immediate graph access
    await window.electronAPI.main.spawnTerminalWithContextNode(
        parentNodeId,
        agentCommand,
        terminalCount
    );
}

/**
 * Create a floating terminal window
 * Returns TerminalData with ui populated, or undefined if terminal already exists
 */
export async function createFloatingTerminal(
    cy: Core,
    nodeId: string,
    terminalData: TerminalData,
    nodePos: Position
): Promise<TerminalData | undefined> {
    const terminalId: TerminalId = getTerminalId(terminalData);
    console.log('[FloatingWindowManager-v2] Creating floating terminal:', terminalId);

    // Check if already exists
    const existing: NodeCollection = cy.nodes(`#${terminalId}`);
    if (existing && existing.length > 0) {
        console.log('[FloatingWindowManager-v2] Terminal already exists');
        return undefined;
    }

    // Check if parent node exists
    const parentNode: CollectionReturnValue = cy.getElementById(nodeId);
    const parentNodeExists: boolean = parentNode.length > 0;

    try {
        // Create floating terminal window (returns TerminalData with ui populated)
        const terminalWithUI: TerminalData = createFloatingTerminalWindow(cy, terminalData);

        if (parentNodeExists && O.isSome(terminalWithUI.anchoredToNodeId)) {
            // Anchor to parent node
            anchorToNode(cy, terminalWithUI);
        } else if (terminalWithUI.ui) {
            // Manual positioning if no parent or not anchored
            terminalWithUI.ui.windowElement.style.left = `${nodePos.x + 100}px`;
            terminalWithUI.ui.windowElement.style.top = `${nodePos.y}px`;
        }

        return terminalWithUI;
    } catch (error) {
        console.error('[FloatingWindowManager-v2] Error creating floating terminal:', error);
        return undefined;
    }
}

/**
 * Create a floating terminal window (no anchoring)
 * Returns TerminalData with ui populated
 */
export function createFloatingTerminalWindow(
    cy: Core,
    terminalData: TerminalData
): TerminalData {
    const terminalId: TerminalId = getTerminalId(terminalData);

    // Get overlay
    const overlay: HTMLElement = getOrCreateOverlay(cy);

    // Create window chrome using the new v2 function
    const ui: FloatingWindowUIData = createWindowChrome(cy, terminalData, terminalId);

    // Create TerminalData with ui populated (immutable)
    const terminalWithUI: TerminalData = { ...terminalData, ui };

    // Create Terminal instance
    const terminal: TerminalVanilla = new TerminalVanilla({
        container: ui.contentContainer,
        terminalData: terminalData
    });

    // Store for cleanup (legacy pattern - will be removed in future)
    vanillaFloatingWindowInstances.set(terminalId, terminal);

    // Analytics: Track terminal opened
    posthog.capture('terminal_opened', { terminalId: terminalId });

    // Attach close button handler
    const closeButton: HTMLButtonElement | null = ui.titleBar.querySelector('.cy-floating-window-close');
    if (closeButton) {
        closeButton.addEventListener('click', () => {
            closeTerminal(terminalWithUI, cy);
        });
    }

    // Attach fullscreen button handler
    const fullscreenButton: HTMLButtonElement | null = ui.titleBar.querySelector('.cy-floating-window-fullscreen');
    if (fullscreenButton) {
        fullscreenButton.addEventListener('click', () => {
            void terminal.toggleFullscreen();
        });
    }

    // Add to overlay
    overlay.appendChild(ui.windowElement);

    return terminalWithUI;
}

/**
 * Close a terminal and clean up all resources
 */
export function closeTerminal(terminal: TerminalData, cy: Core): void {
    const terminalId: TerminalId = getTerminalId(terminal);
    console.log('[closeTerminal-v2] Closing terminal:', terminalId);

    // Analytics: Track terminal closed
    posthog.capture('terminal_closed', { terminalId: terminalId });

    // Dispose vanilla instance
    const vanillaInstance: { dispose: () => void; } | undefined = vanillaFloatingWindowInstances.get(terminalId);
    if (vanillaInstance) {
        vanillaInstance.dispose();
        vanillaFloatingWindowInstances.delete(terminalId);
    }

    // Use disposeFloatingWindow from cytoscape-floating-windows.ts
    // This removes shadow node, DOM elements, and from state
    disposeFloatingWindow(cy, terminal);
}
