import {getTerminalId, getShadowNodeId, type TerminalData, type TerminalId} from "@/shell/edge/UI-edge/floating-windows/types";
import type {CollectionReturnValue, Core, Position as CyPosition} from "cytoscape";
import {getCyInstance} from "@/shell/edge/UI-edge/state/cytoscape-state";
import {createFloatingTerminal} from "@/shell/edge/UI-edge/floating-windows/terminals/spawnTerminalWithCommandFromUI";
import {addTerminal, getTerminalByNodeId} from "@/shell/edge/UI-edge/state/TerminalStore";
import {vanillaFloatingWindowInstances} from "@/shell/edge/UI-edge/state/UIAppState";
import {cySmartCenter} from "@/utils/responsivePadding";
import * as O from "fp-ts/lib/Option.js";
import type {NodeIdAndFilePath} from "@/pure/graph";

/**
 * Navigate to terminal neighborhood - pans if zoom is comfortable, zooms to 1.0 if not
 */
function navigateToTerminalNeighborhood(cy: Core, contextNodeId: string, terminalId: TerminalId): void {
    const shadowNodeId: string = getShadowNodeId(terminalId);
    const terminalShadowNode: CollectionReturnValue = cy.getElementById(shadowNodeId);
    const contextNode: CollectionReturnValue = cy.getElementById(contextNodeId);
    const nodesToCenter: CollectionReturnValue = contextNode.length > 0
        ? contextNode.closedNeighborhood().nodes().union(terminalShadowNode)
        : cy.collection().union(terminalShadowNode);
    cySmartCenter(cy, nodesToCenter);
}

/**
 * Launch a terminal onto the UI, anchored to a context node
 * Called from main process after terminal data is prepared
 *
 * Only one terminal is allowed per context node. If a terminal already exists
 * for this context node, focus it instead of creating a new one.
 */
export async function launchTerminalOntoUI(
    contextNodeId: string,
    terminalData: TerminalData
): Promise<void> {
    console.log("BEFORE LAUNCH UI")
    const cy: Core = getCyInstance();

    // Check if a terminal already exists for this context node - only one allowed
    const existingTerminal: O.Option<TerminalData> = getTerminalByNodeId(contextNodeId as NodeIdAndFilePath);
    if (O.isSome(existingTerminal)) {
        const existingTerminalId: TerminalId = getTerminalId(existingTerminal.value);
        console.log('[uiAPI] Terminal already exists for context node, focusing existing:', existingTerminalId);

        // Focus the existing terminal instead of creating a new one
        const vanillaInstance: { dispose: () => void; focus?: () => void } | undefined = vanillaFloatingWindowInstances.get(existingTerminalId);
        if (vanillaInstance?.focus) {
            vanillaInstance.focus();
        }
        return;
    }

    const targetNode: CollectionReturnValue = cy.getElementById(contextNodeId);
    const nodePos: CyPosition = targetNode.length > 0
        ? targetNode.position()
        : {x: 100, y: 100};

    const terminalId: TerminalId = getTerminalId(terminalData);
    console.log('[uiAPI] launchTerminalOntoUI:', terminalId);

    const terminalWithUI: TerminalData | undefined = await createFloatingTerminal(
        cy,
        contextNodeId,
        terminalData,
        nodePos
    );

    if (terminalWithUI) {
        addTerminal(terminalWithUI);

        // Navigate to terminal neighborhood twice with delays to handle IPC race condition
        // (context node may not exist in Cytoscape yet when this runs)
        setTimeout(() => navigateToTerminalNeighborhood(cy, contextNodeId, terminalId), 600);
        setTimeout(() => navigateToTerminalNeighborhood(cy, contextNodeId, terminalId), 1100);

        // Auto-focus the terminal after launch (500ms delay to avoid race with PTY initialization)
        setTimeout(() => {
            const vanillaInstance: { dispose: () => void; focus?: () => void } | undefined = vanillaFloatingWindowInstances.get(terminalId);
            if (vanillaInstance?.focus) {
                vanillaInstance.focus();
            }
        }, 500);

        console.log('[uiAPI] Terminal launched:', terminalId);
    } else {
        console.error('[uiAPI] Failed to create floating terminal');
    }
}