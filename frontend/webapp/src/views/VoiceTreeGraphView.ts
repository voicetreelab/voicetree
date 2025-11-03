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
 * - FileEventManager: File operations, parsing, caching, position management
 * - FloatingWindowManager: Editor/terminal windows, context menu, command-hover
 * - GraphNavigationService: User-triggered navigation actions (fit, cycle, search)
 * - HotkeyManager: Keyboard shortcut handling
 * - SearchService: Command palette integration
 */

import { Disposable } from './Disposable';
import { EventEmitter } from './EventEmitter';
import type {
  IVoiceTreeGraphView,
  FileEvent,
  BulkFileEvent,
  WatchingStartedEvent,
  VoiceTreeGraphViewOptions
} from './IVoiceTreeGraphView';
import { CytoscapeCore } from '@/graph-core'; // Import from index.ts to trigger extension registration
import { StyleService } from '@/graph-core/services/StyleService';
import { enableAutoLayout } from '@/graph-core/graphviz/layout/autoLayout';
import ColaLayout from '@/graph-core/graphviz/layout/cola';
import { FileEventManager } from './FileEventManager';
import { FloatingWindowManager } from './FloatingWindowManager';
import { HotkeyManager } from './HotkeyManager';
import { SearchService } from './SearchService';
import { GraphNavigationService } from './GraphNavigationService';
import { getResponsivePadding } from '@/utils/responsivePadding';
import type { IMarkdownVaultProvider, Disposable as VaultDisposable } from '@/providers/IMarkdownVaultProvider';
import { SpeedDialMenuView } from './SpeedDialMenuView';

/**
 * Main VoiceTreeGraphView implementation
 */
export class VoiceTreeGraphView extends Disposable implements IVoiceTreeGraphView {
  // Core instances
  private cy!: CytoscapeCore; // Initialized in render() called from constructor
  private container: HTMLElement;
  private options: VoiceTreeGraphViewOptions;
  private vaultProvider: IMarkdownVaultProvider;

  // Managers
  private fileEventManager: FileEventManager;
  private floatingWindowManager: FloatingWindowManager;
  private hotkeyManager: HotkeyManager;
  private searchService: SearchService;
  private navigationService: GraphNavigationService;

  // State
  private _isDarkMode = false;

  // Vault event disposables
  private vaultDisposables: VaultDisposable[] = [];

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
    this.fileEventManager = new FileEventManager(
      this.cy,
      this.vaultProvider,
      (stats) => this.handleStatsChanged(stats)
    );
    this.hotkeyManager = new HotkeyManager();
    this.floatingWindowManager = new FloatingWindowManager(
      this.cy,
      this.fileEventManager,
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

    // Setup file event listeners
    this.setupFileListeners();

    // Setup command-hover mode
    // TEMP: Disabled to test if this is causing editor tap issues
    this.floatingWindowManager.setupCommandHover();
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
    const headless = this.options.headless || false;
    this.cy = new CytoscapeCore(this.container, [], headless);

    // Update opacity after Cytoscape is ready
    this.container.style.opacity = '1';
  }

  private setupCytoscape(): void {
    const core = this.cy.getCore();

    // Enable auto-layout
    enableAutoLayout(core);
    console.log('[VoiceTreeGraphView] Auto-layout enabled with Cola');

    // Listen to layout completion
    core.on('layoutstop', () => {
      console.log('[VoiceTreeGraphView] Layout stopped, saving positions...');
      this.fileEventManager.saveNodePositions();
      this.layoutCompleteEmitter.emit();
    });

    // Save positions when user finishes dragging nodes
    core.on('free', 'node', () => {
      console.log('[VoiceTreeGraphView] Node drag ended, saving positions...');
      // Debounce to avoid too many saves
      if (this.savePositionsTimeout) {
        clearTimeout(this.savePositionsTimeout);
      }
      this.savePositionsTimeout = setTimeout(() => {
        this.fileEventManager.saveNodePositions();
      }, 1000); // Wait 1 second after last drag
    });

    // Setup tap handler for nodes (skip in headless mode)
    if (!this.options.headless) {
      console.log('[VoiceTreeGraphView] Registering tap handler for floating windows');
      core.on('tap', 'node', (event) => {
        const nodeId = event.target.id();
        console.log('[VoiceTreeGraphView] Node tapped:', nodeId);

        // Emit node selected event
        this.nodeSelectedEmitter.emit(nodeId);

        // Find file and open editor
        const content = this.fileEventManager.getContentForNode(nodeId);
        const filePath = this.fileEventManager.getFilePathForNode(nodeId);

        console.log('[VoiceTreeGraphView] Found content?', !!content, 'filePath?', !!filePath);

        if (content && filePath) {
          const nodePos = event.target.position();
          console.log('[VoiceTreeGraphView] Calling createFloatingEditor');
          this.floatingWindowManager.createFloatingEditor(nodeId, filePath, content, nodePos);
        } else {
          console.log('[VoiceTreeGraphView] Not opening editor - missing requirements');
        }
      });

      // Setup context menu (requires DOM)
      this.floatingWindowManager.setupContextMenu();
    }

    // Expose for testing
    if (typeof window !== 'undefined') {
      (window as any).cytoscapeInstance = core;
      (window as any).cytoscapeCore = this.cy;

      // Expose test markdown_parsing for e2e tests
      (window as any).testHelpers = {
        createTerminal: (nodeId: string) => {
          const filePath = this.fileEventManager.getFilePathForNode(nodeId);
          const nodeMetadata = {
            id: nodeId,
            name: nodeId.replace(/_/g, ' '),
            filePath: filePath
          };

          const node = core.getElementById(nodeId);
          if (node.length > 0) {
            const nodePos = node.position();
            this.floatingWindowManager.createFloatingTerminal(nodeId, nodeMetadata, nodePos);
          }
        },
        addNodeAtPosition: async (position: { x: number; y: number }) => {
          // For testing: directly invoke the context menu handler
          const contextMenu = (core as any).contextMenus;
          if (contextMenu?._config?.onAddNodeAtPosition) {
            await contextMenu._config.onAddNodeAtPosition(position);
          } else {
            console.error('[TestHelpers] onAddNodeAtPosition handler not found');
          }
        },
        getEditorInstance: undefined // Will be set below
      };

      // Import and expose getVanillaInstance for testing
      import('@/graph-core/extensions/cytoscape-floating-windows').then(({ getVanillaInstance }) => {
        if ((window as any).testHelpers) {
          (window as any).testHelpers.getEditorInstance = (windowId: string) => {
            return getVanillaInstance(windowId);
          };
        }
      });
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
      this.fileEventManager.saveNodePositions();
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

  private setupFileListeners(): void {
    // Subscribe to all file watcher events via vault provider
    this.vaultDisposables.push(
      this.vaultProvider.onFilesLoaded((files) => {
        this.handleBulkFilesAdded({ files });
      })
    );

    this.vaultDisposables.push(
      this.vaultProvider.onFileAdded((file) => {
        this.handleFileAdded(file);
      })
    );

    this.vaultDisposables.push(
      this.vaultProvider.onFileChanged((file) => {
        this.handleFileChanged(file);
      })
    );

    this.vaultDisposables.push(
      this.vaultProvider.onFileDeleted((fullPath) => {
        this.handleFileDeleted({ fullPath });
      })
    );

    this.vaultDisposables.push(
      this.vaultProvider.onWatchingStopped(() => {
        this.handleWatchingStopped();
      })
    );

    this.vaultDisposables.push(
      this.vaultProvider.onWatchingStarted((event) => {
        this.handleWatchingStarted({
          directory: event.directory,
          positions: event.positions
        });
      })
    );
  }

  // ============================================================================
  // FILE EVENT HANDLERS (delegate to FileEventManager)
  // ============================================================================

  private handleBulkFilesAdded(data: BulkFileEvent): void {
    this.fileEventManager.handleBulkFilesAdded(data);
    this.searchService.updateSearchData();
  }

  private handleFileAdded(data: FileEvent): void {
    this.fileEventManager.handleFileAdded(data);
    // Track last created node for "fit to last node" feature
    const nodeId = data.fullPath.replace(/\.md$/i, '').split('/').pop();
    if (nodeId) {
      this.navigationService.setLastCreatedNodeId(nodeId);
    }
    this.searchService.updateSearchData();
  }

  private handleFileChanged(data: FileEvent): void {
    this.fileEventManager.handleFileChanged(data);
    this.searchService.updateSearchData();
  }

  private handleFileDeleted(data: { fullPath: string }): void {
    this.fileEventManager.handleFileDeleted(data);
    this.searchService.updateSearchData();
  }

  private handleWatchingStopped(): void {
    this.fileEventManager.handleWatchingStopped();
  }

  private handleWatchingStarted(data: WatchingStartedEvent): void {
    this.fileEventManager.handleWatchingStarted(data);
  }


  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private handleStatsChanged(stats: { nodeCount: number; edgeCount: number }): void {
    // Update UI overlays
    if (this.statsOverlay) {
      this.statsOverlay.textContent = `${stats.nodeCount} nodes • ${stats.edgeCount} edges`;
      this.statsOverlay.style.display = stats.nodeCount > 0 ? 'block' : 'none';
    }

    if (this.emptyStateOverlay) {
      this.emptyStateOverlay.style.display = stats.nodeCount === 0 ? 'flex' : 'none';
    }
  }

  private handleResizeMethod(): void {
    const core = this.cy.getCore();
    core.resize();
    core.fit();
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  focusNode(nodeId: string): void {
    const cy = this.cy.getCore();
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
    const cy = this.cy.getCore();
    return cy.$(':selected')
      .nodes()
      .filter((n: any) => !n.data('isFloatingWindow'))
      .map((n: any) => n.id());
  }

  refreshLayout(): void {
    const cy = this.cy.getCore();

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

  fit(paddingPercentage = 3): void {
    const cy = this.cy.getCore();
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
    this.cy.getCore().style(newStyles);

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
    return this.fileEventManager.getStats();
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
    const cy = this.cy.getCore();
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
    return this.edgeSelectedEmitter.on(callback);
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

    // Dispose vault event listeners
    this.vaultDisposables.forEach(disposable => disposable.dispose());
    this.vaultDisposables = [];

    // Dispose managers
    this.hotkeyManager.dispose();
    this.fileEventManager.dispose();
    this.floatingWindowManager.dispose();
    this.searchService.dispose();

    // Dispose speed dial menu
    if (this.speedDialMenu) {
      this.speedDialMenu.dispose();
      this.speedDialMenu = null;
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
