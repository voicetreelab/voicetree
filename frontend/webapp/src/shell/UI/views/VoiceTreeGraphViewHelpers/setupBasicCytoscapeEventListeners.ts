/**
 * Setup basic cytoscape event listeners for hover, focus, box selection, etc.
 * These handle visual feedback and basic interactions.
 */
import type { Core, NodeSingular, EdgeSingular, CollectionReturnValue, NodeCollection, NodeDefinition } from 'cytoscape';
import type { StyleService } from '@/shell/UI/cytoscape-graph-ui/services/StyleService';
import { CLASS_HOVER, CLASS_UNHOVER, CLASS_CONNECTED_HOVER } from '@/shell/UI/cytoscape-graph-ui/constants';
import { addRecentlyVisited } from '@/shell/edge/UI-edge/state/RecentlyVisitedStore';
import { highlightContainedNodes, clearContainedHighlights } from '@/shell/UI/cytoscape-graph-ui/highlightContextNodes';
import { setActiveTerminalId } from '@/shell/edge/UI-edge/state/TerminalStore';
// Import to make Window.electronAPI type available
import type {} from '@/shell/electron';

export function setupBasicCytoscapeEventListeners(
  cy: Core,
  styleService: StyleService,
  container: HTMLElement
): void {
  // Basic hover effects with toggle selection
  cy.on('mouseover', 'node', (e) => {
    if (!e.target) return;

    const node: NodeSingular = e.target;

    // Show grab cursor to indicate nodes are draggable
    container.style.cursor = 'grab';

    // Skip shadow nodes (floating windows) for selection handling
    if (!node.data('isShadowNode')) {
      const selectedNodes: CollectionReturnValue = cy.$('node:selected');
      const multipleNodesSelected: boolean = selectedNodes.length > 1;
      const hoveredNodeIsSelected: boolean = node.selected();

      // Exception: If multiple nodes are selected (via command lasso) and we're hovering
      // over one of those selected nodes, don't change selection
      if (!(multipleNodesSelected && hoveredNodeIsSelected)) {
        // Deselect all other nodes and select the hovered node
        selectedNodes.not(node).unselect();
        node.select();
        // Track as recently visited for command palette ordering
        addRecentlyVisited(node.id());
      }
    }

    cy.elements()
      .difference(node.closedNeighborhood())
      .addClass(CLASS_UNHOVER);

    node.addClass(CLASS_HOVER)
      .connectedEdges()
      .addClass(CLASS_CONNECTED_HOVER)
      .connectedNodes()
      .addClass(CLASS_CONNECTED_HOVER);
  });

  cy.on('mouseout', (e) => {
    if (!e.target || e.target === cy) return;

    cy.elements().removeClass([
      CLASS_HOVER,
      CLASS_UNHOVER,
      CLASS_CONNECTED_HOVER
    ]);

    // Reset cursor when leaving a node
    container.style.cursor = '';
  });

  // Focus handling
  cy.on('tap boxselect', () => {
    container.focus();
  });

  // Box selection end event - log selected nodes
  cy.on('boxend', () => {
    const selected: CollectionReturnValue = cy.$('node:selected');
    console.log(`[VoiceTreeGraphView] Box selection: ${selected.length} nodes selected`, selected.map(n => n.id()));
  });

  // Update node sizes when edges are added or removed
  // Only update the source and target nodes of the affected edge for efficiency
  cy.on('add', 'edge', (e) => {
    if (!e.target) return;
    const edge: EdgeSingular = e.target;
    const affectedNodes: NodeCollection = edge.source().union(edge.target());
    styleService.updateNodeSizes(cy, affectedNodes);
  });

  cy.on('remove', 'edge', (e) => {
    if (!e.target) return;
    const edge: EdgeSingular = e.target;
    const affectedNodes: NodeCollection = edge.source().union(edge.target());
    styleService.updateNodeSizes(cy, affectedNodes);
  });

  // Change cursor to grabbing when starting to drag a node
  cy.on('grab', 'node', () => {
    container.style.cursor = 'grabbing';
  });

  // Save node positions when nodes are released after dragging
  // The 'free' event fires when a grabbed element is released
  cy.on('free', 'node', () => {
    // Restore grab cursor (still hovering over node after release)
    container.style.cursor = 'grab';
    console.log('[VoiceTreeGraphView] Node drag released, saving positions...');
    void window.electronAPI?.main.saveNodePositions(cy.nodes().jsons() as NodeDefinition[]);
  });

  // Context node highlighting - clear previous and apply new highlights on node select
  cy.on('select', 'node', (e) => {
    clearContainedHighlights(cy);
    const node: NodeSingular = e.target;
    if (node.data('isContextNode')) {
      void highlightContainedNodes(cy, node.id());
    }
  });

  // Clear context node highlights when node is unselected.
  // Cytoscape automatically deselects nodes when clicking on empty canvas (default behavior).
  // We hook into that to also deselect the active terminal when no nodes remain selected.
  cy.on('unselect', 'node', () => {
    clearContainedHighlights(cy);
    if (cy.$('node:selected').length === 0) {
      setActiveTerminalId(null);
    }
  });
}
