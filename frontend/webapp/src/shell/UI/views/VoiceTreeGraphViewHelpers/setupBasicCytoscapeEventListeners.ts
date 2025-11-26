/**
 * Setup basic cytoscape event listeners for hover, focus, box selection, etc.
 * These handle visual feedback and basic interactions.
 */
import type { Core } from 'cytoscape';
import type { BreathingAnimationService } from '@/shell/UI/cytoscape-graph-ui/services/BreathingAnimationService';
import type { StyleService } from '@/shell/UI/cytoscape-graph-ui/services/StyleService';
import { CLASS_HOVER, CLASS_UNHOVER, CLASS_CONNECTED_HOVER } from '@/shell/UI/cytoscape-graph-ui/constants';

export function setupBasicCytoscapeEventListeners(
  cy: Core,
  animationService: BreathingAnimationService,
  styleService: StyleService,
  container: HTMLElement
): void {
  // Basic hover effects
  cy.on('mouseover', 'node', (e) => {
    if (!e.target) return;

    const node = e.target;
    cy.elements()
      .difference(node.closedNeighborhood())
      .addClass(CLASS_UNHOVER);

    node.addClass(CLASS_HOVER)
      .connectedEdges()
      .addClass(CLASS_CONNECTED_HOVER)
      .connectedNodes()
      .addClass(CLASS_CONNECTED_HOVER);

    // Stop breathing animation on hover for new nodes and appended content
    if (animationService.isAnimationActive(node)) {
      const animationType = node.data('animationType');
      if (animationType === 'new_node' || animationType === 'appended_content') {
        animationService.stopAnimationForNode(node);
      }
    }
  });

  cy.on('mouseout', (e) => {
    if (!e.target || e.target === cy) return;

    cy.elements().removeClass([
      CLASS_HOVER,
      CLASS_UNHOVER,
      CLASS_CONNECTED_HOVER
    ]);
  });

  // Focus handling
  cy.on('tap boxselect', () => {
    container.focus();
  });

  // Box selection end event - log selected nodes
  cy.on('boxend', () => {
    const selected: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/node_modules/cytoscape/index").CollectionReturnValue = cy.$('node:selected');
    console.log(`[VoiceTreeGraphView] Box selection: ${selected.length} nodes selected`, selected.map(n => n.id()));
  });

  // Update node sizes when edges are added or removed
  // Only update the source and target nodes of the affected edge for efficiency
  cy.on('add', 'edge', (e) => {
    if (!e.target) return;
    const edge = e.target;
    const affectedNodes = edge.source().union(edge.target());
    styleService.updateNodeSizes(cy, affectedNodes);
  });

  cy.on('remove', 'edge', (e) => {
    if (!e.target) return;
    const edge = e.target;
    const affectedNodes = edge.source().union(edge.target());
    styleService.updateNodeSizes(cy, affectedNodes);
  });
}
