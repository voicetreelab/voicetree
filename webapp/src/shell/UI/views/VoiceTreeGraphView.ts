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
 */

// TODO, WE REALLY WANT TO AVOID ADDING ANYTHING EVER TO THIS FILE
// IF WE ADD IT TO THIS FILE, it's TECH DEBT
// ALL NEW CODE SHOULD BE MOVED INTO FUNCTIONAL pure or edge

import {Disposable} from './Disposable';
import {EventEmitter} from './EventEmitter';
import type {
    IVoiceTreeGraphView,
    VoiceTreeGraphViewOptions
} from './IVoiceTreeGraphView';
import cytoscape, {type Core} from 'cytoscape';
// @ts-expect-error - cytoscape-navigator doesn't have proper TypeScript definitions
import navigator from 'cytoscape-navigator';
// @ts-expect-error - cytoscape-layout-utilities doesn't have proper TypeScript definitions
import layoutUtilities from 'cytoscape-layout-utilities';
// @ts-expect-error CSS import - types declared in vite-env.d.ts (not visible to minimal TS program)
import 'cytoscape-navigator/cytoscape.js-navigator.css'; // Import navigator CSS
// @ts-expect-error CSS import - types declared in vite-env.d.ts (not visible to minimal TS program)
import '@/shell/UI/views/styles/navigator.css'; // Custom navigator styling
// @ts-expect-error CSS import - types declared in vite-env.d.ts (not visible to minimal TS program)
import '@/shell/UI/cytoscape-graph-ui/styles/graph.css'; // Custom navigator styling
import '@/shell/UI/cytoscape-graph-ui'; // Import to trigger extension registration

// Register cytoscape extensions
cytoscape.use(navigator);
cytoscape.use(layoutUtilities);
import {StyleService} from '@/shell/UI/cytoscape-graph-ui/services/StyleService';
import {BreathingAnimationService} from '@/shell/UI/cytoscape-graph-ui/services/BreathingAnimationService';
import {HorizontalMenuService} from '@/shell/UI/cytoscape-graph-ui/services/HorizontalMenuService';
import {VerticalMenuService} from '@/shell/UI/cytoscape-graph-ui/services/VerticalMenuService';
import {setupCommandHover} from '@/shell/edge/UI-edge/floating-windows/editors/HoverEditor';
import {HotkeyManager} from './HotkeyManager';
import {SearchService} from './SearchService';
// V2 recent node tabs - tracks recently added/modified nodes (not visited)
import {
    createRecentNodeTabsBar,
    renderRecentNodeTabsV2 as _renderRecentNodeTabsV2
} from './RecentNodeTabsBar';
// Terminal tree sidebar - shows open terminals as vertical tree on LHS
import {createTerminalTreeSidebar} from './treeStyleTerminalTabs/TerminalTreeSidebar';
import {getRecentNodeHistory} from '@/shell/edge/UI-edge/state/RecentNodeHistoryStore';
import type {RecentNodeHistory} from '@/pure/graph/recentNodeHistoryV2';
import {createNewNodeAction, runTerminalAction, deleteSelectedNodesAction} from '@/shell/UI/cytoscape-graph-ui/actions/graphActions';
import {getResponsivePadding} from '@/utils/responsivePadding';
import {SpeedDialSideGraphFloatingMenuView} from './SpeedDialSideGraphFloatingMenuView';
import type {Graph} from '@/pure/graph';
import {createEmptyGraph} from '@/pure/graph/createGraph';
import {setupBasicCytoscapeEventListeners, setupCytoscape, initializeCytoscapeInstance, setupGraphViewDOM, initializeNavigatorMinimap, guardCytoscapeResize, type GraphViewDOMElements, type NavigatorMinimapResult} from './VoiceTreeGraphViewHelpers';
import {setupViewSubscriptions, type ViewSubscriptionCleanups} from '@/shell/edge/UI-edge/graph/setupViewSubscriptions';
import {subscribeToGraphUpdates} from '@/shell/edge/UI-edge/graph/subscribeToGraphUpdates';
import {createSettingsEditor} from "@/shell/edge/UI-edge/settings/createSettingsEditor";

import {GraphNavigationService} from "@/shell/edge/UI-edge/graph/navigation/GraphNavigationService";
import {NavigationGestureService} from "@/shell/edge/UI-edge/graph/navigation/NavigationGestureService";
import {collectFeedback} from "@/shell/edge/UI-edge/graph/userEngagementPrompts";
import {toggleVoiceRecording} from '@/shell/edge/UI-edge/state/VoiceRecordingController';
import {
    initializeDarkMode,
    toggleDarkMode as toggleDarkModeAction,
    isDarkMode as isDarkModeState
} from '@/shell/edge/UI-edge/state/DarkModeManager';
import {disposeGraphView} from './disposeGraphView';
import {closeSelectedWindow as closeSelectedWindowFn} from './closeSelectedWindow';

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
    private styleService!: StyleService; // Initialized in render()
    private animationService?: BreathingAnimationService; // Disabled for performance - see ama_cpu_profile_root_cause_analysis.md
    private horizontalMenuService?: HorizontalMenuService; // Initialized in setupCytoscape()
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

    // View subscriptions cleanup (terminals, navigation, pinned editors)
    private viewSubscriptionCleanups: ViewSubscriptionCleanups | null = null;

    // DOM element reference (speedDialMenu needs lifecycle management for cleanup)
    private speedDialMenu: SpeedDialSideGraphFloatingMenuView | null = null;

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
        void initializeDarkMode(this.options.initialDarkMode, {
            updateGraphStyles: () => this.updateGraphStyles(),
            updateSpeedDialMenu: (isDark) => this.speedDialMenu?.updateDarkMode(isDark)
        });

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

        // Initialize recent tabs bar V2 in title bar area
        // V2 tracks recently added/modified nodes (not visited nodes)
        createRecentNodeTabsBar(this.uiContainer);

        // Initialize terminal tree sidebar (left side, React component)
        createTerminalTreeSidebar(this.uiContainer, (terminal) => {
            this.navigationService.fitToTerminal(terminal);
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

        // Signal to main process that frontend is ready to receive graph data
        void window.electronAPI?.main?.markFrontendReady();

        // Setup command-hover mode
        // TEMP: Disabled to test if this is causing editor tap issues
        setupCommandHover(this.cy);

        // Subscribe to graph delta updates via electronAPI
        this.subscribeToGraphUpdates();
    }

    /**
     * Subscribe to graph delta updates from main process via electronAPI
     * Delegates to GraphUpdateHandler module for the actual subscription logic
     */
    private subscribeToGraphUpdates(): void {
        this.cleanupGraphSubscription = subscribeToGraphUpdates(
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
        if (!this.cy) return;
        const styleService: StyleService = new StyleService();
        const newStyles: { selector: string; style: Record<string, unknown>; }[] = styleService.getCombinedStylesheet();
        this.cy.style().clear().fromJson(newStyles).update();
    }

    private render(): void {
        // Setup DOM structure using extracted function
        // Note: speedDialCallbacks reference this.cy which isn't initialized yet,
        // so we pass callbacks that will access cy at call time
        const domElements: GraphViewDOMElements = setupGraphViewDOM({
            container: this.container,
            uiContainer: this.uiContainer,
            isDarkMode: isDarkModeState(),
            speedDialCallbacks: {
                onToggleDarkMode: () => this.toggleDarkMode(),
                onSettings: () => void createSettingsEditor(this.cy),
                onAbout: () => window.open('https://voicetree.io', '_blank'),
                onStats: () => window.dispatchEvent(new Event('toggle-stats-panel')),
                onFeedback: () => void collectFeedback()
            }
        });

        // Store speedDialMenu reference for lifecycle management (other overlays are in DOM)
        this.speedDialMenu = domElements.speedDialMenu;

        // Initialize Cytoscape directly on container (userZoomingEnabled: false)
        // All zoom handled by NavigationGestureService.zoomAtCursor() for unified behavior
        this.container.style.opacity = '0.3';
        this.container.style.transition = 'opacity 0.3s ease-in-out';

        // Initialize StyleService
        this.styleService = new StyleService();

        // Initialize cytoscape directly on container
        const {cy} = initializeCytoscapeInstance({
            container: this.container,
            stylesheet: this.styleService.getCombinedStylesheet()
        });
        this.cy = cy;

        // Guard against canvas shrinking during layout instability (e.g. WebGL context loss cascade)
        guardCytoscapeResize(this.cy);

        // Expose cytoscape instance to window for testing
        (window as unknown as { cytoscapeInstance: unknown }).cytoscapeInstance = this.cy;

        // Expose voiceTreeGraphView to window for testing
        (window as unknown as { voiceTreeGraphView: VoiceTreeGraphView }).voiceTreeGraphView = this;

        // DISABLED: Breathing animation causes 10s UI freeze with 60+ nodes
        // See: sat/ama_cpu_profile_root_cause_analysis.md
        // this.animationService = new BreathingAnimationService(this.cy);

        // Initialize navigator minimap (bottom-right corner, performance-optimized)
        const navigatorResult: NavigatorMinimapResult = initializeNavigatorMinimap(this.cy);
        this.navigator = navigatorResult.navigator;
        this.updateNavigatorVisibility = navigatorResult.updateVisibility;

        // Update node degrees after initial elements are added
        this.updateNodeDegrees();

        // Update node sizes based on initial degrees
        this.styleService.updateNodeSizes(this.cy);

        // Setup basic cytoscape event listeners (hover, focus, etc.)
        this.setupBasicCytoscapeEventListeners();

        // Update opacity after Cytoscape is ready
        this.container.style.opacity = '1';
    }

    /**
     * Update the degree data attribute for all nodes based on their connections.
     * This is used by the StyleService to apply degree-based sizing and styling.
     */
    private updateNodeDegrees(): void {
        if (!this.cy) return;
        this.cy.nodes().forEach(node => {
            node.data('degree', node.degree());
        });
    }

    /**
     * Setup basic cytoscape event listeners for hover, focus, box selection, etc.
     * These were previously in CytoscapeCore.setupEventListeners()
     */
    private setupBasicCytoscapeEventListeners(): void {
        setupBasicCytoscapeEventListeners(
            this.cy,
            this.styleService,
            this.container
        );
    }

    private setupCytoscape(): void {
        const menuServices: { horizontalMenuService: HorizontalMenuService; verticalMenuService: VerticalMenuService; } = setupCytoscape({
            cy: this.cy,
            savePositionsTimeout: {current: this.savePositionsTimeout},
            onLayoutComplete: () => this.layoutCompleteEmitter.emit(),
            onNodeSelected: (nodeId) => this.nodeSelectedEmitter.emit(nodeId),
            getCurrentGraphState: () => this.getCurrentGraphState(),
        });
        this.horizontalMenuService = menuServices.horizontalMenuService;
        this.verticalMenuService = menuServices.verticalMenuService;
    }

    /**
     * Get current graph state for FloatingWindowManager
     */
    private getCurrentGraphState(): Graph {
        return this.currentGraphState;
    }

    private setupEventListeners(): void {
        // Bind handlers
        this.handleResize = this.handleResizeMethod.bind(this);

        // Window resize
        window.addEventListener('resize', this.handleResize);

        // Save positions before window closes
        const handleBeforeUnload: () => void = () => {
            //console.log('[VoiceTreeGraphView] Window closing, saving positions...');
            // Use synchronous IPC if available, otherwise just log
            // todo this.saveNodePositions();
        };
        window.addEventListener('beforeunload', handleBeforeUnload);

        // Focus container to ensure it receives keyboard events
        this.container.focus();

        // Setup hotkeys with settings (async load handled internally by HotkeyManager)
        void this.hotkeyManager.initializeWithSettings(
            {
                fitToLastNode: () => this.navigationService.fitToLastNode(),
                cycleTerminal: (direction) => this.navigationService.cycleTerminal(direction),
                createNewNode: createNewNodeAction(this.cy),
                runTerminal: runTerminalAction(this.cy),
                deleteSelectedNodes: deleteSelectedNodesAction(this.cy),
                navigateToRecentNode: (index) => this.navigateToRecentNodeByIndex(index),
                closeSelectedWindow: () => this.closeSelectedWindow(),
                openSettings: () => void createSettingsEditor(this.cy),
                openSearch: () => this.searchService.open()
            },
            toggleVoiceRecording
        );

        // Note: Wheel events (pan/zoom) are handled by NavigationGestureService
    }

    private handleResizeMethod(): void {
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
        cy.fit(undefined, getResponsivePadding(cy, paddingPercentage));
    }

    toggleDarkMode(): void {
        toggleDarkModeAction({
            updateGraphStyles: () => this.updateGraphStyles(),
            updateSpeedDialMenu: (isDark) => this.speedDialMenu?.updateDarkMode(isDark),
            updateSearchTheme: (isDark) => this.searchService.updateTheme(isDark)
        });
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
            viewSubscriptionCleanups: this.viewSubscriptionCleanups,
            hotkeyManager: this.hotkeyManager,
            gestureService: this.gestureService,
            searchService: this.searchService,
            horizontalMenuService: this.horizontalMenuService,
            verticalMenuService: this.verticalMenuService,
            speedDialMenu: this.speedDialMenu,
            animationService: this.animationService,
            navigator: this.navigator,
            nodeSelectedEmitter: this.nodeSelectedEmitter,
            nodeDoubleClickEmitter: this.nodeDoubleClickEmitter,
            edgeSelectedEmitter: this.edgeSelectedEmitter,
            layoutCompleteEmitter: this.layoutCompleteEmitter,
        });

        // Null out references after disposal
        this.cleanupGraphSubscription = null;
        this.viewSubscriptionCleanups = null;
        this.speedDialMenu = null;

        // Call parent dispose
        super.dispose();
    }
}
