/**
 * VoiceTreeGraphView - Main orchestrator for graph visualization
 *
 * This class is responsible for:
 * 1. Initializing and managing the Cytoscape.js graph instance
 * 2. Rendering and managing UI overlays (stats, loading, empty state)
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

import { Disposable } from './Disposable';
import { EventEmitter } from './EventEmitter';
import type {
  IVoiceTreeGraphView,
  VoiceTreeGraphViewOptions
} from './IVoiceTreeGraphView';
import cytoscape, { type Core, type CytoscapeOptions } from 'cytoscape';
import '@/graph-core'; // Import to trigger extension registration
import { StyleService } from '@/graph-core/services/StyleService';
import { BreathingAnimationService } from '@/graph-core/services/BreathingAnimationService';
import { ContextMenuService } from '@/graph-core/services/ContextMenuService';
import ColaLayout from '@/graph-core/graphviz/layout/cola';
import { FloatingWindowManager } from './FloatingWindowManager';
import { HotkeyManager } from './HotkeyManager';
import { SearchService } from './SearchService';
import { GraphNavigationService } from './GraphNavigationService';
import { getResponsivePadding } from '@/utils/responsivePadding';
import type { IMarkdownVaultProvider, Disposable as VaultDisposable } from '@/providers/IMarkdownVaultProvider';
import { SpeedDialMenuView } from './SpeedDialMenuView';
// TODO: Remove these unused imports after full migration to applyGraphDeltaToUI
// import { projectToCytoscape } from '@/functional_graph/pure/cytoscape/project-to-cytoscape';
// import { computeCytoscapeDiff } from '@/functional_graph/pure/cytoscape/compute-cytoscape-diff';
import type { Graph } from '@/functional_graph/pure/types';
import { MIN_ZOOM, MAX_ZOOM, GHOST_ROOT_ID } from '@/graph-core/constants';
import type { NodeDefinition } from '@/graph-core/types';
import { subscribeToGraphUpdates } from '@/functional_graph/shell/UI/subscribeToGraphUpdates';
import { setupBasicCytoscapeEventListeners, setupCytoscape } from './VoiceTreeGraphViewHelpers';

/**
 * Main VoiceTreeGraphView implementation
 */
export class VoiceTreeGraphView extends Disposable implements IVoiceTreeGraphView {
  // Core instances
  private cy!: Core; // Initialized in render() called from constructor
  private container: HTMLElement;
  private options: VoiceTreeGraphViewOptions;
  private vaultProvider: IMarkdownVaultProvider;

  // Services
  private styleService!: StyleService; // Initialized in render()
  private animationService!: BreathingAnimationService; // Initialized in render()
  private contextMenuService!: ContextMenuService; // Initialized in setupCytoscape()

  // Managers
  private floatingWindowManager: FloatingWindowManager;
  private hotkeyManager: HotkeyManager;
  private searchService: SearchService;
  private navigationService: GraphNavigationService;

  // State
  private _isDarkMode = false;
  private currentGraphState: Graph = { nodes: {} };

  // Vault event disposables
  private vaultDisposables: VaultDisposable[] = [];

  // Functional graph subscription cleanup
  private unsubscribeGraphUpdates: (() => void) | null = null;

  // DOM elements
  private statsOverlay: HTMLElement | null = null;
  private loadingOverlay: HTMLElement | null = null;
  private errorOverlay: HTMLElement | null = null;
  private emptyStateOverlay: HTMLElement | null = null;
  private speedDialMenu: SpeedDialMenuView | null = null;

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
    vaultProvider: IMarkdownVaultProvider,
    options: VoiceTreeGraphViewOptions = {}
  ) {
    super();
    this.container = container;
    this.vaultProvider = vaultProvider;
    this.options = options;

    // Initialize dark mode
    this.setupDarkMode();

    // Render DOM structure
    this.render();

    // Initialize managers (after cy is created in render())
    this.hotkeyManager = new HotkeyManager();
    this.floatingWindowManager = new FloatingWindowManager(
      this.cy,
      () => this.getCurrentGraphState(),
      () => this.vaultProvider.getWatchDirectory?.(),
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

    // FILE EVENT LISTENERS REMOVED - now handled by functional graph via subscribeToGraphUpdates

    // Setup command-hover mode
    // TEMP: Disabled to test if this is causing editor tap issues
    this.floatingWindowManager.setupCommandHover();

    // Subscribe to functional graph updates
    this.unsubscribeGraphUpdates = subscribeToGraphUpdates(this.cy);
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
    this.speedDialMenu = new SpeedDialMenuView(this.container, {
      onToggleDarkMode: () => this.toggleDarkMode(),
      onBackup: () => this.createBackupTerminal(),
      onSettings: () => console.log('[SpeedDial] Settings clicked'),
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

    // Add ghost root node as the first element to ensure it exists before any edges reference it
    const ghostRootNode: NodeDefinition = {
      data: {
        id: GHOST_ROOT_ID,
        label: '',
        linkedNodeIds: [],
        isGhostRoot: true
      },
      position: { x: 0, y: 0 }
    };

    // Initialize cytoscape with ghost root node
    const cytoscapeOptions: CytoscapeOptions = {
      elements: [ghostRootNode],
      style: this.styleService.getCombinedStylesheet(),
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      boxSelectionEnabled: true,
      container: this.container
    };

    this.cy = cytoscape(cytoscapeOptions);

    // Initialize animation service with cy instance (sets up event listeners)
    this.animationService = new BreathingAnimationService(this.cy);

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
    this.contextMenuService = setupCytoscape({
      cy: this.cy,
      savePositionsTimeout: { current: this.savePositionsTimeout },
      saveNodePositions: () => this.saveNodePositions(),
      onLayoutComplete: () => this.layoutCompleteEmitter.emit(),
      onNodeSelected: (nodeId) => this.nodeSelectedEmitter.emit(nodeId),
      getCurrentGraphState: () => this.getCurrentGraphState(),
      getVaultProvider: () => this.vaultProvider,
      floatingWindowManager: this.floatingWindowManager
    });
  }

  /**
   * Get current graph state for FloatingWindowManager
   */
  private getCurrentGraphState(): Graph {
    return this.currentGraphState;
  }

  /**
   * Save node positions to disk via IPC
   */
  private async saveNodePositions(): Promise<void> {
    try {
      // Get watch directory
      const watchStatus = await this.vaultProvider.getWatchStatus();
      if (!watchStatus.isWatching || !watchStatus.directory) {
        console.warn('[VoiceTreeGraphView] Not watching any directory');
        return;
      }

      const positions: Record<string, { x: number; y: number }> = {};

      // Collect positions from Cytoscape nodes
      this.cy.nodes().forEach((node) => {
        const nodeId = node.id();
        const isFloatingWindow = node.data('isFloatingWindow');
        const isGhost = nodeId.startsWith('ghost-');

        // Skip floating windows and ghost nodes
        if (isFloatingWindow || isGhost) {
          return;
        }

        // Use node ID as filename (assumes nodeId = filename without .md)
        const filename = `${nodeId}.md`;
        const pos = node.position();
        positions[filename] = { x: pos.x, y: pos.y };
      });

      console.log(`[VoiceTreeGraphView] Saving ${Object.keys(positions).length} node positions`);

      // Save to disk via vault provider
      const result = await this.vaultProvider.savePositions(
        watchStatus.directory,
        positions
      );

      if (result.success) {
        console.log(`[VoiceTreeGraphView] Successfully saved positions to disk`);
      } else {
        console.error('[VoiceTreeGraphView] Failed to save positions:', result.error);
      }
    } catch (error) {
      console.error('[VoiceTreeGraphView] Error saving positions:', error);
    }
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
      this.saveNodePositions();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Focus container to ensure it receives keyboard events
    this.container.focus();

    // Setup graph-specific hotkeys via HotkeyManager
    this.hotkeyManager.setupGraphHotkeys({
      fitToLastNode: () => this.navigationService.fitToLastNode(),
      cycleTerminal: (direction) => this.navigationService.cycleTerminal(direction)
    });

    // Register cmd-f for search
    this.hotkeyManager.registerHotkey({
      key: 'f',
      modifiers: ['Meta'],
      onPress: () => this.searchService.open()
    });

    // Prevent page scroll when zooming
    const handleWheel = (e: WheelEvent) => e.preventDefault();
    this.container.addEventListener('wheel', handleWheel, { passive: false });
  }
  private handleResizeMethod(): void {
    this.cy.resize();
    this.cy.fit();
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

  /**
   * Creates a floating terminal with pre-pasted backup command
   * Command: mkdir -p "{watchDir}/../backups" && mv "{watchDir}" "{watchDir}/../backups/"
   */
  createBackupTerminal(): void {
    // Get watch directory from vault provider
    const watchDir = this.vaultProvider.getWatchDirectory?.();

    if (!watchDir) {
      console.warn('[backup] No watched directory available');
      return;
    }

    // Generate the move command with mkdir to ensure backups directory exists
    const backupCommand = `mkdir -p "${watchDir}/../backups" && mv "${watchDir}" "${watchDir}/../backups/"`;

    // Create metadata for terminal with pre-pasted command
    const terminalMetadata = {
      id: 'backup-terminal',
      name: 'Backup Terminal',
      initialCommand: backupCommand,
    };

    // Get position in center of current viewport (where user is looking)
    const cy = this.cy;
    const pan = cy.pan();
    const zoom = cy.zoom();
    const centerX = (cy.width() / 2 - pan.x) / zoom;
    const centerY = (cy.height() / 2 - pan.y) / zoom;

    // Create floating terminal with pre-pasted command
    this.floatingWindowManager.createFloatingTerminal(
      'backup',
      terminalMetadata,
      { x: centerX, y: centerY }
    );

    // Fit the graph to include the newly spawned terminal
    setTimeout(() => {
      const terminalNode = cy.$('#terminal-backup');
      if (terminalNode.length > 0) {
        cy.fit(terminalNode, 50); // 50px padding
      }
    }, 50);

    setTimeout(() => {
      const terminalNode = cy.$('#terminal-backup');
      if (terminalNode.length > 0) {
        cy.fit(terminalNode, 50); // 50px padding
      }
    }, 800); // also after auto layout
  }

  refreshLayout(): void {
    const cy = this.cy;

    // Skip if no nodes
    if (cy.nodes().length === 0) {
      return;
    }

    // Directly instantiate ColaLayout (not registered with cytoscape.use())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layout = new (ColaLayout as any)({
      cy: cy,
      eles: cy.elements(),
      animate: true,
      animationDuration: 300,
      randomize: false,
      avoidOverlap: true,
      handleDisconnected: true,
      convergenceThreshold: 1,
      maxSimulationTime: 3000,
      unconstrIter: 3,
      userConstIter: 50,
      allConstIter: 30,
      nodeSpacing: 30,
      edgeLength: 200,
      centerGraph: false,
      fit: false,
      nodeDimensionsIncludeLabels: true
    });

    layout.run();
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

    // Unsubscribe from functional graph updates
    if (this.unsubscribeGraphUpdates) {
      this.unsubscribeGraphUpdates();
      this.unsubscribeGraphUpdates = null;
    }

    // Dispose vault event listeners
    this.vaultDisposables.forEach(disposable => disposable.dispose());
    this.vaultDisposables = [];

    // Dispose managers
    this.hotkeyManager.dispose();
    this.floatingWindowManager.dispose();
    this.searchService.dispose();

    // Dispose services
    if (this.contextMenuService) {
      this.contextMenuService.destroy();
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
