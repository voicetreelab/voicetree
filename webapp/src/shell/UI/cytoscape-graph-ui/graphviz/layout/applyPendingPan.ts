/**
 * Seam: applies a PanAction (from PendingPanStore) to a live cytoscape instance.
 * All cy.* calls for pending-pan execution live here, keeping PendingPanStore pure.
 */

import type { Core, CollectionReturnValue } from 'cytoscape';
import type { PanAction } from '@/shell/edge/UI-edge/state/PendingPanStore';
import {
  cyCenterOnVisibleViewport,
  cyFitCollectionByAverageNodeSize,
  cyFitIntoVisibleViewport,
  cySmartCenter,
  getResponsivePadding,
} from '@/utils/responsivePadding';

export function applyPendingPan(cy: Core, action: PanAction): void {
  switch (action.kind) {
    case 'fit-non-folder-elements': {
      // Exclude folder compound nodes — their bbox encompasses all children and causes excessive zoom-out
      const eles = cy.elements().filter(ele => !ele.data('isFolderNode')) as CollectionReturnValue;
      cyFitIntoVisibleViewport(cy, eles, getResponsivePadding(cy, action.paddingPercent));
      break;
    }
    case 'fit-non-folder-nodes': {
      // Exclude folder compound nodes — their bbox inflates the average
      const nodes = cy.nodes().filter(n => !n.data('isFolderNode')) as CollectionReturnValue;
      cyFitCollectionByAverageNodeSize(cy, nodes, action.targetFraction);
      break;
    }
    case 'smart-center-with-neighbors': {
      const target = cy.getElementById(action.nodeId);
      if (target.length > 0) {
        const neighborhood = target.closedNeighborhood().nodes().filter(n => !n.data('isFolderNode')) as CollectionReturnValue;
        cySmartCenter(cy, neighborhood);
      }
      break;
    }
    case 'smart-center': {
      const node = cy.getElementById(action.nodeId);
      if (node.length > 0) cySmartCenter(cy, node);
      break;
    }
    case 'center-in-viewport': {
      // nodeId may be a shadow node (not in graph model) — cy lookup is the authority here
      const node = cy.getElementById(action.nodeId);
      if (node.length > 0) cyCenterOnVisibleViewport(cy, node, action.duration);
      break;
    }
  }
}
