/**
 * Setup cytoscape layout, event handlers, context menu, and test helpers
 */
import type {Core, NodeSingular} from 'cytoscape';
import type {Graph} from '@/pure/graph';
import {isImageNode} from '@/pure/graph';
import {HorizontalMenuService} from '@/shell/UI/cytoscape-graph-ui/services/HorizontalMenuService';
import { activeCardShells } from '@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD';
import {VerticalMenuService} from '@/shell/UI/cytoscape-graph-ui/services/VerticalMenuService';
import {enableAutoLayout} from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/autoLayout';
import {enableSpatialIndex} from '@/shell/UI/cytoscape-graph-ui/services/spatialIndexSync';
import {
    createAnchoredFloatingEditor,

} from '@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD';
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
    horizontalMenuService: HorizontalMenuService;
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

        // Emit node selected event
        onNodeSelected(nodeId);

        // Don't open floating editor for image nodes
        if (isImageNode(nodeId)) {
            return;
        }

        // Card shells handle their own click events (dblclick → pin)
        if (activeCardShells.has(nodeId)) {
            return;
        }

        //console.log('[VoiceTreeGraphView] Calling createAnchoredFloatingEditor');
        void createAnchoredFloatingEditor(cy, nodeId, true);
        //console.log('[VoiceTreeGraphView] Created editor');
    });

    // Setup horizontal menu (node hover)
    const horizontalMenuService: HorizontalMenuService = new HorizontalMenuService();
    horizontalMenuService.initialize(cy);

    // Setup vertical menu (right-click on canvas)
    const verticalMenuService: VerticalMenuService = new VerticalMenuService();
    verticalMenuService.initialize(cy, {
        handleAddNodeAtPosition: (position) =>
            handleAddNodeAtPosition(position)
    });

    return { horizontalMenuService, verticalMenuService };
}
