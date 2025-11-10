/**
 * Setup cytoscape layout, event handlers, context menu, and test helpers
 */
import type {Core, NodeSingular} from 'cytoscape';
import type {Graph, NodeId} from '@/functional_graph/pure/types';
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

    // Setup tap handler for nodes
    console.log('[VoiceTreeGraphView] Registering tap handler for floating windows');
    cy.on('tap', 'node', (event) => {
        const node: NodeSingular = event.target;

        // Emit node selected event
        onNodeSelected(node.id());

        console.log('[VoiceTreeGraphView] Calling createAnchoredFloatingEditor');
        floatingWindowManager.createAnchoredFloatingEditor(node.id()).then(() => console.log('[VoiceTreeGraphView] Created editor'));
    });

    // Setup context menu (with defensive DOM checks)
    const contextMenuService = new ContextMenuService();
    // Initialize context menu with cy instance and dependencies
    contextMenuService.initialize(cy, {
        getFilePathForNode: (nodeId: string) => floatingWindowManager.getFilePathForNode(nodeId),
        createAnchoredFloatingEditor: (nodeId : NodeId) =>
            floatingWindowManager.createAnchoredFloatingEditor(nodeId),
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
