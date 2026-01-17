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
import {
    setupCommandHover,
    disposeEditorManager,
    closeEditor
} from '@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD';
import {HotkeyManager} from './HotkeyManager';
import {SearchService} from './SearchService';
// V2 recent node tabs - tracks recently added/modified nodes (not visited)
import {
    createRecentNodeTabsBar,
    renderRecentNodeTabsV2 as _renderRecentNodeTabsV2
} from './RecentNodeTabsBar';
// Agent tabs - shows open terminals in top-right
import {
    createAgentTabsBar,
    disposeAgentTabsBar
} from './AgentTabsBar';
import {getRecentNodeHistory} from '@/shell/edge/UI-edge/state/RecentNodeHistoryStore';
import type {RecentNodeHistory} from '@/pure/graph/recentNodeHistoryV2';
import {disposeGraphViewOverlays} from '@/shell/edge/UI-edge/state/GraphViewUIStore';
import {createNewNodeAction, runTerminalAction, deleteSelectedNodesAction} from '@/shell/UI/cytoscape-graph-ui/actions/graphActions';
import {getResponsivePadding} from '@/utils/responsivePadding';
import {SpeedDialSideGraphFloatingMenuView} from './SpeedDialSideGraphFloatingMenuView';
import type {Graph} from '@/pure/graph';
import {createEmptyGraph} from '@/pure/graph/createGraph';
import {setupBasicCytoscapeEventListeners, setupCytoscape, initializeCytoscapeInstance, setupGraphViewDOM, initializeNavigatorMinimap, type GraphViewDOMElements, type NavigatorMinimapResult} from './VoiceTreeGraphViewHelpers';
import {setupViewSubscriptions, cleanupViewSubscriptions, type ViewSubscriptionCleanups} from '@/shell/edge/UI-edge/graph/setupViewSubscriptions';
import {subscribeToGraphUpdates} from '@/shell/edge/UI-edge/graph/subscribeToGraphUpdates';
import {createSettingsEditor, closeSettingsEditor, isSettingsEditorOpen} from "@/shell/edge/UI-edge/settings/createSettingsEditor";
import type {TerminalData, ElectronAPI} from '@/shell/electron';

import {
    spawnBackupTerminal
} from "@/shell/edge/UI-edge/floating-windows/terminals/spawnBackupTerminal";
import {GraphNavigationService} from "@/shell/edge/UI-edge/graph/navigation/GraphNavigationService";
import {NavigationGestureService} from "@/shell/edge/UI-edge/graph/navigation/NavigationGestureService";
import {showFeedbackDialog} from "@/shell/edge/UI-edge/graph/userEngagementPrompts";
import {getEditorByNodeId} from '@/shell/edge/UI-edge/state/EditorStore';
import {getTerminalByNodeId} from '@/shell/edge/UI-edge/state/TerminalStore';
import {closeTerminal} from '@/shell/edge/UI-edge/floating-windows/terminals/spawnTerminalWithCommandFromUI';
import * as O from 'fp-ts/lib/Option.js';
import {toggleVoiceRecording} from '@/shell/edge/UI-edge/state/VoiceRecordingController';
import {DEFAULT_HOTKEYS} from '@/pure/settings/DEFAULT_SETTINGS';
import type {HotkeySettings, VTSettings} from '@/pure/settings/types';
import type {EditorData} from "@/shell/edge/UI-edge/floating-windows/editors/editorDataType";

/**
 * Main VoiceTreeGraphView implementation
 */
export class VoiceTreeGraphView extends Disposable implements IVoiceTreeGraphView {
    // Core instances
    private cy!: Core; // Initialized in render() called from constructor
    private navigator: { destroy: () => void } | null = null; // Navigator minimap instance
    private updateNavigatorVisibility: () => void = () => {}; // Updated by initializeNavigatorMinimap
    private container: HTMLElement;
    private options: VoiceTreeGraphViewOptions;

    // Services
    private styleService!: StyleService; // Initialized in render()
    private animationService!: BreathingAnimationService; // Initialized in render()
    private horizontalMenuService?: HorizontalMenuService; // Initialized in setupCytoscape()
    private verticalMenuService?: VerticalMenuService; // Initialized in setupCytoscape()

    // Managers
    private hotkeyManager: HotkeyManager;
    private searchService: SearchService;
    private navigationService: GraphNavigationService;
    private gestureService: NavigationGestureService;

    // State
    private _isDarkMode = false;
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
        options: VoiceTreeGraphViewOptions = {}
    ) {
        super();
        this.container = container;
        this.options = options;

        // Initialize dark mode
        this.setupDarkMode();

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
        createRecentNodeTabsBar(this.container);

        // Initialize agent tabs bar in title bar area (right side)
        createAgentTabsBar(this.container);

        // Setup view subscriptions (terminals, navigation, pinned editors)
        this.viewSubscriptionCleanups = setupViewSubscriptions({
            cy: this.cy,
            navigationService: this.navigationService
        });

        // Initialize Cytoscape
        this.setupCytoscape();

        // Setup event listeners
        this.setupEventListeners();

        this.autoLoadPreviousFolder();

        // Setup command-hover mode
        // TEMP: Disabled to test if this is causing editor tap issues
        setupCommandHover(this.cy);

        // Subscribe to graph delta updates via electronAPI
        this.subscribeToGraphUpdates();
    }

    /**
     * Subscribe to graph delta updates from main process via electronAPI
     */
    private subscribeToGraphUpdates(): void {
        this.cleanupGraphSubscription = subscribeToGraphUpdates(
            this.navigationService,
            this.searchService,
            this.updateNavigatorVisibility
        );
    }

    /**
     * Auto-load the last watched folder (if one exists)
     */
    private autoLoadPreviousFolder(): void {
        const electronAPI: ElectronAPI | undefined = window.electronAPI;

        if (!electronAPI?.main?.loadPreviousFolder) {
            console.warn('[VoiceTreeGraphView] loadPreviousFolder not available');
            return;
        }

        console.log('[VoiceTreeGraphView] Auto-loading previous folder...');
        electronAPI.main.loadPreviousFolder()
            .then((result: { success: boolean; directory?: string; error?: string }) => {
                if (result.success && result.directory) {
                    console.log('[VoiceTreeGraphView] Successfully auto-loaded folder:', result.directory);
                } else {
                    console.log('[VoiceTreeGraphView] No previous folder to load:', result.error);
                }
            })
            .catch((error: unknown) => {
                console.error('[VoiceTreeGraphView] Error auto-loading previous folder:', error);
            });
    }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================

    private setupDarkMode(): void {
        // Check localStorage first, then options
        const savedDarkMode: string | null = localStorage.getItem('darkMode');
        if (savedDarkMode !== null) {
            this._isDarkMode = savedDarkMode === 'true';
        } else if (this.options.initialDarkMode !== undefined) {
            this._isDarkMode = this.options.initialDarkMode;
        }

        // Apply to document
        if (this._isDarkMode) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    }

    private render(): void {
        // Setup DOM structure using extracted function
        // Note: speedDialCallbacks reference this.cy which isn't initialized yet,
        // so we pass callbacks that will access cy at call time
        const domElements: GraphViewDOMElements = setupGraphViewDOM({
            container: this.container,
            isDarkMode: this._isDarkMode,
            speedDialCallbacks: {
                onToggleDarkMode: () => this.toggleDarkMode(),
                onBackup: () => { void spawnBackupTerminal(this.cy); },
                onSettings: () => void createSettingsEditor(this.cy),
                onAbout: () => window.open('https://voicetree.io', '_blank'),
                onStats: () => window.dispatchEvent(new Event('toggle-stats-panel')),
                onFeedback: () => void showFeedbackDialog()
            }
        });

        // Store speedDialMenu reference for lifecycle management (other overlays are in DOM)
        this.speedDialMenu = domElements.speedDialMenu;

        // Initialize Cytoscape with the container directly
        // Container serves as both the wrapper and the cytoscape rendering target
        this.container.style.opacity = '0.3';
        this.container.style.transition = 'opacity 0.3s ease-in-out';

        // Initialize StyleService
        this.styleService = new StyleService();

        // Initialize cytoscape using extracted factory function
        const {cy} = initializeCytoscapeInstance({
            container: this.container,
            stylesheet: this.styleService.getCombinedStylesheet()
        });
        this.cy = cy;

        // Expose cytoscape instance to window for testing
        (window as unknown as { cytoscapeInstance: unknown }).cytoscapeInstance = this.cy;

        // Expose voiceTreeGraphView to window for testing
        (window as unknown as { voiceTreeGraphView: VoiceTreeGraphView }).voiceTreeGraphView = this;

        // Initialize animation service with cy instance (sets up event listeners)
        this.animationService = new BreathingAnimationService(this.cy);

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
            console.log('[VoiceTreeGraphView] Window closing, saving positions...');
            // Use synchronous IPC if available, otherwise just log
            // todo this.saveNodePositions();
        };
        window.addEventListener('beforeunload', handleBeforeUnload);

        // Focus container to ensure it receives keyboard events
        this.container.focus();

        // Setup hotkeys with settings (async load with platform-aware defaults as fallback)
        void (async (): Promise<void> => {
            const settings: VTSettings | null = await window.electronAPI?.main.loadSettings() ?? null;
            const hotkeys: HotkeySettings = settings?.hotkeys ?? DEFAULT_HOTKEYS;

            // Setup graph-specific hotkeys via HotkeyManager
            this.hotkeyManager.setupGraphHotkeys({
                fitToLastNode: () => this.navigationService.fitToLastNode(),
                cycleTerminal: (direction) => this.navigationService.cycleTerminal(direction),
                createNewNode: createNewNodeAction(this.cy),
                runTerminal: runTerminalAction(this.cy),
                deleteSelectedNodes: deleteSelectedNodesAction(this.cy),
                navigateToRecentNode: (index) => this.navigateToRecentNodeByIndex(index),
                closeSelectedWindow: () => this.closeSelectedWindow(),
                openSettings: () => void createSettingsEditor(this.cy),
                openSearch: () => this.searchService.open()
            }, hotkeys);

            // Register voice recording hotkey
            this.hotkeyManager.registerVoiceHotkey(toggleVoiceRecording, hotkeys.voiceRecording);
        })();

        // Note: Wheel events (pan/zoom) are handled by NavigationGestureService
    }

    private handleResizeMethod(): void {
        this.cy.resize();
        this.cy.fit();
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
        const selected: cytoscape.CollectionReturnValue = this.cy.$(':selected');

        // If no node selected, try closing the settings editor
        if (selected.length === 0) {
            if (isSettingsEditorOpen()) {
                closeSettingsEditor(this.cy);
            }
            return;
        }

        const nodeId: string = selected.first().id();

        // Try closing editor first
        const editor: O.Option<EditorData> = getEditorByNodeId(nodeId);
        if (O.isSome(editor)) {
            closeEditor(this.cy, editor.value);
            return;
        }

        // Try closing terminal
        const terminal: O.Option<TerminalData> = getTerminalByNodeId(nodeId);
        if (O.isSome(terminal)) {
            void closeTerminal(terminal.value, this.cy);
        }
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
        this._isDarkMode = !this._isDarkMode;

        if (this._isDarkMode) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }

        localStorage.setItem('darkMode', String(this._isDarkMode));

        // Update graph styles
        const styleService: StyleService = new StyleService();
        const newStyles: { selector: string; style: Record<string, unknown>; }[] = styleService.getCombinedStylesheet();
        this.cy.style(newStyles);

        // Update search service theme
        this.searchService.updateTheme(this._isDarkMode);

        // Update speed dial menu icon
        if (this.speedDialMenu) {
            this.speedDialMenu.updateDarkMode(this._isDarkMode);
        }
    }

    isDarkMode(): boolean {
        return this._isDarkMode;
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

        console.log('[VoiceTreeGraphView] Disposing...');

        // Remove window event listeners
        window.removeEventListener('resize', this.handleResize);

        // Cleanup graph subscription
        if (this.cleanupGraphSubscription) {
            this.cleanupGraphSubscription();
            this.cleanupGraphSubscription = null;
        }

        // Cleanup view subscriptions (terminals, navigation, pinned editors)
        if (this.viewSubscriptionCleanups) {
            cleanupViewSubscriptions(this.viewSubscriptionCleanups);
            this.viewSubscriptionCleanups = null;
        }

        // Dispose managers
        this.hotkeyManager.dispose();
        this.gestureService.dispose();
        disposeEditorManager(this.cy);
        this.searchService.dispose();
        // TODO: Recent tabs temporarily disabled until better UX is designed
        // disposeRecentNodeTabsBar();
        disposeAgentTabsBar();
        disposeGraphViewOverlays();

        // Dispose menu services
        if (this.horizontalMenuService) {
            this.horizontalMenuService.destroy();
        }
        if (this.verticalMenuService) {
            this.verticalMenuService.destroy();
        }

        // Dispose speed dial menu
        if (this.speedDialMenu) {
            this.speedDialMenu.dispose();
            this.speedDialMenu = null;
        }

        // Destroy services
        if (this.animationService) {
            this.animationService.destroy();
        }

        // Destroy navigator minimap
        if (this.navigator) {
            this.navigator.destroy();
        }

        // Destroy Cytoscape
        this.cy.destroy();

        // Clear event emitters
        this.nodeSelectedEmitter.clear();
        this.nodeDoubleClickEmitter.clear();
        this.edgeSelectedEmitter.clear();
        this.layoutCompleteEmitter.clear();

        // Call parent dispose
        super.dispose();
    }
}
