/**
 * Setup cytoscape layout, event handlers, context menu, and test helpers
 */
import type {Core, NodeSingular} from 'cytoscape';
import type {Graph} from '@vt/graph-model/graph';
import {VerticalMenuService} from '@/shell/UI/cytoscape-graph-ui/services/menus/VerticalMenuService';
import {enableAutoLayout} from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/auto/autoLayout';
import {enableSpatialIndex} from '@/shell/UI/cytoscape-graph-ui/services/layout/spatialIndexSync';
import {applyNodeSelectionSideEffects} from '@/shell/edge/UI-edge/graph/actions/applyNodeSelectionSideEffects';
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

    // Tap a non-folder node → pin an AnchoredEditor for that file.
    // Folders are excluded for the same reason setupCommandHover excludes them
    // (HoverEditor.ts:267) and the harness excludes them (mountHarness.ts:270):
    // the folder body is not a folder-note affordance — the TL eye chip in
    // FolderHandleService is. A bare 'node' selector would fire tap on the
    // expanded compound when the user clicks any empty body space, resolve
    // nodeId.endsWith('/') in AnchoredEditor, and pin the folder note from a
    // background click. The chevron+eye chips are DOM overlay siblings, so
    // their clicks never reach the cy canvas — gating here costs nothing.
    cy.on('tap', 'node[!isFolderNode]', (event) => {
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
        handleAddNodeAtPosition: (position, clickedFolderId) =>
            handleAddNodeAtPosition(position, clickedFolderId)
    });

    return { verticalMenuService };
}
