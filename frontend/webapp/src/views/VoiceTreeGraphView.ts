/**
 * VoiceTreeGraphView - Vanilla TypeScript implementation of graph visualization
 *
 * Converts React component to class-based OOP pattern:
 * - useState → class properties
 * - useEffect → constructor + setupEventListeners()
 * - useCallback → regular methods
 * - useRef → direct properties
 *
 * This class is responsible for:
 * 1. Rendering and managing the Cytoscape.js graph visualization
 * 2. Handling file watcher events and updating the graph
 * 3. Managing floating windows (editors, terminals)
 * 4. Providing context menu interactions
 * 5. Managing dark mode and themes
 * 6. Saving and loading node positions
 */

import { Disposable } from './Disposable';
import { EventEmitter } from './EventEmitter';
import type {
  IVoiceTreeGraphView,
  FileEvent,
  BulkFileEvent,
  WatchingStartedEvent,
  Position,
  VoiceTreeGraphViewOptions
} from './IVoiceTreeGraphView';
import { CytoscapeCore, AnimationType } from '@/graph-core/graphviz/CytoscapeCore';
import { GraphMutator } from '@/graph-core/mutation/GraphMutator';
import { StyleService } from '@/graph-core/services/StyleService';
import { parseForCytoscape } from '@/graph-core/data/load_markdown/MarkdownParser';
import { enableAutoLayout } from '@/graph-core/graphviz/layout/autoLayout';
import type { NodeSingular } from 'cytoscape';

// Helper function to normalize file ID
// 'concepts/introduction.md' -> 'introduction'
function normalizeFileId(filename: string): string {
  let id = filename.replace(/\.md$/i, '');
  const lastSlash = id.lastIndexOf('/');
  if (lastSlash >= 0) {
    id = id.substring(lastSlash + 1);
  }
  return id;
}

/**
 * Main VoiceTreeGraphView implementation
 */
export class VoiceTreeGraphView extends Disposable implements IVoiceTreeGraphView {
  // Core instances
  private cy: CytoscapeCore;
  private container: HTMLElement;
  private options: VoiceTreeGraphViewOptions;

  // Data storage
  private markdownFiles = new Map<string, string>();
  private savedPositions: Record<string, Position> = {};

  // State
  private nodeCount = 0;
  private edgeCount = 0;
  private isInitialLoad = true;
  private _isDarkMode = false;
  private currentTerminalIndex = 0;

  // DOM elements
  private statsOverlay: HTMLElement | null = null;
  private loadingOverlay: HTMLElement | null = null;
  private errorOverlay: HTMLElement | null = null;
  private emptyStateOverlay: HTMLElement | null = null;

  // Event emitters
  private nodeSelectedEmitter = new EventEmitter<string>();
  private nodeDoubleClickEmitter = new EventEmitter<string>();
  private edgeSelectedEmitter = new EventEmitter<{ source: string; target: string }>();
  private layoutCompleteEmitter = new EventEmitter<void>();

  // Bound event handlers for cleanup
  private handleResize!: () => void;
  private handleKeyDown!: (e: KeyboardEvent) => void;

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

    // Initialize Cytoscape
    this.setupCytoscape();

    // Setup event listeners
    this.setupEventListeners();

    // Setup file event listeners
    this.setupFileListeners();
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
    this.container.className = 'h-full bg-background overflow-hidden relative';

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
      this.saveNodePositions();
      this.layoutCompleteEmitter.emit();
    });

    // Setup tap handler for nodes (skip in headless mode)
    if (!this.options.headless) {
      core.on('tap', 'node', (event) => {
        const nodeId = event.target.id();
        console.log('[VoiceTreeGraphView] Node tapped:', nodeId);

        // Emit node selected event
        this.nodeSelectedEmitter.emit(nodeId);

        // Find file and open editor
        const content = this.getContentForNode(nodeId);
        const filePath = this.getFilePathForNode(nodeId);

        if (content && filePath) {
          const nodePos = event.target.position();
          this.createFloatingEditor(nodeId, filePath, content, nodePos);
        }
      });

      // Setup context menu (requires DOM)
      this.setupContextMenu();
    }

    // Expose for testing
    if (typeof window !== 'undefined') {
      (window as any).cytoscapeInstance = core;
      (window as any).cytoscapeCore = this.cy;
    }
  }

  private setupContextMenu(): void {
    this.cy.enableContextMenu({
      onOpenEditor: (nodeId: string) => {
        const content = this.getContentForNode(nodeId);
        const filePath = this.getFilePathForNode(nodeId);

        if (content && filePath) {
          const node = this.cy.getCore().getElementById(nodeId);
          if (node.length > 0) {
            const pos = node.position();
            this.createFloatingEditor(nodeId, filePath, content, pos);
          }
        }
      },
      onExpandNode: (node: NodeSingular) => {
        const nodeId = node.id();
        console.log('[VoiceTreeGraphView] Expanding node:', nodeId);
        this.createNewChildNode(nodeId);
      },
      onDeleteNode: async (node: NodeSingular) => {
        const nodeId = node.id();
        const filePath = this.getFilePathForNode(nodeId);

        if (filePath && (window as any).electronAPI?.deleteFile) {
          if (!confirm(`Are you sure you want to delete "${nodeId}"? This will move the file to trash.`)) {
            return;
          }

          try {
            const result = await (window as any).electronAPI.deleteFile(filePath);
            if (result.success) {
              this.markdownFiles.delete(filePath);
              this.cy.hideNode(node);
              this.updateCounts();
              this.updateStatsDisplay();
            } else {
              console.error('[VoiceTreeGraphView] Failed to delete file:', result.error);
              alert(`Failed to delete file: ${result.error}`);
            }
          } catch (error) {
            console.error('[VoiceTreeGraphView] Error deleting file:', error);
            alert(`Error deleting file: ${error}`);
          }
        }
      },
      onOpenTerminal: (nodeId: string) => {
        const filePath = this.getFilePathForNode(nodeId);
        const nodeMetadata = {
          id: nodeId,
          name: nodeId.replace(/_/g, ' '),
          filePath: filePath
        };

        const node = this.cy.getCore().getElementById(nodeId);
        if (node.length > 0) {
          const nodePos = node.position();
          this.createFloatingTerminal(nodeId, nodeMetadata, nodePos);
        }
      },
      onCopyNodeName: (nodeId: string) => {
        const absolutePath = this.getFilePathForNode(nodeId);
        navigator.clipboard.writeText(absolutePath || nodeId);
      },
      onAddNodeAtPosition: async (position: Position) => {
        console.log('[VoiceTreeGraphView] Creating node at position:', position);
        await this.handleAddNodeAtPosition(position);
      }
    });
  }

  private setupEventListeners(): void {
    // Bind handlers
    this.handleResize = this.handleResizeMethod.bind(this);
    this.handleKeyDown = this.handleKeyDownMethod.bind(this);

    // Window resize
    window.addEventListener('resize', this.handleResize);

    // Keyboard shortcuts
    this.container.addEventListener('keydown', this.handleKeyDown);

    // Prevent page scroll when zooming
    const handleWheel = (e: WheelEvent) => e.preventDefault();
    this.container.addEventListener('wheel', handleWheel, { passive: false });
  }

  private setupFileListeners(): void {
    // Subscribe to all file watcher events via window.electronAPI
    if (!window.electronAPI) {
      console.warn('[VoiceTreeGraphView] electronAPI not available');
      return;
    }

    window.electronAPI.onInitialFilesLoaded((data) => {
      this.handleBulkFilesAdded({ files: data.files });
    });
    window.electronAPI.onFileAdded(this.handleFileAdded.bind(this));
    window.electronAPI.onFileChanged(this.handleFileChanged.bind(this));
    window.electronAPI.onFileDeleted((data) => {
      this.handleFileDeleted({ fullPath: data.fullPath });
    });
    window.electronAPI.onFileWatchingStopped(this.handleWatchingStopped.bind(this));

    if (window.electronAPI.onWatchingStarted) {
      window.electronAPI.onWatchingStarted((data) => {
        this.handleWatchingStarted({ directory: data.directory });
      });
    }
  }

  // ============================================================================
  // FILE EVENT HANDLERS
  // ============================================================================

  private handleBulkFilesAdded(data: BulkFileEvent): void {
    console.log('[VoiceTreeGraphView] Handling bulk files added:', data.files.length);

    const cy = this.cy.getCore();
    const mutator = new GraphMutator(cy, null);

    // Clear existing elements (except ghost root)
    cy.elements().not('[isGhostRoot]').remove();

    // Process all files
    for (const file of data.files) {
      const nodeId = normalizeFileId(file.fullPath);
      const parsed = parseForCytoscape(file.content, nodeId);

      // Create node
      mutator.addNode({ nodeId, label: parsed.label, linkedNodeIds: parsed.linkedNodeIds });

      // Apply saved position if available
      const savedPos = this.savedPositions[file.fullPath];
      if (savedPos) {
        const node = cy.getElementById(nodeId);
        if (node.length > 0) {
          node.position(savedPos);
        }
      }

      // Cache content
      this.markdownFiles.set(file.fullPath, file.content);
    }

    // Update counts
    this.updateCounts();

    // Trigger layout
    cy.layout({
      name: 'cola',
      animate: true,
      animationDuration: 300
    }).run();

    // Set initial load complete
    this.isInitialLoad = false;

    // Fit graph after layout completes
    setTimeout(() => {
      cy.fit(undefined, 50);
    }, 750);

    // Update UI
    this.updateStatsDisplay();
  }

  private handleFileAdded(data: FileEvent): void {
    console.log('[VoiceTreeGraphView] Handling file added:', data.fullPath);

    const nodeId = normalizeFileId(data.fullPath);
    const cy = this.cy.getCore();

    // Check if node already exists
    if (cy.getElementById(nodeId).length > 0) {
      console.log('[VoiceTreeGraphView] Node already exists, skipping');
      return;
    }

    // Check for saved position (from right-click creation or previous session)
    const filename = data.fullPath.split('/').pop() || data.fullPath;
    const savedPos = this.savedPositions[filename];

    // Parse and add node
    const parsed = parseForCytoscape(data.content, nodeId);
    const mutator = new GraphMutator(cy, null);
    mutator.addNode({
      nodeId,
      label: parsed.label,
      linkedNodeIds: parsed.linkedNodeIds,
      explicitPosition: savedPos
    });

    // Only trigger layout if no saved position exists
    if (!savedPos && !this.isInitialLoad) {
      // Trigger incremental layout
      cy.layout({
        name: 'cola',
        animate: true,
        animationDuration: 300
      }).run();
    }

    // Cache content
    this.markdownFiles.set(data.fullPath, data.content);

    // Update counts and UI
    this.updateCounts();
    this.updateStatsDisplay();
  }

  private handleFileChanged(data: FileEvent): void {
    console.log('[VoiceTreeGraphView] Handling file changed:', data.fullPath);

    const nodeId = normalizeFileId(data.fullPath);
    const cy = this.cy.getCore();
    const node = cy.getElementById(nodeId);

    // If node doesn't exist, treat as add
    if (node.length === 0) {
      this.handleFileAdded(data);
      return;
    }

    // Parse new content
    const parsed = parseForCytoscape(data.content, nodeId);

    // Update node label
    node.data('label', parsed.label);

    // Update edges
    const mutator = new GraphMutator(cy, null);
    // Remove old edges
    node.connectedEdges().remove();
    // Add new edges
    mutator.addNode({ nodeId, label: parsed.label, linkedNodeIds: parsed.linkedNodeIds });

    // Trigger breathing animation
    const animationService = (this.cy as any).animationService;
    if (animationService) {
      animationService.startAnimation(node, AnimationType.CONTENT_APPEND);
    }

    // Update content cache
    this.markdownFiles.set(data.fullPath, data.content);

    // Update counts and UI
    this.updateCounts();
    this.updateStatsDisplay();
  }

  private handleFileDeleted(data: { fullPath: string }): void {
    console.log('[VoiceTreeGraphView] Handling file deleted:', data.fullPath);

    const nodeId = normalizeFileId(data.fullPath);
    const cy = this.cy.getCore();
    const mutator = new GraphMutator(cy, null);

    // Remove node (mutator handles edge cleanup)
    mutator.removeNode(nodeId);

    // Remove from cache
    this.markdownFiles.delete(data.fullPath);

    // Update counts and UI
    this.updateCounts();
    this.updateStatsDisplay();
  }

  private handleWatchingStopped(): void {
    console.log('[VoiceTreeGraphView] Handling watching stopped');

    const cy = this.cy.getCore();

    // Clear graph
    cy.elements().not('[isGhostRoot]').remove();

    // Clear caches
    this.markdownFiles.clear();
    this.savedPositions = {};

    // Reset state
    this.nodeCount = 0;
    this.edgeCount = 0;
    this.isInitialLoad = true;

    // Update UI
    this.updateStatsDisplay();
  }

  private handleWatchingStarted(data: WatchingStartedEvent): void {
    console.log('[VoiceTreeGraphView] Handling watching started:', data.directory);

    // Store saved positions
    if (data.positions) {
      this.savedPositions = data.positions;
    }

    // Reset state
    this.isInitialLoad = true;
  }

  // ============================================================================
  // CONTEXT MENU HANDLERS
  // ============================================================================

  private createFloatingEditor(
    nodeId: string,
    filePath: string,
    content: string,
    nodePos: Position
  ): void {
    const editorId = `editor-${nodeId}`;
    console.log('[VoiceTreeGraphView] Creating floating editor:', editorId);

    // Check if already exists
    const existing = this.cy.getCore().nodes(`#${editorId}`);
    if (existing && existing.length > 0) {
      console.log('[VoiceTreeGraphView] Editor already exists');
      return;
    }

    try {
      this.cy.addFloatingWindow({
        id: editorId,
        component: 'MarkdownEditor',
        title: `Editor: ${nodeId}`,
        position: {
          x: nodePos.x,
          y: nodePos.y + 50
        },
        nodeData: {
          isFloatingWindow: true,
          isShadowNode: true,
          parentNodeId: nodeId,
          laidOut: false
        },
        resizable: true,
        initialContent: content,
        onSave: async (newContent: string) => {
          console.log('[VoiceTreeGraphView] Saving editor content');
          if ((window as any).electronAPI?.saveFileContent) {
            const result = await (window as any).electronAPI.saveFileContent(filePath, newContent);
            if (!result.success) {
              throw new Error(result.error || 'Failed to save file');
            }
          } else {
            throw new Error('Save functionality not available');
          }
        }
      });
    } catch (error) {
      console.error('[VoiceTreeGraphView] Error creating floating editor:', error);
    }
  }

  private createFloatingTerminal(
    nodeId: string,
    nodeMetadata: { id: string; name: string; filePath?: string },
    nodePos: Position
  ): void {
    const terminalId = `terminal-${nodeId}`;
    console.log('[VoiceTreeGraphView] Creating floating terminal:', terminalId);

    // Check if already exists
    const existing = this.cy.getCore().nodes(`#${terminalId}`);
    if (existing && existing.length > 0) {
      console.log('[VoiceTreeGraphView] Terminal already exists');
      return;
    }

    // Check if parent node exists
    const parentNodeExists = this.cy.getCore().getElementById(nodeId).length > 0;

    const nodeData: Record<string, unknown> = {
      isFloatingWindow: true,
      isShadowNode: true,
      laidOut: false
    };

    if (parentNodeExists) {
      nodeData.parentNodeId = nodeId;
    }

    try {
      this.cy.addFloatingWindow({
        id: terminalId,
        component: 'Terminal',
        title: `Terminal: ${nodeId}`,
        position: {
          x: nodePos.x + 100,
          y: nodePos.y
        },
        nodeData,
        resizable: true,
        nodeMetadata: nodeMetadata
      });
    } catch (error) {
      console.error('[VoiceTreeGraphView] Error creating floating terminal:', error);
    }
  }

  private async createNewChildNode(parentNodeId: string): Promise<void> {
    try {
      if (!(window as any).electronAPI?.createChildNode) {
        console.error('[VoiceTreeGraphView] Electron API not available');
        return;
      }

      const result = await (window as any).electronAPI.createChildNode(parentNodeId);
      if (result.success) {
        console.log('[VoiceTreeGraphView] Successfully created child node:', result.nodeId);
      } else {
        console.error('[VoiceTreeGraphView] Failed to create child node:', result.error);
      }
    } catch (error) {
      console.error('[VoiceTreeGraphView] Error creating child node:', error);
    }
  }

  private async handleAddNodeAtPosition(position: Position): Promise<void> {
    try {
      if (!(window as any).electronAPI?.createStandaloneNode) {
        console.error('[VoiceTreeGraphView] Electron API not available');
        return;
      }

      // Pass position directly to Electron - it will save it immediately
      const result = await (window as any).electronAPI.createStandaloneNode(position);
      if (result.success && result.nodeId && result.filePath) {
        console.log('[VoiceTreeGraphView] Successfully created standalone node:', result.nodeId);

        // Store position in local cache so handleFileAdded can use it
        const filename = result.filePath.split('/').pop() || result.filePath;
        this.savedPositions[filename] = position;

        const newNodeId = normalizeFileId(result.filePath);

        // Wait for node to be added by file watcher
        const waitForNode = (attempts = 0, maxAttempts = 100): void => {
          if (!this.cy) return;

          const cy = this.cy.getCore();
          const node = cy.getElementById(newNodeId);

          if (node.length > 0) {
            // Node found, open editor
            const content = `---
node_id: ${result.nodeId}
title: New Node (${result.nodeId})
---
### New Node

Edit this node to add content.
`;
            this.createFloatingEditor(newNodeId, result.filePath!, content, position);
          } else if (attempts < maxAttempts) {
            setTimeout(() => waitForNode(attempts + 1, maxAttempts), 100);
          } else {
            console.error('[VoiceTreeGraphView] Timeout waiting for node');
          }
        };

        waitForNode();
      } else {
        console.error('[VoiceTreeGraphView] Failed to create standalone node:', result.error);
      }
    } catch (error) {
      console.error('[VoiceTreeGraphView] Error creating standalone node:', error);
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private getContentForNode(nodeId: string): string | undefined {
    for (const [path, content] of this.markdownFiles) {
      if (normalizeFileId(path) === nodeId) {
        return content;
      }
    }
    return undefined;
  }

  private getFilePathForNode(nodeId: string): string | undefined {
    for (const [path] of this.markdownFiles) {
      if (normalizeFileId(path) === nodeId) {
        return path;
      }
    }
    return undefined;
  }

  private async saveNodePositions(): Promise<void> {
    try {
      if (!(window as any).electronAPI?.positions) {
        return;
      }

      // Get watch directory
      const watchStatus = await (window as any).electronAPI.getWatchStatus();
      if (!watchStatus.isWatching || !watchStatus.directory) {
        return;
      }

      const cy = this.cy.getCore();
      const positions: Record<string, Position> = {};

      // Collect positions
      cy.nodes().forEach((node: any) => {
        const nodeId = node.id();
        const isFloatingWindow = node.data('isFloatingWindow');
        const isGhostRoot = node.data('isGhostRoot');

        if (isFloatingWindow || isGhostRoot) {
          return;
        }

        const filename = this.getFilePathForNode(nodeId);
        if (filename) {
          const pos = node.position();
          positions[filename] = { x: pos.x, y: pos.y };
        }
      });

      // Save to disk
      const result = await (window as any).electronAPI.positions.save(
        watchStatus.directory,
        positions
      );
      if (result.success) {
        console.log(`[VoiceTreeGraphView] Saved ${Object.keys(positions).length} positions`);
      } else {
        console.error('[VoiceTreeGraphView] Failed to save positions:', result.error);
      }
    } catch (error) {
      console.error('[VoiceTreeGraphView] Error saving positions:', error);
    }
  }

  private updateCounts(): void {
    const cy = this.cy.getCore();
    // Count non-ghost, non-floating nodes and edges
    this.nodeCount = cy.nodes().filter(
      (n: any) => !n.data('isGhostRoot') && !n.data('isFloatingWindow')
    ).length;
    this.edgeCount = cy.edges().filter(
      (e: any) => !e.data('isGhostEdge')
    ).length;
  }

  private updateStatsDisplay(): void {
    if (this.statsOverlay) {
      this.statsOverlay.textContent = `${this.nodeCount} nodes • ${this.edgeCount} edges`;
      this.statsOverlay.style.display = this.nodeCount > 0 ? 'block' : 'none';
    }

    if (this.emptyStateOverlay) {
      this.emptyStateOverlay.style.display = this.nodeCount === 0 ? 'flex' : 'none';
    }
  }

  private handleResizeMethod(): void {
    const core = this.cy.getCore();
    core.resize();
    core.fit();
  }

  private handleKeyDownMethod(e: KeyboardEvent): void {
    // Command/Ctrl + [ or ] to cycle between terminals
    if ((e.metaKey || e.ctrlKey) && (e.key === '[' || e.key === ']')) {
      e.preventDefault();

      const cy = this.cy.getCore();
      const terminalNodes = cy.nodes().filter(
        (node: any) =>
          node.data('id')?.startsWith('terminal-') &&
          node.data('isShadowNode') === true
      );

      if (terminalNodes.length === 0) {
        return;
      }

      // Sort terminals
      const sortedTerminals = terminalNodes.toArray().sort((a: any, b: any) =>
        a.id().localeCompare(b.id())
      );

      // Calculate next/previous index
      if (e.key === ']') {
        this.currentTerminalIndex = (this.currentTerminalIndex + 1) % sortedTerminals.length;
      } else {
        this.currentTerminalIndex =
          (this.currentTerminalIndex - 1 + sortedTerminals.length) % sortedTerminals.length;
      }

      // Fit to terminal
      const targetTerminal = sortedTerminals[this.currentTerminalIndex];
      cy.fit(targetTerminal, 600);
    }
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
    cy.layout({
      name: 'cola',
      animate: true,
      animationDuration: 300
    }).run();
  }

  fit(padding = 50): void {
    const cy = this.cy.getCore();
    cy.fit(undefined, padding);
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
  }

  isDarkMode(): boolean {
    return this._isDarkMode;
  }

  getStats(): { nodeCount: number; edgeCount: number } {
    return {
      nodeCount: this.nodeCount,
      edgeCount: this.edgeCount
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
    this.container.removeEventListener('keydown', this.handleKeyDown);

    // Remove electron API listeners
    if (window.electronAPI) {
      window.electronAPI.removeAllListeners('initial-files-loaded');
      window.electronAPI.removeAllListeners('file-added');
      window.electronAPI.removeAllListeners('file-changed');
      window.electronAPI.removeAllListeners('file-deleted');
      window.electronAPI.removeAllListeners('file-watching-stopped');
      window.electronAPI.removeAllListeners('watching-started');
    }

    // Destroy Cytoscape
    this.cy.destroy();

    // Clear maps
    this.markdownFiles.clear();
    this.savedPositions = {};

    // Clear event emitters
    this.nodeSelectedEmitter.clear();
    this.nodeDoubleClickEmitter.clear();
    this.edgeSelectedEmitter.clear();
    this.layoutCompleteEmitter.clear();

    // Call parent dispose
    super.dispose();
  }
}
