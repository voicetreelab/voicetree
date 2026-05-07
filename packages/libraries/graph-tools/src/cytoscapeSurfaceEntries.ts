export type LocationLookup = {
    readonly relativePath: string
    readonly contains: string
    readonly occurrence?: number
}

export type SurfaceEntryDefinition = {
    readonly surface: string
    readonly label: string
    readonly primary: LocationLookup
    readonly owner: string
    readonly consumers: readonly {
        readonly description: string
        readonly ref: LocationLookup
    }[]
    readonly mutatesGraphModel: string
    readonly survivesRestart: string
    readonly notes: string
}

export const SURFACE_ENTRY_DEFINITIONS: readonly SurfaceEntryDefinition[] = [
    {
        surface: 'collapseSet',
        label: 'graphCollapsedFolders renderer store',
        primary: {
            relativePath: 'webapp/src/shell/edge/UI-edge/state/FolderTreeStore.ts',
            contains: 'readonly graphCollapsedFolders: ReadonlySet<string>;',
        },
        owner: 'Renderer FolderTreeStore state',
        consumers: [
            {
                description: 'folder collapse toggle mutates the set',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/graph/folderCollapse.ts',
                    contains: 'addCollapsedFolder(folderId)',
                },
            },
            {
                description: 'delta projection snapshots collapsed folders during folder materialization',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/graph/applyGraphDeltaToUI.ts',
                    contains: '...getFolderTreeState().graphCollapsedFolders,',
                },
            },
            {
                description: 'folder tree sidebar renders the graph-collapse affordance from the set',
                ref: {
                    relativePath: 'webapp/src/shell/UI/views/folderTree/FolderTreeNode.tsx',
                    contains: 'const isGraphCollapsed: boolean = graphFolderId !== null && graphCollapsedFolders.has(graphFolderId);',
                },
            },
        ],
        mutatesGraphModel: 'No',
        survivesRestart: 'No',
        notes: 'Only sidebar open/width persist in localStorage; graphCollapsedFolders resets on restart.',
    },
    {
        surface: 'selection',
        label: 'Cytoscape-owned node selection',
        primary: {
            relativePath: 'webapp/src/shell/UI/views/VoiceTreeGraphViewHelpers/setupBasicCytoscapeEventListeners.ts',
            contains: "const selectedNodes: CollectionReturnValue = cy.$('node:selected');",
        },
        owner: 'Cytoscape internal selection state',
        consumers: [
            {
                description: 'mouseover handler reads node:selected for multi-select guard',
                ref: {
                    relativePath: 'webapp/src/shell/UI/views/VoiceTreeGraphViewHelpers/setupBasicCytoscapeEventListeners.ts',
                    contains: "const multipleNodesSelected: boolean = selectedNodes.length > 1;",
                },
            },
        ],
        mutatesGraphModel: 'No',
        survivesRestart: 'No',
        notes: 'Selection state migrated to selectionStore (BF-165). cy select/unselect events feed the store; programmatic selections dispatch through the store.',
    },
    {
        surface: 'hover',
        label: 'Cytoscape hover classes + hover-editor-open flags',
        primary: {
            relativePath: 'webapp/src/shell/UI/views/VoiceTreeGraphViewHelpers/setupBasicCytoscapeEventListeners.ts',
            contains: "cy.on('mouseover', 'node', (e) => {",
        },
        owner: 'Cytoscape node classes plus hover editor/image viewer UI state',
        consumers: [
            {
                description: 'hover editor toggles the hover-editor-open class on graph nodes',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/floating-windows/editors/HoverEditor.ts',
                    contains: "cy.getElementById(nodeId).addClass('hover-editor-open');",
                },
            },
            {
                description: 'node stylesheet reacts to the hover class',
                ref: {
                    relativePath: 'webapp/src/shell/UI/cytoscape-graph-ui/services/defaultNodeStyles.ts',
                    contains: "selector: 'node.hover',",
                },
            },
            {
                description: 'frontmatter rules blank labels while hover editors are open',
                ref: {
                    relativePath: 'webapp/src/shell/UI/cytoscape-graph-ui/services/frontmatterStyles.ts',
                    contains: "selector: 'node.hover-editor-open[label]',",
                },
            },
        ],
        mutatesGraphModel: 'No',
        survivesRestart: 'No',
        notes: 'Hover is purely renderer-local; both the hover class and hover-editor-open class are transient UI state.',
    },
    {
        surface: 'compound-parent',
        label: 'Folder/file parentage stored as Cytoscape compound data',
        primary: {
            relativePath: 'webapp/src/shell/edge/UI-edge/graph/applyGraphDeltaToUI.ts',
            contains: 'parent: folderPath ?? undefined',
        },
        owner: 'Cytoscape compound parent data on folder and child nodes',
        consumers: [
            {
                description: 'folder expand reconstructs subfolder compounds and child parent pointers',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/graph/folderCollapse.ts',
                    contains: 'parent: folderId,',
                },
            },
            {
                description: 'node styling treats folder parents as compounds',
                ref: {
                    relativePath: 'webapp/src/shell/UI/cytoscape-graph-ui/services/defaultNodeStyles.ts',
                    contains: "selector: 'node[?isFolderNode]',",
                },
            },
            {
                description: 'layout participation logic branches on collapsed folder compounds',
                ref: {
                    relativePath: 'webapp/src/shell/UI/cytoscape-graph-ui/layoutParticipation.ts',
                    contains: "return !node.data('isFolderNode') || Boolean(node.data('collapsed'));",
                },
            },
        ],
        mutatesGraphModel: 'No',
        survivesRestart: 'Yes (derived)',
        notes: 'The compound parent relation is re-derived from file/folder paths during projection instead of being stored separately.',
    },
    {
        surface: 'layout',
        label: 'Node positions persisted back into graph-model metadata',
        primary: {
            relativePath: 'webapp/src/shell/edge/main/saveNodePositions.ts',
            contains: 'position: O.some(pos)',
        },
        owner: 'Main-process graph store GraphNode.nodeUIMetadata.position',
        consumers: [
            {
                description: 'drag release saves current Cytoscape positions',
                ref: {
                    relativePath: 'webapp/src/shell/UI/views/VoiceTreeGraphViewHelpers/setupBasicCytoscapeEventListeners.ts',
                    contains: 'void window.electronAPI?.main.saveNodePositions(cy.nodes().jsons() as NodeDefinition[]);',
                },
            },
            {
                description: 'auto-layout writes back the post-layout positions',
                ref: {
                    relativePath: 'webapp/src/shell/UI/cytoscape-graph-ui/graphviz/layout/autoLayout.ts',
                    contains: 'void window.electronAPI?.main.saveNodePositions(cy.nodes().jsons() as NodeDefinition[]);',
                },
            },
            {
                description: 'delta projection hydrates node positions from metadata when nodes are created',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/graph/applyGraphDeltaToUI.ts',
                    contains: 'position: {',
                    occurrence: 1,
                },
            },
        ],
        mutatesGraphModel: 'Yes',
        survivesRestart: 'Partial',
        notes: 'Positions flow back into graph-model state immediately, but the file comment notes disk durability is deferred until a later save path writes the node.',
    },
    {
        surface: 'layout',
        label: 'Viewport + pending-pan renderer state',
        primary: {
            relativePath: 'webapp/src/shell/edge/UI-edge/state/PendingPanStore.ts',
            contains: 'let pendingPan: PendingPanState | null = null;',
        },
        owner: 'Renderer module-level pending-pan state plus per-window viewport snapshots',
        consumers: [
            {
                description: 'auto-layout consumes pending pan after layout completion',
                ref: {
                    relativePath: 'webapp/src/shell/UI/cytoscape-graph-ui/graphviz/layout/autoLayout.ts',
                    contains: 'panToTrackedNode(cy);',
                },
            },
            {
                description: 'floating-window fullscreen stores and restores zoom/pan',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/floating-windows/fullscreen-zoom.ts',
                    contains: 'windowViewportStates.set(shadowNodeId, { zoom: cy.zoom(), pan: { ...cy.pan() } });',
                },
            },
            {
                description: 'gesture navigation mutates the live viewport through panBy/zoom',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/graph/navigation/NavigationGestureService.ts',
                    contains: 'this.cy.panBy({ x: -e.deltaX, y: -e.deltaY });',
                    occurrence: 1,
                },
            },
        ],
        mutatesGraphModel: 'No',
        survivesRestart: 'No',
        notes: 'Viewport zoom/pan and pending pan intents are ephemeral renderer concerns today.',
    },
    {
        surface: 'loaded-roots',
        label: 'Persisted writePath/readPaths vault config',
        primary: {
            relativePath: 'packages/graph-model/src/watch-folder/vault-allowlist.ts',
            contains: 'export async function getVaultPaths(): Promise<readonly FilePath[]> {',
        },
        owner: '@vt/graph-model watch-folder config file',
        consumers: [
            {
                description: 'broadcast pushes the persisted vault state into the renderer mirror',
                ref: {
                    relativePath: 'packages/graph-model/src/watch-folder/broadcast-vault-state.ts',
                    contains: 'getCallbacks().syncVaultState?.({ readPaths, writePath, starredFolders });',
                },
            },
            {
                description: 'delta projection maps node ids back to currently loaded roots',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/graph/applyGraphDeltaToUI.ts',
                    contains: 'const { writePath, readPaths } = getVaultState()',
                },
            },
            {
                description: 'vault-path subscription forces a full layout reset when loaded roots change',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/graph/setupViewSubscriptions.ts',
                    contains: 'const vaultPathSubscription: () => void = subscribeToVaultPaths((state: VaultPathState) => {',
                },
            },
        ],
        mutatesGraphModel: 'Yes',
        survivesRestart: 'Yes',
        notes: 'writePath/readPaths are persisted in vault config and drive graph load/unload plus renderer topology changes.',
    },
    {
        surface: 'F6 aggregation call sites',
        label: 'Synthetic edge aggregation for collapsed folders',
        primary: {
            relativePath: 'webapp/src/shell/edge/UI-edge/graph/folderCollapse.ts',
            contains: 'const specs: readonly SyntheticEdgeSpec[] = computeSyntheticEdgeSpecs(folderId, descendantIds, connectedEdges)',
        },
        owner: 'Collapsed-folder projection logic plus synthetic-edge registry',
        consumers: [
            {
                description: 'delta projection patches aggregated edges when hidden descendants receive updates',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/graph/applyGraphDeltaToUI.ts',
                    contains: "addOrUpdateSyntheticEdge(cy, collapsedFolder, 'outgoing', edge.targetId, {",
                },
            },
            {
                description: 'layout excludes synthetic edges from participant sets',
                ref: {
                    relativePath: 'webapp/src/shell/UI/cytoscape-graph-ui/layoutParticipation.ts',
                    contains: "if (edge.data('isIndicatorEdge') || edge.data('isSyntheticEdge')) return false;",
                },
            },
            {
                description: 'folder expand replays synthetic edges for still-collapsed descendants',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/graph/folderCollapse.ts',
                    contains: 'addOrUpdateSyntheticEdge(cy, se.folderId, se.direction, se.externalId, se.original)',
                },
            },
        ],
        mutatesGraphModel: 'No',
        survivesRestart: 'No',
        notes: 'Synthetic edges are projection-only today; they are regenerated from live collapse state instead of persisted as graph-model data.',
    },
    {
        surface: 'direct cy.$ reads',
        label: 'Selector-based reads against live Cytoscape state',
        primary: {
            relativePath: 'webapp/src/shell/UI/views/closeSelectedWindow.ts',
            contains: "const selected: cytoscape.CollectionReturnValue = cy.$(':selected');",
        },
        owner: 'Cytoscape selector engine and internal element sets',
        consumers: [
            {
                description: 'active-terminal highlight clears and reapplies CSS classes via cy selectors',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/graph/setupViewSubscriptions.ts',
                    contains: "cy.$('.' + TERMINAL_ACTIVE_CLASS).removeClass(TERMINAL_ACTIVE_CLASS);",
                },
            },
            {
                description: 'context highlighting uses cy.$id for contained node fanout',
                ref: {
                    relativePath: 'webapp/src/shell/UI/cytoscape-graph-ui/highlightContextNodes.ts',
                    contains: 'cy.$id(id).addClass(CONTEXT_CONTAINED_CLASS);',
                    occurrence: 1,
                },
            },
        ],
        mutatesGraphModel: 'No',
        survivesRestart: 'No',
        notes: 'The selector reads are scattered across edge/UI modules and couple business logic to Cytoscape internals.',
    },
    {
        surface: 'shadow-node anchoring',
        label: 'Floating-window shadow nodes and viewport restore state',
        primary: {
            relativePath: 'webapp/src/shell/edge/UI-edge/floating-windows/anchor-to-node.ts',
            contains: 'const shadowNode: cytoscape.CollectionReturnValue = cy.add({',
        },
        owner: 'Cytoscape shadow nodes plus floating-window DOM datasets',
        consumers: [
            {
                description: 'terminal creation anchors windows by minting shadow nodes in the graph',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/floating-windows/terminals/createFloatingTerminal.ts',
                    contains: 'anchorToNode(cy, terminalWithUI, getCurrentIndex(cy));',
                },
            },
            {
                description: 'fullscreen zoom stores per-shadow-node viewport state',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/floating-windows/fullscreen-zoom.ts',
                    contains: 'windowViewportStates.set(shadowNodeId, { zoom: cy.zoom(), pan: { ...cy.pan() } });',
                },
            },
            {
                description: 'drag handlers write shadow-node positions back into Cytoscape',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/floating-windows/anchor-to-node.ts',
                    contains: 'shadowNode.position({ x: graphX, y: graphY });',
                },
            },
        ],
        mutatesGraphModel: 'No',
        survivesRestart: 'No',
        notes: 'This is an additional coupling surface beyond the kanban list: floating windows currently materialize extra Cytoscape nodes and edges that only exist for UI anchoring.',
    },
] as const
