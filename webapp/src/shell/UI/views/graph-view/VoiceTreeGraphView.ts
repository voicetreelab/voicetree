/**
 * VoiceTreeGraphView - Main orchestrator for graph visualization
 *
 * This class is responsible for:
 * 1. Initializing and managing the Cytoscape.js graph instance
 * 2. Rendering and managing UI-edge overlays (stats, loading, empty state)
 * 3. Coordinating managers and handling window resize
 * 4. Managing dark mode and themes
 * 5. Providing public API for graph interaction
 *
 * Heavy lifting is delegated to:
 * - FloatingWindowManager: Editor/terminal windows, context menu, command-hover
 * - GraphNavigationService: User-triggered navigation actions (fit, cycle, search)
 * - HotkeyManager: Keyboard shortcut handling
 * - SearchService: Command palette integration
 *
 * This file lives over the 500-line per-edit hint by design: the prior
 * decomposition extracted five tiny helpers (each with one caller) into
 * a sibling `VoiceTreeGraphView/` folder, which inflated the webapp/shell
 * boundary-width by ten exports. Per FP-rearchitecting, helpers with one
 * caller belong inline. The single public surface is the class itself.
 */

// TODO, WE REALLY WANT TO AVOID ADDING ANYTHING EVER TO THIS FILE
// IF WE ADD IT TO THIS FILE, it's TECH DEBT
// ALL NEW CODE SHOULD BE MOVED INTO FUNCTIONAL pure or edge

import {Disposable} from '@/shell/UI/views/infra/Disposable';
import {EventEmitter} from '@/shell/UI/views/infra/EventEmitter';
import type {
    IVoiceTreeGraphView,
    VoiceTreeGraphViewOptions
} from './IVoiceTreeGraphView';
import cytoscape, {type Core} from 'cytoscape';
// @ts-expect-error - cytoscape-navigator doesn't have proper TypeScript definitions
import navigator from 'cytoscape-navigator';
// @ts-expect-error - cytoscape-layout-utilities doesn't have proper TypeScript definitions
import layoutUtilities from 'cytoscape-layout-utilities';
import 'cytoscape-navigator/cytoscape.js-navigator.css'; // Import navigator CSS
import '@/shell/UI/views/styles/navigator.css'; // Custom navigator styling
import '@/shell/UI/cytoscape-graph-ui/styles/graph.css'; // Custom navigator styling
import '@/shell/UI/cytoscape-graph-ui'; // Import to trigger extension registration

// Register cytoscape extensions
cytoscape.use(navigator);
cytoscape.use(layoutUtilities);
import {BreathingAnimationService} from '@/shell/UI/cytoscape-graph-ui/services/animation/BreathingAnimationService';
import {VerticalMenuService} from '@/shell/UI/cytoscape-graph-ui/services/menus/VerticalMenuService';
import {setupCommandHover} from '@/shell/edge/UI-edge/floating-windows/editors/HoverEditor';
import {setupFolderHandles} from '@/shell/UI/cytoscape-graph-ui/services/folder-handle/FolderHandleService';
import {HotkeyManager} from '@/shell/UI/views/infra/HotkeyManager';
import {SearchService} from './SearchService';
import {getRecentNodeHistory} from '@/shell/edge/UI-edge/state/stores/RecentNodeHistoryStore';
import type {RecentNodeHistory} from '@vt/graph-model/graph';
import {cyFitIntoVisibleViewport, getResponsivePadding} from '@/utils/responsivePadding';
import type {Graph} from '@vt/graph-model/graph';
import {createEmptyGraph} from '@vt/graph-model/graph';
import {
    setupBasicCytoscapeEventListeners,
    initializeCytoscapeInstance,
    setupGraphViewDOM,
    initializeNavigatorMinimap,
    guardCytoscapeResize,
    setupCytoscape as setupCytoscapeHelper,
    type NavigatorMinimapResult,
} from '@/shell/UI/views/VoiceTreeGraphViewHelpers';
import {setupViewSubscriptions, type ViewSubscriptionCleanups} from '@/shell/edge/UI-edge/graph/view/setupViewSubscriptions';
import {subscribeToGraphUpdates as subscribeToGraphUpdatesFn} from '@/shell/edge/UI-edge/graph/view/subscribeToGraphUpdates';
import {applyGraphDeltaToUI} from '@/shell/edge/UI-edge/graph/actions/applyGraphDeltaToUI';
import {StyleService} from '@/shell/UI/cytoscape-graph-ui/services/styles/StyleService';
import {triggerColaLayout} from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/auto/autoLayout';
import {collectFeedback} from '@/shell/edge/UI-edge/graph/popups/userEngagementPrompts';
import {toggleFolderTreeSidebar} from '@/shell/edge/UI-edge/state/stores/FolderTreeStore';
import {createSettingsEditor} from '@/shell/edge/UI-edge/settings/createSettingsEditor';
import {mountLayoutProjection} from '@/shell/edge/UI-edge/graph/layout/layoutProjection';
import {getLayoutStoreSingleton} from '@vt/graph-state/state/layoutStore';
import {updateSpeedDialDarkMode} from '@/shell/UI/views/ui-controls/SpeedDialMenu';
import {createRecentNodeTabsBar} from '@/shell/UI/views/ui-controls/RecentNodeTabsBar';
import {createTerminalTreeSidebar} from '@/shell/UI/views/treeStyleTerminalTabs/TerminalTreeSidebar';
import {createFolderTreeSidebar} from '@/shell/UI/views/folderTree/FolderTreeSidebar';

import {GraphNavigationService} from "@/shell/edge/UI-edge/graph/navigation/GraphNavigationService";
import {NavigationGestureService} from "@/shell/edge/UI-edge/graph/navigation/NavigationGestureService";
import {
    initializeDarkMode,
    toggleDarkMode as toggleDarkModeAction,
    isDarkMode as isDarkModeState
} from '@/shell/edge/UI-edge/state/controllers/DarkModeManager';
import {disposeGraphView} from './disposeGraphView';
import {closeSelectedWindow as closeSelectedWindowFn} from './closeSelectedWindow';
import {setupGraphViewEventListeners} from './setupGraphViewEventListeners';

// ────────────────────────────────────────────────────────────────────────
// Internal helpers (formerly under ./VoiceTreeGraphView/). Each has one
// caller — the class below — so they are module-private functions, not
// exported helpers.
// ────────────────────────────────────────────────────────────────────────

type DarkModeCallbackInputs = {
    updateGraphStyles: () => void;
    searchService: () => SearchService | undefined;
};

type DarkModeCallbacks = {
    updateGraphStyles: () => void;
    updateSpeedDialMenu: (isDark: boolean) => void;
    updateSearchTheme: (isDark: boolean) => void;
};

const createDarkModeCallbacks = ({updateGraphStyles, searchService}: DarkModeCallbackInputs): DarkModeCallbacks => ({
    updateGraphStyles,
    updateSpeedDialMenu: (isDark: boolean) => updateSpeedDialDarkMode(isDark),
    updateSearchTheme: (isDark: boolean) => searchService()?.updateTheme(isDark),
});

type StartupVaultHint = {readonly kind: 'none'} | {readonly kind: 'last' | 'cli'; readonly path: string};

type StartGraphUpdateSubscriptionInput = {
    hasInitialProjectedGraph: boolean;
    isDisposed: () => boolean;
    getStartupVaultHint: (() => Promise<StartupVaultHint>) | undefined;
    openVault: ((path: string) => Promise<unknown>) | undefined;
    subscribeToGraphUpdates: () => void;
};

const startGraphUpdateSubscription = ({
    hasInitialProjectedGraph,
    isDisposed,
    getStartupVaultHint,
    openVault,
    subscribeToGraphUpdates,
}: StartGraphUpdateSubscriptionInput): void => {
    // Initial graph hydration races against daemon startup only on the
    // cold-boot path. When App already supplied an initial projected
    // graph, the vault is already open — calling openVault again would
    // tear down the daemon/SSE subscription path during graph view
    // startup.
    void (async (): Promise<void> => {
        if (!hasInitialProjectedGraph) {
            try {
                const hint = await getStartupVaultHint?.();
                if (hint && hint.kind !== 'none') {
                    await openVault?.(hint.path);
                }
            } catch (err: unknown) {
                console.error('[VoiceTreeGraphView] startup vault open failed:', err);
            }
        }
        if (isDisposed()) return;
        subscribeToGraphUpdates();
    })();
};

type RenderGraphViewInput = {
    container: HTMLElement;
    uiContainer: HTMLElement;
    isDarkMode: boolean;
    showFps: boolean | undefined;
    graphView: unknown;
    getCy: () => Core | undefined;
    onToggleDarkMode: () => void;
};

type RenderGraphViewResult = {
    cy: Core;
    navigator: { destroy: () => void } | null;
    updateNavigatorVisibility: () => void;
    layoutProjectionUnmount: () => void;
};

const renderGraphView = ({
    container,
    uiContainer,
    isDarkMode,
    showFps,
    graphView,
    getCy,
    onToggleDarkMode,
}: RenderGraphViewInput): RenderGraphViewResult => {
    setupGraphViewDOM({
        container,
        uiContainer,
        isDarkMode,
        speedDialCallbacks: {
            onToggleDarkMode,
            onColaLayout: () => {
                const cy: Core | undefined = getCy();
                if (cy) triggerColaLayout(cy);
            },
            onSettings: () => {
                const cy: Core | undefined = getCy();
                if (cy) void createSettingsEditor(cy);
            },
            onAbout: () => window.open('https://voicetree.io', '_blank'),
            onStats: () => window.dispatchEvent(new Event('toggle-stats-panel')),
            onFeedback: () => void collectFeedback(),
            onFolderTree: () => toggleFolderTreeSidebar()
        }
    });

    container.style.opacity = '0.3';
    container.style.transition = 'opacity 0.3s ease-in-out';

    const styleService: StyleService = new StyleService();
    const {cy} = initializeCytoscapeInstance({
        container,
        stylesheet: styleService.getCombinedStylesheet(),
        showFps
    });
    const projection = mountLayoutProjection(cy, getLayoutStoreSingleton());

    guardCytoscapeResize(cy);

    (window as unknown as { cytoscapeInstance: unknown }).cytoscapeInstance = cy;
    (window as unknown as { voiceTreeGraphView: unknown }).voiceTreeGraphView = graphView;

    const navigatorResult: NavigatorMinimapResult = initializeNavigatorMinimap(cy);

    cy.nodes().forEach(node => {
        node.data('degree', node.degree());
    });
    styleService.updateNodeSizes(cy);
    setupBasicCytoscapeEventListeners(cy, styleService, container);

    container.style.opacity = '1';

    return {
        cy,
        navigator: navigatorResult.navigator,
        updateNavigatorVisibility: navigatorResult.updateVisibility,
        layoutProjectionUnmount: projection.unmount,
    };
};

type CreateGraphViewSidebarsInput = {
    uiContainer: HTMLElement;
    cy: Core;
    navigationService: GraphNavigationService;
};

const createGraphViewSidebars = ({uiContainer, cy, navigationService}: CreateGraphViewSidebarsInput): void => {
    createRecentNodeTabsBar(
        uiContainer,
        (nodeId: string) => navigationService.handleSearchSelect(nodeId),
        (nodeId: string) => cy.getElementById(nodeId).data('label') as string | undefined
    );

    const sidebarWrapper: HTMLDivElement = document.createElement('div');
    sidebarWrapper.className = 'sidebar-wrapper';
    uiContainer.appendChild(sidebarWrapper);

    createTerminalTreeSidebar(sidebarWrapper, (terminal) => {
        navigationService.fitToTerminal(terminal);
    });

    createFolderTreeSidebar(sidebarWrapper, {
        onFileSelect: (path) => navigationService.handleSearchSelect(path),
    });
};

const updateGraphStylesForCy = (cy: Core | undefined): void => {
    if (!cy) return;
    const styleService: StyleService = new StyleService();
    const newStyles: { selector: string; style: Record<string, unknown>; }[] = styleService.getCombinedStylesheet();
    cy.style().clear().fromJson(newStyles).update();
};

/**
 * Main VoiceTreeGraphView implementation
 */
export class VoiceTreeGraphView extends Disposable implements IVoiceTreeGraphView {
    // Core instances
    private cy!: Core; // Initialized in render() called from constructor
    private navigator: { destroy: () => void } | null = null; // Navigator minimap instance
    private updateNavigatorVisibility: () => void = () => {}; // Updated by initializeNavigatorMinimap
    private container: HTMLElement;
    private uiContainer: HTMLElement;
    private options: VoiceTreeGraphViewOptions;

    // Services
    private animationService?: BreathingAnimationService; // Disabled for performance - see ama_cpu_profile_root_cause_analysis.md
    private verticalMenuService?: VerticalMenuService; // Initialized in setupCytoscape()

    // Managers
    private hotkeyManager: HotkeyManager;
    private searchService: SearchService;
    private navigationService: GraphNavigationService;
    private gestureService: NavigationGestureService;

    // State
    private currentGraphState: Graph = createEmptyGraph();

    // Graph subscription cleanup
    private cleanupGraphSubscription: (() => void) | null = null;
    private layoutProjectionUnmount: (() => void) | null = null;

    // Settings change listener cleanup
    private cleanupSettingsListener: (() => void) | null = null;

    // View subscriptions cleanup (terminals, navigation, pinned editors)
    private viewSubscriptionCleanups: ViewSubscriptionCleanups | null = null;

    // Event emitters
    private nodeSelectedEmitter = new EventEmitter<string>();
    private nodeDoubleClickEmitter = new EventEmitter<string>();
    private edgeSelectedEmitter = new EventEmitter<{ source: string; target: string }>();
    private layoutCompleteEmitter = new EventEmitter<void>();

    // Bound event handlers for cleanup
    private handleResize!: () => void;

    // Debounce timer for position saving
    private savePositionsTimeout: NodeJS.Timeout | null = null;

    constructor(
        container: HTMLElement,
        uiContainer: HTMLElement,
        options: VoiceTreeGraphViewOptions = {}
    ) {
        super();
        this.container = container;
        this.uiContainer = uiContainer;
        this.options = options;

        // Initialize dark mode via DarkModeManager (handles async settings load)
        void initializeDarkMode(this.options.initialDarkMode, createDarkModeCallbacks({
            updateGraphStyles: () => this.updateGraphStyles(),
            searchService: () => this.searchService
        }));

        // Render DOM structure
        this.render();

        // Initialize managers (after cy is created in render())
        this.hotkeyManager = new HotkeyManager();
        this.navigationService = new GraphNavigationService(this.cy);
        this.gestureService = new NavigationGestureService(this.cy, this.container);
        this.searchService = new SearchService(
            this.cy,
            (nodeId) => this.navigateToNodeAndTrack(nodeId)
        );

        createGraphViewSidebars({
            uiContainer: this.uiContainer,
            cy: this.cy,
            navigationService: this.navigationService,
        });

        // Setup view subscriptions (terminals, navigation, pinned editors)
        this.viewSubscriptionCleanups = setupViewSubscriptions({
            cy: this.cy,
            navigationService: this.navigationService
        });

        // Initialize Cytoscape
        this.setupCytoscape();

        // Setup event listeners
        this.setupEventListeners();

        if (this.options.initialProjectedGraph) {
            applyGraphDeltaToUI(this.cy, this.options.initialProjectedGraph);
            this.searchService.updateSearchData();
            this.updateNavigatorVisibility();
        }

        // Setup command-hover mode
        // TEMP: Disabled to test if this is causing editor tap issues
        setupCommandHover(this.cy);

        // Folder TL chevron tap + body-drag pan wiring. Chevron itself is
        // painted as a cytoscape background-image (see defaultNodeStyles.ts).
        setupFolderHandles(this.cy);

        startGraphUpdateSubscription({
            hasInitialProjectedGraph: Boolean(this.options.initialProjectedGraph),
            isDisposed: () => this.isDisposed,
            getStartupVaultHint: window.electronAPI?.main?.getStartupVaultHint,
            openVault: window.electronAPI?.main?.openVault,
            subscribeToGraphUpdates: () => this.subscribeToGraphUpdates(),
        });
    }

    /**
     * Subscribe to graph delta updates from main process via electronAPI
     * Delegates to GraphUpdateHandler module for the actual subscription logic
     */
    private subscribeToGraphUpdates(): void {
        this.cleanupGraphSubscription = subscribeToGraphUpdatesFn(
            this.navigationService,
            this.searchService,
            this.updateNavigatorVisibility
        );
    }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================

    /**
     * Update graph styles (called by DarkModeManager on mode change)
     */
    private updateGraphStyles(): void {
        updateGraphStylesForCy(this.cy);
    }

    private render(): void {
        const rendered = renderGraphView({
            container: this.container,
            uiContainer: this.uiContainer,
            isDarkMode: isDarkModeState(),
            showFps: this.options.showFps,
            graphView: this,
            getCy: () => this.cy,
            onToggleDarkMode: () => this.toggleDarkMode(),
        });

        // DISABLED: Breathing animation causes 10s UI freeze with 60+ nodes
        // See: sat/ama_cpu_profile_root_cause_analysis.md
        // this.animationService = new BreathingAnimationService(this.cy);

        this.cy = rendered.cy;
        this.navigator = rendered.navigator;
        this.updateNavigatorVisibility = rendered.updateNavigatorVisibility;
        this.layoutProjectionUnmount = rendered.layoutProjectionUnmount;
    }

    private setupCytoscape(): void {
        const menuServices: { verticalMenuService: VerticalMenuService; } = setupCytoscapeHelper({
            cy: this.cy,
            savePositionsTimeout: {current: this.savePositionsTimeout},
            onLayoutComplete: () => this.layoutCompleteEmitter.emit(),
            onNodeSelected: (nodeId) => this.nodeSelectedEmitter.emit(nodeId),
            getCurrentGraphState: () => this.getCurrentGraphState(),
        });
        this.verticalMenuService = menuServices.verticalMenuService;
    }

    /**
     * Get current graph state for FloatingWindowManager
     */
    private getCurrentGraphState(): Graph {
        return this.currentGraphState;
    }

    private setupEventListeners(): void {
        const result: { handleResize: () => void; cleanupSettingsListener: () => void } = setupGraphViewEventListeners({
            cy: this.cy,
            container: this.container,
            navigationService: this.navigationService,
            searchService: this.searchService,
            hotkeyManager: this.hotkeyManager,
            onResizeMethod: () => this.handleResizeMethod(),
            onNavigateToRecentNode: (index) => this.navigateToRecentNodeByIndex(index),
            onCloseSelectedWindow: () => this.closeSelectedWindow()
        });
        this.handleResize = result.handleResize;
        this.cleanupSettingsListener = result.cleanupSettingsListener;
    }

    private handleResizeMethod(): void {
        console.warn(
            `[VoiceTreeGraphView] window resize event, `
            + `outer=${window.outerWidth}x${window.outerHeight}, `
            + `inner=${window.innerWidth}x${window.innerHeight}, `
            + `screen=${window.screen.width}x${window.screen.height}, `
            + `devicePixelRatio=${window.devicePixelRatio}, `
            + `zoom=${this.cy.zoom().toFixed(4)}, cy.size=${this.cy.width()}x${this.cy.height()}`
        );
        this.cy.resize();
    }

    // ============================================================================
    // PUBLIC API
    // ============================================================================

    focusNode(nodeId: string): void {
        const cy: cytoscape.Core = this.cy;
        const node: cytoscape.CollectionReturnValue = cy.getElementById(nodeId);
        if (node.length > 0) {
            cy.animate({
                fit: {
                    eles: node,
                    padding: 50
                },
                duration: 600
            });
        }
    }

    /**
     * Navigate to a node (used by search)
     * V2: No longer tracks "visited" nodes - recent tabs now show recently added/modified nodes
     */
    navigateToNodeAndTrack(nodeId: string): void {
        this.navigationService.handleSearchSelect(nodeId);
    }

    /**
     * Navigate to a recent node by index (0-4, for Cmd+1 through Cmd+5)
     */
    private navigateToRecentNodeByIndex(index: number): void {
        const history: RecentNodeHistory = getRecentNodeHistory();
        if (index >= 0 && index < history.length) {
            const nodeId: string = history[index].nodeToUpsert.absoluteFilePathIsID;
            this.navigationService.handleSearchSelect(nodeId);
        }
    }

    /**
     * Close the editor or terminal associated with the currently selected node
     * Used by the Cmd+W hotkey
     * Also closes settings editor if open and no node is selected
     */
    private closeSelectedWindow(): void {
        closeSelectedWindowFn(this.cy);
    }

    getSelectedNodes(): string[] {
        const cy: cytoscape.Core = this.cy;
        return cy.$(':selected')
            .nodes()
            .filter((n: cytoscape.NodeSingular) => !n.data('isFloatingWindow'))
            .map((n: cytoscape.NodeSingular) => n.id());
    }

    fit(paddingPercentage = 3): void {
        const cy: cytoscape.Core = this.cy;
        // Use responsive padding instead of fixed pixels (default was 50px on 1440p)
        const padding: number = getResponsivePadding(cy, paddingPercentage);
        console.warn(`[VoiceTreeGraphView.fit] zoom=${cy.zoom().toFixed(4)}, padding=${padding}, cy.size=${cy.width()}x${cy.height()}`);
        cyFitIntoVisibleViewport(cy, undefined, padding);
        console.warn(`[VoiceTreeGraphView.fit] after: zoom=${cy.zoom().toFixed(4)}`);
    }

    toggleDarkMode(): void {
        toggleDarkModeAction(createDarkModeCallbacks({
            updateGraphStyles: () => this.updateGraphStyles(),
            searchService: () => this.searchService
        }));
    }

    isDarkMode(): boolean {
        return isDarkModeState();
    }

    getStats(): { nodeCount: number; edgeCount: number } {
        const cy: cytoscape.Core = this.cy;
        return {
            nodeCount: cy.nodes().length,
            edgeCount: cy.edges().length
        };
    }

    // ============================================================================
    // EVENT EMITTERS
    // ============================================================================

    onNodeSelected(callback: (nodeId: string) => void): () => void {
        return this.nodeSelectedEmitter.on(callback);
    }

    onNodeDoubleClick(callback: (nodeId: string) => void): () => void {
        return this.nodeDoubleClickEmitter.on(callback);
    }

    onEdgeSelected(callback: (sourceId: string, targetId: string) => void): () => void {
        return this.edgeSelectedEmitter.on((data) => callback(data.source, data.target));
    }

    onLayoutComplete(callback: () => void): () => void {
        return this.layoutCompleteEmitter.on(callback);
    }

    // ============================================================================
    // LIFECYCLE
    // ============================================================================

    dispose(): void {
        if (this.isDisposed) {
            return;
        }

        disposeGraphView({
            cy: this.cy,
            handleResize: this.handleResize,
            cleanupGraphSubscription: this.cleanupGraphSubscription,
            layoutProjectionUnmount: this.layoutProjectionUnmount,
            viewSubscriptionCleanups: this.viewSubscriptionCleanups,
            cleanupSettingsListener: this.cleanupSettingsListener,
            hotkeyManager: this.hotkeyManager,
            gestureService: this.gestureService,
            searchService: this.searchService,
            verticalMenuService: this.verticalMenuService,
            animationService: this.animationService,
            navigator: this.navigator,
            nodeSelectedEmitter: this.nodeSelectedEmitter,
            nodeDoubleClickEmitter: this.nodeDoubleClickEmitter,
            edgeSelectedEmitter: this.edgeSelectedEmitter,
            layoutCompleteEmitter: this.layoutCompleteEmitter,
        });

        // Null out references after disposal
        this.cleanupGraphSubscription = null;
        this.layoutProjectionUnmount = null;
        this.cleanupSettingsListener = null;
        this.viewSubscriptionCleanups = null;
        // Call parent dispose
        super.dispose();
    }
}
