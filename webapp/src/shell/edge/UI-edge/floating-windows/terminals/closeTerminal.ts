import type { NodeIdAndFilePath } from "@/pure/graph";
import type { Core, CollectionReturnValue } from "cytoscape";
import { deleteNodesFromUI } from "@/shell/edge/UI-edge/graph/handleUIActions";
import { disposeFloatingWindow } from "@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows";
import posthog from "posthog-js";
import { getTerminalId, type TerminalId } from "@/shell/edge/UI-edge/floating-windows/types";
import { vanillaFloatingWindowInstances } from "@/shell/edge/UI-edge/state/UIAppState";
import { getTerminals } from "@/shell/edge/UI-edge/state/TerminalStore";
import * as O from "fp-ts/lib/Option.js";
import type { TerminalData } from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import type { GraphNode } from "@/pure/graph";
import { unregisterInjectBar } from "@/shell/UI/floating-windows/terminals/InjectBar";

/**
 * Close a terminal and clean up all resources
 */
export async function closeTerminal(terminal: TerminalData, cy: Core): Promise<void> {
    const terminalId: TerminalId = getTerminalId(terminal);

    // DEBUG: Log UI state to diagnose floating window shell bug
    // Issue: cmd-w sometimes leaves empty window frame after closing terminal
    if (!terminal.ui) {
        console.error('[closeTerminal] BUG: terminal.ui is undefined!', {
            terminalId,
            attachedToNodeId: terminal.attachedToContextNodeId,
        });
    }

    // Phase 3: Notify main process to remove from registry
    // This ensures main stays in sync when terminal is closed from UI
    void window.electronAPI?.main.removeTerminalFromRegistry(terminalId);

    // Analytics: Track terminal closed
    posthog.capture('terminal_closed', { terminalId: terminalId });

    // Clean up InjectBar registry entry
    unregisterInjectBar(terminalId);

    // Dispose vanilla instance
    const vanillaInstance: { dispose: () => void; } | undefined = vanillaFloatingWindowInstances.get(terminalId);
    if (vanillaInstance) {
        vanillaInstance.dispose();
        vanillaFloatingWindowInstances.delete(terminalId);
    }

    // Use disposeFloatingWindow from cytoscape-floating-windows.ts
    // This removes shadow node, DOM elements, and from state (local removal for immediate UI consistency)
    disposeFloatingWindow(cy, terminal);

    // Remove hasRunningTerminal flag from parent node if no other terminals are anchored to it
    if (O.isSome(terminal.anchoredToNodeId)) {
        const parentNodeId: string = terminal.anchoredToNodeId.value;
        // Check if other terminals are still anchored to the same parent (current terminal already removed)
        const terminals: Map<TerminalId, TerminalData> = getTerminals();
        const remainingTerminalsOnParent: TerminalData[] = Array.from(terminals.values())
            .filter((t: TerminalData) =>
                O.isSome(t.anchoredToNodeId) && t.anchoredToNodeId.value === parentNodeId
            );

        if (remainingTerminalsOnParent.length === 0) {
            const parentNode: CollectionReturnValue = cy.getElementById(parentNodeId);
            if (parentNode.length > 0) {
                parentNode.data('hasRunningTerminal', false);
                //console.log('[closeTerminal-v2] Removed task node indicator from:', parentNodeId);
            }
        }
    }

    // Delete the context node if this was the last terminal attached to it
    await deleteContextNodeIfLastTerminal(terminal.attachedToContextNodeId, cy);
}

/**
 * Delete the context node if:
 * 1. It exists in the graph
 * 2. It has isContextNode: true
 * 3. No other terminals are still attached to it
 *
 * Uses deleteNodesFromUI which handles transitive edge preservation.
 */
async function deleteContextNodeIfLastTerminal(nodeId: NodeIdAndFilePath, cy: Core): Promise<void> {
    try {
        const node: GraphNode | undefined = await window.electronAPI?.main.getNode(nodeId);
        if (!node) return;

        // Only delete if it's a context node
        if (!node.nodeUIMetadata.isContextNode) return;

        // Check if other terminals are still attached (current terminal already removed from store)
        const terminals: Map<TerminalId, TerminalData> = getTerminals();
        const remainingTerminals: TerminalData[] = Array.from(terminals.values())
            .filter((t: TerminalData) => t.attachedToContextNodeId === nodeId);

        if (remainingTerminals.length > 0) {
            //console.log('[closeTerminal] Other terminals still attached, not deleting context node:', nodeId);
            return;
        }

        // Use the canonical delete path with transitive edge preservation
        await deleteNodesFromUI([nodeId], cy);
        //console.log('[closeTerminal] Deleted context node:', nodeId);
    } catch (error) {
        console.error('[closeTerminal] Failed to delete context node:', error);
    }
}

/**
 * Close all terminals and clean up their UI resources.
 * Used when switching folders - does not delete context nodes since the graph is being cleared.
 */
export function closeAllTerminals(cy: Core): void {
    //console.log('[closeAllTerminals] Closing all terminals');
    const terminals: Map<TerminalId, TerminalData> = getTerminals();

    for (const terminal of terminals.values()) {
        const terminalId: TerminalId = getTerminalId(terminal);

        // Clean up InjectBar registry entry
        unregisterInjectBar(terminalId);

        // Dispose vanilla instance
        const vanillaInstance: { dispose: () => void; } | undefined = vanillaFloatingWindowInstances.get(terminalId);
        if (vanillaInstance) {
            vanillaInstance.dispose();
            vanillaFloatingWindowInstances.delete(terminalId);
        }

        // Dispose floating window (removes shadow node, DOM elements)
        disposeFloatingWindow(cy, terminal);
    }

    // Clear the terminal store - import clearTerminals
    // Note: disposeFloatingWindow already removes from store, but clear to be safe
}
