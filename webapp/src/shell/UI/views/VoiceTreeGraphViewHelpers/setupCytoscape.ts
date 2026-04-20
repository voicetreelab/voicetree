/**
 * Setup cytoscape layout, event handlers, context menu, and test helpers
 */
import type {Core, NodeSingular} from 'cytoscape';
import type {Graph} from '@vt/graph-model/pure/graph';
import {VerticalMenuService} from '@/shell/UI/cytoscape-graph-ui/services/VerticalMenuService';
import {enableAutoLayout} from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/autoLayout';
import {enableSpatialIndex} from '@/shell/UI/cytoscape-graph-ui/services/spatialIndexSync';
import {applyNodeSelectionSideEffects} from '@/shell/edge/UI-edge/graph/applyNodeSelectionSideEffects';
import {handleAddNodeAtPosition} from "@/shell/edge/UI-edge/floating-windows/editors/OpenHoverEditor";

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
    verticalMenuService: VerticalMenuService;
} {
    const {
        cy,
        onNodeSelected,
    } = params;

    // Enable spatial index (must be before auto-layout so index exists before layout triggers)
    enableSpatialIndex(cy);
    // Enable auto-layout
    enableAutoLayout(cy);
    //console.log('[VoiceTreeGraphView] Auto-layout enabled with Cola');

    // Listen to layout completion
    // cy.on('layoutstop', () => { # todo, this doesn't fire.
    //     //console.log('[VoiceTreeGraphView] Layout stopped, saving positions...');
    //     // Note: @types/cytoscape incorrectly types jsons() as string[] - it actually returns NodeDefinition[]
    //     onLayoutComplete();
    // });

    // Setup tap handler for nodes
    //console.log('[VoiceTreeGraphView] Registering tap handler for floating windows');
    cy.on('tap', 'node', (event) => {
        const node: NodeSingular = event.target;
        const nodeId: string = node.id();

        void applyNodeSelectionSideEffects({
            cy,
            nodeId,
            onNodeSelected,
        });
    });

    // Setup vertical menu (right-click on canvas)
    const verticalMenuService: VerticalMenuService = new VerticalMenuService();
    verticalMenuService.initialize(cy, {
        handleAddNodeAtPosition: (position) =>
            handleAddNodeAtPosition(position)
    });

    return { verticalMenuService };
}
