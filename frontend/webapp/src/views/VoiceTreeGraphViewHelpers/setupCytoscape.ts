/**
 * Setup cytoscape layout, event handlers, context menu, and test helpers
 */
import type {Core, NodeSingular} from 'cytoscape';
import type {Graph} from '@/functional_graph/pure/types';
import type {FloatingWindowManager} from '@/views/FloatingWindowManager';
import {ContextMenuService} from '@/graph-core/services/ContextMenuService';
import {enableAutoLayout} from '@/graph-core/graphviz/layout/autoLayout';

export interface SetupCytoscapeParams {
    cy: Core;
    savePositionsTimeout: { current: NodeJS.Timeout | null };
    onLayoutComplete: () => void;
    onNodeSelected: (nodeId: string) => void;
    getCurrentGraphState: () => Graph;
    floatingWindowManager: FloatingWindowManager;
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

    // // Save positions when user finishes dragging nodes DISABLED
    // cy.on('free', 'node', () => {
    //     console.log('[VoiceTreeGraphView] GraphNode drag ended, saving positions...');
    //     // Debounce to avoid too many saves
    //     // if (savePositionsTimeout.current) {
    //     //     clearTimeout(savePositionsTimeout.current);
    //     // }
    //     // savePositionsTimeout.current = setTimeout(() => {
    //     //     saveNodePositions();
    //     // }, 1000); // Wait 1 second after last drag
    // });

    // Setup tap handler for nodes
    console.log('[VoiceTreeGraphView] Registering tap handler for floating windows');
    cy.on('tap', 'node', (event) => {
        const node: NodeSingular = event.target;

        // Emit node selected event
        onNodeSelected(node.id());

        console.log('[VoiceTreeGraphView] Calling createAnchoredFloatingEditor');
        floatingWindowManager.createAnchoredFloatingEditor(node).then(() => console.log('[VoiceTreeGraphView] Created editor'));
    });

    // Setup context menu (with defensive DOM checks)
    const contextMenuService = new ContextMenuService();
    // Initialize context menu with cy instance and dependencies
    contextMenuService.initialize(cy, {
        getContentForNode: (nodeId: string) => floatingWindowManager.getContentForNode(nodeId),
        getFilePathForNode: (nodeId: string) => floatingWindowManager.getFilePathForNode(nodeId),
        createFloatingEditor: (node : NodeSingular) =>
            floatingWindowManager.createAnchoredFloatingEditor(node),
        createFloatingTerminal: (nodeId: string, metadata: unknown, pos) =>
            floatingWindowManager.createFloatingTerminal(nodeId, metadata as {
                id: string;
                name: string;
                filePath?: string
            }, pos),
        handleAddNodeAtPosition: (position) =>
            floatingWindowManager.handleAddNodeAtPosition(position)
    });

    return contextMenuService;
}
