import {getTerminalId, getShadowNodeId, type TerminalData, type TerminalId} from "@/shell/edge/UI-edge/floating-windows/types";
import type {CollectionReturnValue, Core, Position as CyPosition} from "cytoscape";
import {getCyInstance} from "@/shell/edge/UI-edge/state/cytoscape-state";
import {createFloatingTerminal} from "@/shell/edge/UI-edge/floating-windows/terminals/spawnTerminalWithCommandFromUI";
import {addTerminal} from "@/shell/edge/UI-edge/state/TerminalStore";
import {cyFitWithRelativeZoom} from "@/utils/responsivePadding";
import {vanillaFloatingWindowInstances} from "@/shell/edge/UI-edge/state/UIAppState";

/**
 * Zoom to terminal neighborhood (context node + d=1 neighbors + terminal shadow node)
 */
function zoomToTerminalNeighborhood(cy: Core, contextNodeId: string, terminalId: TerminalId): void {
    const shadowNodeId: string = getShadowNodeId(terminalId);
    const terminalShadowNode: CollectionReturnValue = cy.getElementById(shadowNodeId);
    const contextNode: CollectionReturnValue = cy.getElementById(contextNodeId);
    const nodesToFit: CollectionReturnValue = contextNode.length > 0
        ? contextNode.closedNeighborhood().nodes().union(terminalShadowNode)
        : cy.collection().union(terminalShadowNode);
    cyFitWithRelativeZoom(cy, nodesToFit, 0.9);
}

/**
 * Launch a terminal onto the UI, anchored to a context node
 * Called from main process after terminal data is prepared
 */
export async function launchTerminalOntoUI(
    contextNodeId: string,
    terminalData: TerminalData
): Promise<void> {
    console.log("BEFORE LAUNCH UI")
    const cy: Core = getCyInstance();

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

        // Zoom to terminal neighborhood twice with delays to handle IPC race condition
        // (context node may not exist in Cytoscape yet when this runs)
        setTimeout(() => zoomToTerminalNeighborhood(cy, contextNodeId, terminalId), 600);
        setTimeout(() => zoomToTerminalNeighborhood(cy, contextNodeId, terminalId), 1100);

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