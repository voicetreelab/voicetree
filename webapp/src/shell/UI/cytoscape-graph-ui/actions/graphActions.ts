/**
 * Pure functional graph actions for hotkeys
 *
 * These are higher-order functions that close over dependencies (cy)
 * and return action handlers that can be registered with HotkeyManager.
 */

import type {Core, Position} from 'cytoscape';
import {
    spawnTerminalWithNewContextNode
} from "@/shell/edge/UI-edge/floating-windows/terminals/spawnTerminalWithCommandFromUI";
import {deleteNodesFromUI} from "@/shell/edge/UI-edge/graph/handleUIActions";

/**
 * Get currently selected graph nodes (excluding floating windows)
 */
const getSelectedGraphNodes: (cy: Core) => string[] = (cy: Core): string[] => {
  return cy.$(':selected')
    .nodes()
    .filter((n) => !n.data('isFloatingWindow'))
    .map((n) => n.id());
};

/**
 * Create a new node action handler
 * - If node selected: creates child node
 * - If no selection: creates orphan at viewport center
 */
export const createNewNodeAction: (cy: Core) => () => void = (
  cy: Core,
) => (): void => {
  const selectedNodes: string[] = getSelectedGraphNodes(cy);

  // Editor auto-pinning handled by file watcher in VoiceTreeGraphView
  if (selectedNodes.length > 0) {
    // Create child node from first selected node
    const parentNodeId: string = selectedNodes[0];
    void (async () => {
      const {createNewChildNodeFromUI} = await import('@/shell/edge/UI-edge/graph/handleUIActions');
      const {getCurrentIndex} = await import('@/shell/UI/cytoscape-graph-ui/services/spatialIndexSync');
      await createNewChildNodeFromUI(parentNodeId, cy, getCurrentIndex(cy));
    })();
  } else {
    // Create orphan node at center of viewport
    void (async () => {
      const {createNewEmptyOrphanNodeFromUI} = await import('@/shell/edge/UI-edge/graph/handleUIActions');
      const pan: Position = cy.pan();
      const zoom: number = cy.zoom();
      const centerX: number = (cy.width() / 2 - pan.x) / zoom;
      const centerY: number = (cy.height() / 2 - pan.y) / zoom;
      await createNewEmptyOrphanNodeFromUI({x: centerX, y: centerY}, cy);
    })();
  }
};

/**
 * Run terminal/coding agent action handler
 * Spawns terminal for the selected node
 */
export const runTerminalAction: (cy: Core) => () => void = (
  cy: Core,
) => (): void => {
  const selectedNodes: string[] = getSelectedGraphNodes(cy);

  if (selectedNodes.length === 0) {
    //console.log('[graphActions] No node selected for terminal');
    return;
  }

  const nodeId: string = selectedNodes[0];

  void (async () => {
    await spawnTerminalWithNewContextNode(
      nodeId,
      cy
    );
  })();
};

/**
 * Delete selected nodes action handler
 * Deletes all selected graph nodes in a single delta (atomic undo)
 */
export const deleteSelectedNodesAction: (cy: Core) => () => void = (
  cy: Core,
) => (): void => {
  const selectedNodes: string[] = getSelectedGraphNodes(cy);

  if (selectedNodes.length === 0) {
    //console.log('[graphActions] No nodes selected for deletion');
    return;
  }

  void deleteNodesFromUI(selectedNodes, cy);
};
