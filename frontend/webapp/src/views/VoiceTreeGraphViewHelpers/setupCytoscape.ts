/**
 * Setup cytoscape layout, event handlers, context menu, and test helpers
 */
import type {Core, NodeSingular} from 'cytoscape';
import type {Graph} from '@/functional_graph/pure/types';
import type {IMarkdownVaultProvider} from '@/providers/IMarkdownVaultProvider';
import type {FloatingWindowManager} from '@/views/FloatingWindowManager';
import {ContextMenuService} from '@/graph-core/services/ContextMenuService';
import {enableAutoLayout} from '@/graph-core/graphviz/layout/autoLayout';

export interface SetupCytoscapeParams {
    cy: Core;
    savePositionsTimeout: { current: NodeJS.Timeout | null };
    saveNodePositions: () => void;
    onLayoutComplete: () => void;
    onNodeSelected: (nodeId: string) => void;
    getCurrentGraphState: () => Graph;
    getVaultProvider: () => IMarkdownVaultProvider;
    floatingWindowManager: FloatingWindowManager;
}

/**
 * Setup cytoscape with layout, interactions, context menu, and test helpers.
 * Returns the initialized ContextMenuService.
 */
export function setupCytoscape(params: SetupCytoscapeParams): ContextMenuService {
    const {
        cy,
        savePositionsTimeout,
        saveNodePositions,
        onLayoutComplete,
        onNodeSelected,
        getVaultProvider,
        floatingWindowManager
    } = params;

    // Enable auto-layout
    // enableAutoLayout(cy);
    console.log('[VoiceTreeGraphView] Auto-layout enabled with Cola');

    // Listen to layout completion
    cy.on('layoutstop', () => {
        console.log('[VoiceTreeGraphView] Layout stopped, saving positions...');
        saveNodePositions();
        onLayoutComplete();
    });

    // Save positions when user finishes dragging nodes
    cy.on('free', 'node', () => {
        console.log('[VoiceTreeGraphView] GraphNode drag ended, saving positions...');
        // Debounce to avoid too many saves
        if (savePositionsTimeout.current) {
            clearTimeout(savePositionsTimeout.current);
        }
        savePositionsTimeout.current = setTimeout(() => {
            saveNodePositions();
        }, 1000); // Wait 1 second after last drag
    });

    // Setup tap handler for nodes
    console.log('[VoiceTreeGraphView] Registering tap handler for floating windows');
    cy.on('tap', 'node', (event) => {
        const node: NodeSingular = event.target;

        // Emit node selected event
        onNodeSelected(node.id());

        console.log('[VoiceTreeGraphView] Calling createFloatingEditor');
        floatingWindowManager.createFloatingEditor(node).then(() => console.log('[VoiceTreeGraphView] Created editor'));
    });

    // Setup context menu (with defensive DOM checks)
    const contextMenuService = new ContextMenuService();
    // Initialize context menu with cy instance and dependencies
    contextMenuService.initialize(cy, {
        getContentForNode: (nodeId: string) => floatingWindowManager.getContentForNode(nodeId),
        getFilePathForNode: (nodeId: string) => floatingWindowManager.getFilePathForNode(nodeId),
        createFloatingEditor: (node : NodeSingular) =>
            floatingWindowManager.createFloatingEditor(node),
        createFloatingTerminal: (nodeId: string, metadata: unknown, pos) =>
            floatingWindowManager.createFloatingTerminal(nodeId, metadata as {
                id: string;
                name: string;
                filePath?: string
            }, pos),
        handleAddNodeAtPosition: (position) =>
            floatingWindowManager.handleAddNodeAtPosition(position)
    });

    // Expose for testing
    if (typeof window !== 'undefined') {
        (window as unknown as { cytoscapeInstance: Core }).cytoscapeInstance = cy;
        (window as unknown as { cytoscapeCore: Core }).cytoscapeCore = cy;

        // Expose test markdown_parsing for e2e tests
        (window as unknown as { testHelpers: unknown }).testHelpers = {
            createTerminal: (nodeId: string) => {
                const vaultProvider = getVaultProvider();
                const vaultPath = vaultProvider.getWatchDirectory?.();
                const filePath = vaultPath ? `${vaultPath}/${nodeId}.md` : undefined;
                const nodeMetadata = {
                    id: nodeId,
                    name: nodeId.replace(/_/g, ' '),
                    filePath: filePath
                };

                const node = cy.getElementById(nodeId);
                if (node.length > 0) {
                    const nodePos = node.position();
                    floatingWindowManager.createFloatingTerminal(nodeId, nodeMetadata, nodePos);
                }
            },
            addNodeAtPosition: async (position: { x: number; y: number }) => {
                // For testing: directly invoke the context menu handler
                const contextMenu = (cy as unknown as {
                    contextMenus: {
                        _config?: { onAddNodeAtPosition?: (pos: { x: number; y: number }) => Promise<void> }
                    }
                }).contextMenus;
                if (contextMenu?._config?.onAddNodeAtPosition) {
                    await contextMenu._config.onAddNodeAtPosition(position);
                } else {
                    console.error('[TestHelpers] onAddNodeAtPosition handler not found');
                }
            },
            getEditorInstance: undefined // Will be set below
        };

        // Import and expose getVanillaInstance for testing
        import('@/graph-core/extensions/cytoscape-floating-windows').then(({getVanillaInstance}) => {
            const testHelpers = (window as unknown as { testHelpers?: { getEditorInstance?: unknown } }).testHelpers;
            if (testHelpers) {
                testHelpers.getEditorInstance = (windowId: string) => {
                    return getVanillaInstance(windowId);
                };
            }
        });
    }

    return contextMenuService;
}
