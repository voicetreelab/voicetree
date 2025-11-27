/**
 * Setup cytoscape layout, event handlers, context menu, and test helpers
 */
import type {Core, NodeSingular} from 'cytoscape';
import type {Graph, NodeIdAndFilePath} from '@/pure/graph';
import {HorizontalMenuService} from '@/shell/UI/cytoscape-graph-ui/services/HorizontalMenuService';
import {VerticalMenuService} from '@/shell/UI/cytoscape-graph-ui/services/VerticalMenuService';
import {enableAutoLayout} from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/autoLayout';
import {
    createAnchoredFloatingEditor,
    handleAddNodeAtPosition,
} from '@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorManager-v2';

export interface SetupCytoscapeParams {
    cy: Core;
    savePositionsTimeout: { current: NodeJS.Timeout | null };
    onLayoutComplete: () => void;
    onNodeSelected: (nodeId: string) => void;
    getCurrentGraphState: () => Graph;
}

/**
 * Setup cytoscape with layout, interactions, context menus, and test helpers.
 * Returns the initialized menu services for lifecycle management.
 */
export function setupCytoscape(params: SetupCytoscapeParams): {
    horizontalMenuService: HorizontalMenuService;
    verticalMenuService: VerticalMenuService;
} {
    const {
        cy,
        onLayoutComplete,
        onNodeSelected,
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
        void createAnchoredFloatingEditor(cy, node.id()).then(() => console.log('[VoiceTreeGraphView] Created editor'));
    });

    // Setup horizontal menu (node hover)
    const horizontalMenuService: HorizontalMenuService = new HorizontalMenuService();
    horizontalMenuService.initialize(cy, {
        createAnchoredFloatingEditor: (nodeId: NodeIdAndFilePath) =>
            createAnchoredFloatingEditor(cy, nodeId),
    });

    // Setup vertical menu (right-click on canvas)
    const verticalMenuService: VerticalMenuService = new VerticalMenuService();
    verticalMenuService.initialize(cy, {
        handleAddNodeAtPosition: (position) =>
            handleAddNodeAtPosition(cy, position)
    });

    return { horizontalMenuService, verticalMenuService };
}
