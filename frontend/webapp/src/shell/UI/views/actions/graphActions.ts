/**
 * Pure functional graph actions for hotkeys
 *
 * These are higher-order functions that close over dependencies (cy, floatingWindowManager)
 * and return action handlers that can be registered with HotkeyManager.
 */

import type {Core} from 'cytoscape';
import type {FloatingWindowManager} from '@/shell/UI/views/FloatingWindowManager';

/**
 * Get currently selected graph nodes (excluding floating windows)
 */
const getSelectedGraphNodes = (cy: Core): string[] => {
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
export const createNewNodeAction = (
  cy: Core,
  floatingWindowManager: FloatingWindowManager
) => (): void => {
  const selectedNodes = getSelectedGraphNodes(cy);

  if (selectedNodes.length > 0) {
    // Create child node from first selected node
    const parentNodeId = selectedNodes[0];
    void (async () => {
      const {createNewChildNodeFromUI} = await import('@/shell/edge/UI-edge/graph/handleUIActions.ts');
      const childId = await createNewChildNodeFromUI(parentNodeId, cy);
      await floatingWindowManager.createAnchoredFloatingEditor(childId);
    })();
  } else {
    // Create orphan node at center of viewport
    void (async () => {
      const {createNewEmptyOrphanNodeFromUI} = await import('@/shell/edge/UI-edge/graph/handleUIActions.ts');
      const pan = cy.pan();
      const zoom = cy.zoom();
      const centerX = (cy.width() / 2 - pan.x) / zoom;
      const centerY = (cy.height() / 2 - pan.y) / zoom;
      const nodeId = await createNewEmptyOrphanNodeFromUI({x: centerX, y: centerY}, cy);
      await floatingWindowManager.createAnchoredFloatingEditor(nodeId);
    })();
  }
};

/**
 * Run terminal/coding agent action handler
 * Spawns terminal for the selected node
 */
export const runTerminalAction = (
  cy: Core,
  floatingWindowManager: FloatingWindowManager
) => (): void => {
  const selectedNodes = getSelectedGraphNodes(cy);

  if (selectedNodes.length === 0) {
    console.log('[graphActions] No node selected for terminal');
    return;
  }

  const nodeId = selectedNodes[0];

  void (async () => {
    const {spawnTerminalForNode} = await import('@/shell/edge/UI-edge/graph/spawnTerminalWithCommandFromUI.ts');
    await spawnTerminalForNode(
      nodeId,
      cy,
      (nodeId, metadata, pos) => floatingWindowManager.createFloatingTerminal(nodeId, metadata, pos)
    );
  })();
};
