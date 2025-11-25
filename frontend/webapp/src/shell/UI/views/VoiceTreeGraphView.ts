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

import {Disposable} from './Disposable.ts';
import {EventEmitter} from './EventEmitter.ts';
import type {
    IVoiceTreeGraphView,
    VoiceTreeGraphViewOptions
} from './IVoiceTreeGraphView.ts';
import cytoscape, {type Core, type CytoscapeOptions} from 'cytoscape';
// @ts-expect-error - cytoscape-navigator doesn't have proper TypeScript definitions
import navigator from 'cytoscape-navigator';
import 'cytoscape-navigator/cytoscape.js-navigator.css'; // Import navigator CSS
import '@/shell/UI/views/styles/navigator.css'; // Custom navigator styling
import '@/shell/UI/cytoscape-graph-ui'; // Import to trigger extension registration

// Register cytoscape-navigator extension
cytoscape.use(navigator);
import {StyleService} from '@/shell/UI/cytoscape-graph-ui/services/StyleService.ts';
import {BreathingAnimationService} from '@/shell/UI/cytoscape-graph-ui/services/BreathingAnimationService.ts';
import {RadialMenuService} from '@/shell/UI/cytoscape-graph-ui/services/RadialMenuService.ts';
import {VerticalMenuService} from '@/shell/UI/cytoscape-graph-ui/services/VerticalMenuService.ts';
import {FloatingEditorManager} from '@/shell/UI/floating-windows/editors/FloatingEditorManager.ts';
import {HotkeyManager} from './HotkeyManager.ts';
import {SearchService} from './SearchService.ts';
import {GraphNavigationService} from './GraphNavigationService.ts';
import {createNewNodeAction, runTerminalAction} from '@/shell/UI/cytoscape-graph-ui/actions/graphActions.ts';
import {getResponsivePadding} from '@/utils/responsivePadding.ts';
import {SpeedDialSideGraphFloatingMenuView} from './SpeedDialSideGraphFloatingMenuView.ts';
import type {Graph, GraphDelta} from '@/pure/graph';
import {MIN_ZOOM, MAX_ZOOM} from '@/shell/UI/cytoscape-graph-ui/constants.ts';
import {setupBasicCytoscapeEventListeners, setupCytoscape} from './VoiceTreeGraphViewHelpers';
import {applyGraphDeltaToUI} from '@/shell/edge/UI-edge/graph/applyGraphDeltaToUI.ts';
import {clearCytoscapeState} from '@/shell/edge/UI-edge/graph/clearCytoscapeState.ts';
import {createSettingsEditor} from "@/shell/edge/UI-edge/settings/createSettingsEditor.ts";

import {
    spawnBackupTerminal
} from "@/shell/edge/UI-edge/floating-windows/terminals/spawnBackupTerminal.ts";

/**
 * Main VoiceTreeGraphView implementation
 */
export class VoiceTreeGraphView extends Disposable implements IVoiceTreeGraphView {
    // Core instances
    private cy!: Core; // Initialized in render() called from constructor
    private navigator?: { destroy: () => void }; // Navigator minimap instance
    private container: HTMLElement;
    private options: VoiceTreeGraphViewOptions;

    // Services
    private styleService!: StyleService; // Initialized in render()
    private animationService!: BreathingAnimationService; // Initialized in render()
    private radialMenuService?: RadialMenuService; // Initialized in setupCytoscape()
    private verticalMenuService?: VerticalMenuService; // Initialized in setupCytoscape()

    // Managers
    private floatingWindowManager: FloatingEditorManager;
    private hotkeyManager: HotkeyManager;
    private searchService: SearchService;
    private navigationService: GraphNavigationService;

    // State
    private _isDarkMode = false;
    private currentGraphState: Graph = {nodes: {}};

    // Graph subscription cleanup
    private cleanupGraphSubscription: (() => void) | null = null;

    // DOM elements
    private statsOverlay: HTMLElement | null = null;
    private loadingOverlay: HTMLElement | null = null;
    private errorOverlay: HTMLElement | null = null;
    private emptyStateOverlay: HTMLElement | null = null;
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
        this.floatingWindowManager = new FloatingEditorManager(
            this.cy,
            () => this.getCurrentGraphState(),
            this.hotkeyManager
        );
        this.navigationService = new GraphNavigationService(this.cy);
        this.searchService = new SearchService(
            this.cy,
            (nodeId) => this.navigationService.handleSearchSelect(nodeId)
        );

        // Initialize Cytoscape
        this.setupCytoscape();

        // Setup event listeners
        this.setupEventListeners();

        this.autoLoadPreviousFolder();

        // Setup command-hover mode
        // TEMP: Disabled to test if this is causing editor tap issues
        this.floatingWindowManager.setupCommandHover();

        // Subscribe to graph delta updates via electronAPI
        this.subscribeToGraphUpdates();
    }

    /**
     * Subscribe to graph delta updates from main process via electronAPI
     */
    private subscribeToGraphUpdates(): void {
        // Access electronAPI with type assertion since global Window type may not be recognized
        const electronAPI = window.electronAPI;

        if (!electronAPI?.graph?.onGraphUpdate) {
            console.error('[VoiceTreeGraphView] electronAPI not available, skipping graph subscription');
            return;
        }

        const handleGraphDelta = (delta: GraphDelta): void => {
            console.log('[VoiceTreeGraphView] Received graph delta, length:', delta.length);
            console.trace('[VoiceTreeGraphView] Graph delta stack trace'); // DEBUG: Check if called repeatedly
            if (this.emptyStateOverlay) {
                this.emptyStateOverlay.style.display = 'none';
            }
            applyGraphDeltaToUI(this.cy, delta);

            // Track last created node for "fit to last node" hotkey (Space)
            const lastUpsertedNode = delta.filter(d => d.type === 'UpsertNode').pop();
            if (lastUpsertedNode && lastUpsertedNode.type === 'UpsertNode') {
                this.navigationService.setLastCreatedNodeId(lastUpsertedNode.nodeToUpsert.relativeFilePathIsID);
            }

            // fit to first few nodes added
            if (this.cy.nodes().size() <= 3){
                this.cy.fit()
            }
            this.searchService.updateSearchData();

            // Update floating editor windows with new content from external changes
            this.floatingWindowManager.updateFloatingEditors(delta);

            // Update navigator visibility based on node count
            this.updateNavigatorVisibility();

        };

        const handleGraphClear = (): void => {
            console.log('[VoiceTreeGraphView] Received graph:clear event');
            clearCytoscapeState(this.cy);

            // Close all open floating editors
            this.floatingWindowManager.closeAllEditors();

            if (this.emptyStateOverlay) {
                this.emptyStateOverlay.style.display = 'flex';
            }
        };

        // Subscribe to graph updates via electronAPI (returns cleanup function)
        const cleanupUpdate = electronAPI.graph.onGraphUpdate(handleGraphDelta);
        const cleanupClear = electronAPI.graph.onGraphClear?.(handleGraphClear);

        // Store combined cleanup function
        this.cleanupGraphSubscription = () => {
            cleanupUpdate();
            cleanupClear?.();
        };

        // Auto-load previous folder if available
    }

    /**
     * Auto-load the last watched folder (if one exists)
     */
    private autoLoadPreviousFolder(): void {
        const electronAPI = window.electronAPI;

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
        const savedDarkMode = localStorage.getItem('darkMode');
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
        // Set container classes
        this.container.className = 'h-full w-full bg-background overflow-hidden relative';
        // Allow container to receive keyboard events
        this.container.setAttribute('tabindex', '0');

        // Create hamburger button
        const menuBtn = document.createElement('button');
        menuBtn.className = 'fixed top-4 left-4 z-50 p-2 rounded-lg hover:bg-accent transition-colors';
        menuBtn.setAttribute('aria-label', 'Toggle menu');
        menuBtn.innerHTML = `
      <svg class="w-6 h-6 text-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    `;
        menuBtn.onclick = () => {
            const event = new CustomEvent('toggleSidebar');
            window.dispatchEvent(event);
        };
        this.container.appendChild(menuBtn);

        // Create speed dial menu
        this.speedDialMenu = new SpeedDialSideGraphFloatingMenuView(this.container, {
            onToggleDarkMode: () => this.toggleDarkMode(),
            onBackup: () => { void spawnBackupTerminal(this.cy); },
            onSettings: () => void createSettingsEditor(this.cy),
            onAbout: () => console.log('[SpeedDial] About clicked'),
            isDarkMode: this._isDarkMode,
        });

        // Create loading overlay
        this.loadingOverlay = document.createElement('div');
        this.loadingOverlay.className = 'absolute top-4 right-4 bg-blue-500 text-white px-3 py-1.5 rounded-md shadow-lg text-sm font-medium z-10';
        this.loadingOverlay.textContent = 'Loading graph...';
        this.loadingOverlay.style.display = 'none';
        this.container.appendChild(this.loadingOverlay);

        // Create error overlay
        this.errorOverlay = document.createElement('div');
        this.errorOverlay.className = 'absolute top-4 right-4 bg-red-500 text-white px-3 py-1.5 rounded-md shadow-lg text-sm font-medium z-10';
        this.errorOverlay.style.display = 'none';
        this.container.appendChild(this.errorOverlay);

        // Create empty state overlay
        this.emptyStateOverlay = document.createElement('div');
        this.emptyStateOverlay.className = 'absolute inset-0 flex items-center justify-center text-muted-foreground pointer-events-none z-10';
        this.emptyStateOverlay.innerHTML = `
      <div class="text-center">
        <svg class="w-24 h-24 mx-auto mb-4 opacity-20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
          <circle cx="12" cy="12" r="3" />
          <circle cx="6" cy="6" r="2" />
          <circle cx="18" cy="6" r="2" />
          <circle cx="6" cy="18" r="2" />
          <circle cx="18" cy="18" r="2" />
          <path d="M12 9 L6 6" />
          <path d="M12 9 L18 6" />
          <path d="M12 15 L6 18" />
          <path d="M12 15 L18 18" />
        </svg>
        <p class="text-sm">Graph visualization will appear here</p>
        <p class="text-xs text-muted-foreground/60 mt-2">Use "Open Folder" to watch markdown files live</p>
        <p class="text-xs text-muted-foreground/60">Powered by Cytoscape.js</p>
      </div>
    `;
        this.container.appendChild(this.emptyStateOverlay);

        // Create stats overlay
        this.statsOverlay = document.createElement('div');
        this.statsOverlay.className = 'absolute bottom-4 right-4 bg-background/80 backdrop-blur-sm rounded-lg px-3 py-2 text-xs text-muted-foreground pointer-events-none z-10';
        this.statsOverlay.style.display = 'none';
        this.container.appendChild(this.statsOverlay);

        // Initialize Cytoscape with the container directly
        // Container serves as both the wrapper and the cytoscape rendering target
        this.container.style.opacity = '0.3';
        this.container.style.transition = 'opacity 0.3s ease-in-out';

        // Initialize StyleService
        this.styleService = new StyleService();

        // Initialize cytoscape
        // Try with container first, fall back to headless if it fails (e.g., in JSDOM)
        let cytoscapeOptions: CytoscapeOptions = {
            elements: [],
            style: this.styleService.getCombinedStylesheet(),
            minZoom: MIN_ZOOM,
            maxZoom: MAX_ZOOM,
            boxSelectionEnabled: true,
            container: this.container
        };

        try {
            this.cy = cytoscape(cytoscapeOptions);
        } catch (error) {
            // If container-based initialization fails (e.g., JSDOM without proper layout),
            // fall back to headless mode
            console.log('[VoiceTreeGraphView] Container-based init failed, using headless mode:', error);
            cytoscapeOptions = {
                ...cytoscapeOptions,
                container: undefined,
                headless: true
            };
            this.cy = cytoscape(cytoscapeOptions);
        }

        // Expose cytoscape instance to window for testing
        (window as unknown as { cytoscapeInstance: unknown }).cytoscapeInstance = this.cy;

        // Expose navigationService to window for testing
        (window as unknown as { navigationService: unknown }).navigationService = this.navigationService;

        // Expose voiceTreeGraphView to window for testing
        (window as unknown as { voiceTreeGraphView: VoiceTreeGraphView }).voiceTreeGraphView = this;

        // Initialize animation service with cy instance (sets up event listeners)
        this.animationService = new BreathingAnimationService(this.cy);

        // Initialize navigator minimap (bottom-right corner, performance-optimized)
        this.initializeNavigator();

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
            this.animationService,
            this.styleService,
            this.container
        );
    }

    private setupCytoscape(): void {
        const menuServices = setupCytoscape({
            cy: this.cy,
            savePositionsTimeout: {current: this.savePositionsTimeout},
            onLayoutComplete: () => this.layoutCompleteEmitter.emit(),
            onNodeSelected: (nodeId) => this.nodeSelectedEmitter.emit(nodeId),
            getCurrentGraphState: () => this.getCurrentGraphState(),
            floatingWindowManager: this.floatingWindowManager
        });
        this.radialMenuService = menuServices.radialMenuService;
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
        const handleBeforeUnload = () => {
            console.log('[VoiceTreeGraphView] Window closing, saving positions...');
            // Use synchronous IPC if available, otherwise just log
            // todo this.saveNodePositions();
        };
        window.addEventListener('beforeunload', handleBeforeUnload);

        // Focus container to ensure it receives keyboard events
        this.container.focus();

        // Setup graph-specific hotkeys via HotkeyManager
        this.hotkeyManager.setupGraphHotkeys({
            fitToLastNode: () => this.navigationService.fitToLastNode(),
            cycleTerminal: (direction) => this.navigationService.cycleTerminal(direction),
            createNewNode: createNewNodeAction(this.cy, this.floatingWindowManager),
            runTerminal: runTerminalAction(this.cy)
        });

        // Register cmd-f for search
        this.hotkeyManager.registerHotkey({
            key: 'f',
            modifiers: ['Meta'],
            onPress: () => this.searchService.open()
        });

        // Prevent page scroll when zooming
        const handleWheel = (e: WheelEvent) => e.preventDefault();
        this.container.addEventListener('wheel', handleWheel, {passive: false});
    }

    private handleResizeMethod(): void {
        this.cy.resize();
        this.cy.fit();
    }

    /**
     * Initialize the navigator minimap widget
     * Positioned in bottom-right corner with performance-optimized settings
     */
    private initializeNavigator(): void {
        if (!this.cy) {
            console.warn('[VoiceTreeGraphView] Cannot initialize navigator: cy not initialized');
            return;
        }

        try {
            // Initialize navigator with performance-optimized settings
            // Let library auto-create container, which we'll style with CSS
            // Use false for viewLiveFramerate to prevent interference with floating windows
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.navigator = (this.cy as any).navigator({
                container: false, // Auto-create container
                viewLiveFramerate: false, // Only update on drag end to avoid transform interference
                thumbnailEventFramerate: 30, // Update thumbnail more frequently for responsiveness
                thumbnailLiveFramerate: false, // Disable continuous thumbnail updates for performance
                dblClickDelay: 200,
                removeCustomContainer: true, // Let library manage container cleanup
                rerenderDelay: 100 // Throttle rerenders
            });

            console.log('[VoiceTreeGraphView] Navigator minimap initialized');

            // Initially hide minimap if there's only one node or less
            this.updateNavigatorVisibility();
        } catch (error) {
            console.error('[VoiceTreeGraphView] Failed to initialize navigator:', error);
        }
    }

    /**
     * Show or hide the navigator minimap based on node count
     * Only shows the minimap when there are 2 or more nodes in the graph
     */
    private updateNavigatorVisibility(): void {
        if (!this.navigator) {
            return;
        }

        const nodeCount = this.cy.nodes().length;
        const navigatorElement = document.querySelector('.cytoscape-navigator') as HTMLElement;

        if (navigatorElement) {
            if (nodeCount <= 1) {
                navigatorElement.style.display = 'none';
            } else {
                navigatorElement.style.display = 'block';
            }
        }
    }

    // ============================================================================
    // PUBLIC API
    // ============================================================================

    focusNode(nodeId: string): void {
        const cy = this.cy;
        const node = cy.getElementById(nodeId);
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

    getSelectedNodes(): string[] {
        const cy = this.cy;
        return cy.$(':selected')
            .nodes()
            .filter((n: cytoscape.NodeSingular) => !n.data('isFloatingWindow'))
            .map((n: cytoscape.NodeSingular) => n.id());
    }

    fit(paddingPercentage = 3): void {
        const cy = this.cy;
        // Use responsive padding instead of fixed pixels (default was 50px on 1440p)
        cy.fit(undefined, getResponsivePadding(cy, paddingPercentage));
    }

    refreshLayout(): void {
        // Re-run the Cola layout algorithm
        const cy = this.cy;

        // Skip if no nodes
        if (cy.nodes().length === 0) {
            return;
        }

        // Use the same approach as autoLayout.ts
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ColaLayout = (cy as any).constructor.layouts.cola;
        const layout = new ColaLayout({
            cy: cy,
            eles: cy.elements(),
            animate: true,
            randomize: false,
            avoidOverlap: true,
            handleDisconnected: true,
            maxSimulationTime: 2000,
            nodeSpacing: 20,
            edgeLength: 200,
            fit: false,
            nodeDimensionsIncludeLabels: true
        });

        layout.run();
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
        const styleService = new StyleService();
        const newStyles = styleService.getCombinedStylesheet();
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
        const cy = this.cy;
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

        // Dispose managers
        this.hotkeyManager.dispose();
        this.floatingWindowManager.dispose();
        this.searchService.dispose();

        // Dispose menu services
        if (this.radialMenuService) {
            this.radialMenuService.destroy();
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
