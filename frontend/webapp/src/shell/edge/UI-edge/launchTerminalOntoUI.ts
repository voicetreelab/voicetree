import {getTerminalId, getShadowNodeId, type TerminalData, type TerminalId} from "@/shell/edge/UI-edge/floating-windows/types";
import type {CollectionReturnValue, Core, Position as CyPosition} from "cytoscape";
import {getCyInstance} from "@/shell/edge/UI-edge/state/cytoscape-state";
import {createFloatingTerminal} from "@/shell/edge/UI-edge/floating-windows/terminals/spawnTerminalWithCommandFromUI";
import {addTerminal} from "@/shell/edge/UI-edge/state/TerminalStore";
import {cyFitWithRelativeZoom} from "@/utils/responsivePadding";

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

    // Get node position, with fallback if node not yet in Cytoscape
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

        // Zoom to terminal's neighborhood (context node + d=1 neighbors)
        const shadowNodeId: string = getShadowNodeId(terminalId);
        const terminalShadowNode: CollectionReturnValue = cy.getElementById(shadowNodeId);
        const contextNode: CollectionReturnValue = cy.getElementById(contextNodeId);
        const nodesToFit: CollectionReturnValue = contextNode.length > 0
            ? contextNode.closedNeighborhood().nodes().union(terminalShadowNode)
            : cy.collection().union(terminalShadowNode);
        cyFitWithRelativeZoom(cy, nodesToFit, 0.9);

        console.log('[uiAPI] Terminal launched:', terminalId);
    } else {
        console.error('[uiAPI] Failed to create floating terminal');
    }
}