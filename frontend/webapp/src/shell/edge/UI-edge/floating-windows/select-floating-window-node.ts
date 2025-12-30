import type cytoscape from "cytoscape";
import {
    type FloatingWindowData,
    type FloatingWindowFields,
    isEditorData,
    isTerminalData
} from "@/shell/edge/UI-edge/floating-windows/types";
import type {NodeIdAndFilePath} from "@/pure/graph";
import * as O from "fp-ts/Option";
import {addRecentlyVisited} from "@/shell/edge/UI-edge/state/RecentlyVisitedStore";

/**
 * Select the graph node associated with a floating window.
 * Used when:
 * 1. User clicks inside a floating window (mousedown handler)
 * 2. Editor is opened with focus stealing (programmatic focus)
 *
 * Deselects all other nodes, selects the associated node, and tracks in recently visited.
 */
export function selectFloatingWindowNode(
    cy: cytoscape.Core,
    fw: FloatingWindowData | FloatingWindowFields
): void {
    cy.$(':selected').unselect();

    let nodeIdToSelect: NodeIdAndFilePath | undefined;
    if ('type' in fw) {
        const fwData: FloatingWindowData = fw as FloatingWindowData;
        if (isEditorData(fwData)) {
            nodeIdToSelect = fwData.contentLinkedToNodeId;
        } else if (isTerminalData(fwData)) {
            nodeIdToSelect = fwData.attachedToNodeId;
        }
    } else if (O.isSome(fw.anchoredToNodeId)) {
        nodeIdToSelect = fw.anchoredToNodeId.value;
    }

    if (nodeIdToSelect) {
        const node: cytoscape.CollectionReturnValue = cy.getElementById(nodeIdToSelect);
        if (node.length > 0) {
            node.select();
            addRecentlyVisited(nodeIdToSelect);
        }
    }
}