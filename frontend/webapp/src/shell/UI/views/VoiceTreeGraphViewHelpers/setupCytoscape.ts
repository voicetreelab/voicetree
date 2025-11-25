/**
 * Setup cytoscape layout, event handlers, context menu, and test helpers
 */
import type {Core, NodeSingular} from 'cytoscape';
import type {Graph, NodeIdAndFilePath} from '@/pure/graph';
import type {FloatingEditorManager} from '@/shell/UI/floating-windows/editors/FloatingEditorManager.ts';
import {ContextMenuService} from '@/shell/UI/cytoscape-graph-ui/services/ContextMenuService.ts';
import {enableAutoLayout} from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/autoLayout.ts';

export interface SetupCytoscapeParams {
    cy: Core;
    savePositionsTimeout: { current: NodeJS.Timeout | null };
    onLayoutComplete: () => void;
    onNodeSelected: (nodeId: string) => void;
    getCurrentGraphState: () => Graph;
    floatingWindowManager: FloatingEditorManager;
}

/**
 * Setup cytoscape with layout, interactions, context menu, and test helpers.
 * Returns the initialized ContextMenuService.
 */
export function setupCytoscape(params: SetupCytoscapeParams): ContextMenuService {
    const {
        cy,
        onLayoutComplete,
        onNodeSelected,
        floatingWindowManager
    } = params;

    // Enable auto-layout
    enableAutoLayout(cy);
    console.log('[VoiceTreeGraphView] Auto-layout enabled with Cola');

    // Listen to layout completion
    cy.on('layoutstop', () => {
        console.log('[VoiceTreeGraphView] Layout stopped, saving positions...');
        // saveNodePositions();
        onLayoutComplete();
    });

    // Setup tap handler for nodes
    console.log('[VoiceTreeGraphView] Registering tap handler for floating windows');
    cy.on('tap', 'node', (event) => {
        const node: NodeSingular = event.target;

        // Emit node selected event
        onNodeSelected(node.id());

        console.log('[VoiceTreeGraphView] Calling createAnchoredFloatingEditor');
        void floatingWindowManager.createAnchoredFloatingEditor(node.id()).then(() => console.log('[VoiceTreeGraphView] Created editor'));
    });

    // Setup context menu (with defensive DOM checks)
    const contextMenuService = new ContextMenuService();
    // Initialize context menu with cy instance and dependencies
    contextMenuService.initialize(cy, {
        createAnchoredFloatingEditor: (nodeId : NodeIdAndFilePath) =>
            floatingWindowManager.createAnchoredFloatingEditor(nodeId),
        handleAddNodeAtPosition: (position) =>
            floatingWindowManager.handleAddNodeAtPosition(position)
    });

    return contextMenuService;
}
