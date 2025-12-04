import {getTerminalId, type TerminalData, type TerminalId} from "@/shell/edge/UI-edge/floating-windows/types";
import type {CollectionReturnValue, Core, Position as CyPosition} from "cytoscape";
import {getCyInstance} from "@/shell/edge/UI-edge/state/cytoscape-state";
import {createFloatingTerminal} from "@/shell/edge/UI-edge/floating-windows/terminals/spawnTerminalWithCommandFromUI";
import {addTerminal} from "@/shell/edge/UI-edge/state/TerminalStore";

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
        console.log('[uiAPI] Terminal launched:', terminalId);
    } else {
        console.error('[uiAPI] Failed to create floating terminal');
    }
}