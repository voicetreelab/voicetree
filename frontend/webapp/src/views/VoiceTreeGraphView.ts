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
import { CytoscapeCore, AnimationType } from '@/graph-core'; // Import from index.ts to trigger extension registration
import { GraphMutator } from '@/graph-core/mutation/GraphMutator';
import { StyleService } from '@/graph-core/services/StyleService';
import { parseForCytoscape } from '@/graph-core/data/load_markdown/MarkdownParser';
import { enableAutoLayout } from '@/graph-core/graphviz/layout/autoLayout';
import ColaLayout from '@/graph-core/graphviz/layout/cola';
import type { NodeSingular } from 'cytoscape';
import { createWindowChrome, getOrCreateOverlay, mountComponent } from '@/graph-core/extensions/cytoscape-floating-windows';

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
  private lastCreatedNodeId: string | null = null;

  // Command-hover mode state
  private commandKeyHeld = false;
  private currentHoverEditor: HTMLElement | null = null;

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

    // Setup command-hover mode
    // TEMP: Disabled to test if this is causing editor tap issues
    this.setupCommandHover();
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
      console.log('[VoiceTreeGraphView] Registering tap handler for floating windows');
      core.on('tap', 'node', (event) => {
        const nodeId = event.target.id();
        console.log('[VoiceTreeGraphView] Node tapped:', nodeId);

        // Emit node selected event
        this.nodeSelectedEmitter.emit(nodeId);

        // Find file and open editor
        const content = this.getContentForNode(nodeId);
        const filePath = this.getFilePathForNode(nodeId);

        console.log('[VoiceTreeGraphView] Found content?', !!content, 'filePath?', !!filePath);

        if (content && filePath) {
          const nodePos = event.target.position();
          console.log('[VoiceTreeGraphView] Calling createFloatingEditor');
          this.createFloatingEditor(nodeId, filePath, content, nodePos);
        } else {
          console.log('[VoiceTreeGraphView] Not opening editor - missing requirements');
        }
      });

      // Setup context menu (requires DOM)
      this.setupContextMenu();
    }

    // Expose for testing
    if (typeof window !== 'undefined') {
      (window as any).cytoscapeInstance = core;
      (window as any).cytoscapeCore = this.cy;

      // Expose test helpers for e2e tests
      (window as any).testHelpers = {
        createTerminal: (nodeId: string) => {
          const filePath = this.getFilePathForNode(nodeId);
          const nodeMetadata = {
            id: nodeId,
            name: nodeId.replace(/_/g, ' '),
            filePath: filePath
          };

          const node = core.getElementById(nodeId);
          if (node.length > 0) {
            const nodePos = node.position();
            this.createFloatingTerminal(nodeId, nodeMetadata, nodePos);
          }
        },
        addNodeAtPosition: async (position: { x: number; y: number }) => {
          await this.handleAddNodeAtPosition(position);
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

    // Reset markdown cache so it mirrors graph state
    this.markdownFiles.clear();

    const parsedFiles = data.files.map(file => {
      const nodeId = normalizeFileId(file.fullPath);
      const parsed = parseForCytoscape(file.content, file.fullPath);
      const savedPos = this.getSavedPositionForFile(file.fullPath);
      const parentId = parsed.linkedNodeIds.length > 0 ? parsed.linkedNodeIds[0] : undefined;

      return {
        file,
        nodeId,
        parsed,
        savedPos,
        parentId
      };
    });

    // Create nodes + edges in bulk to minimise layout churn
    mutator.bulkAddNodes(parsedFiles.map(({ nodeId, parsed, savedPos, parentId }) => ({
      nodeId,
      label: parsed.label,
      linkedNodeIds: parsed.linkedNodeIds,
      edgeLabels: parsed.edgeLabels,
      parentId,
      color: parsed.color,
      explicitPosition: savedPos
    })));

    // Cache file contents and decorate nodes with metadata
    parsedFiles.forEach(({ file, nodeId, parsed }) => {
      this.markdownFiles.set(file.fullPath, file.content);

      const node = cy.getElementById(nodeId);
      if (node.length > 0) {
        node.data('content', file.content);
        node.data('linkedNodeIds', parsed.linkedNodeIds);
        node.data('edgeLabels', Object.fromEntries(parsed.edgeLabels));
        if (parsed.color) {
          node.data('color', parsed.color);
        }
      }
    });

    // Update counts
    this.updateCounts();

    // Set initial load complete
    this.isInitialLoad = false;

    // Fit graph after auto-layout completes (enableAutoLayout will trigger automatically)
    // Layout animation is 300ms, so wait 750ms total
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
    const savedPos = this.getSavedPositionForFile(data.fullPath);

    // Parse and add node
    const parsed = parseForCytoscape(data.content, data.fullPath);
    const mutator = new GraphMutator(cy, null);
    const newNode = mutator.addNode({
      nodeId,
      label: parsed.label,
      linkedNodeIds: parsed.linkedNodeIds,
      parentId: parsed.linkedNodeIds.length > 0 ? parsed.linkedNodeIds[0] : undefined,
      color: parsed.color,
      explicitPosition: savedPos
    });

    // Create edges for newly discovered wikilinks
    for (const targetId of parsed.linkedNodeIds) {
      const label = parsed.edgeLabels.get(targetId) || '';
      mutator.addEdge(nodeId, targetId, label);
    }

    // Store latest content and metadata on node + cache
    newNode.data('content', data.content);
    newNode.data('linkedNodeIds', parsed.linkedNodeIds);
    newNode.data('edgeLabels', Object.fromEntries(parsed.edgeLabels));

    if (parsed.color) {
      newNode.data('color', parsed.color);
    }

    // Auto-layout will trigger automatically via enableAutoLayout when node is added
    // No manual layout call needed

    // Cache content
    this.markdownFiles.set(data.fullPath, data.content);

    // Track last created node
    this.lastCreatedNodeId = nodeId;

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
    const parsed = parseForCytoscape(data.content, data.fullPath);

    // Update node label + metadata
    node.data('label', parsed.label);
    node.data('content', data.content);
    node.data('linkedNodeIds', parsed.linkedNodeIds);
    node.data('edgeLabels', Object.fromEntries(parsed.edgeLabels));
    if (parsed.color) {
      node.data('color', parsed.color);
    }

    // Update edges in-place
    const mutator = new GraphMutator(cy, null);
    mutator.updateNodeLinks(nodeId, parsed.linkedNodeIds, parsed.edgeLabels);

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
    delete this.savedPositions[data.fullPath];
    const filename = data.fullPath.split('/').pop();
    if (filename) {
      delete this.savedPositions[filename];
    }

    // Update counts and UI
    this.updateCounts();
    this.updateStatsDisplay();
  }

  private handleWatchingStopped(): void {
    console.log('[VoiceTreeGraphView] Handling watching stopped');

    const cy = this.cy.getCore();

    // Clear graph - remove ALL elements (including ghost root) for clean state
    cy.elements().remove();

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

  // ============================================================================
  // COMMAND-HOVER MODE
  // ============================================================================

  private setupCommandHover(): void {
    // Track command key state
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        console.log('[CommandHover] Command key pressed');
        this.commandKeyHeld = true;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) {
        console.log('[CommandHover] Command key released');
        this.commandKeyHeld = false;
        this.closeHoverEditor();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    // Listen for node hover when command is held
    this.cy.getCore().on('mouseover', 'node', (event) => {
      console.log('[CommandHover] Node mouseover, commandKeyHeld:', this.commandKeyHeld);
      if (!this.commandKeyHeld) return;

      const node = event.target;
      const nodeId = node.id();

      // Get node content and file path
      const content = this.getContentForNode(nodeId);
      const filePath = this.getFilePathForNode(nodeId);

      console.log('[CommandHover] content:', !!content, 'filePath:', filePath);

      if (!content || !filePath) return;

      // Open hover editor
      this.openHoverEditor(nodeId, filePath, content, node.position());
    });
  }

  private openHoverEditor(
    nodeId: string,
    filePath: string,
    content: string,
    nodePos: Position
  ): void {
    // Close any existing hover editor
    this.closeHoverEditor();

    const hoverId = `hover-${nodeId}`;
    console.log('[VoiceTreeGraphView] Creating command-hover editor:', hoverId);

    try {
      // Get overlay
      const overlay = getOrCreateOverlay(this.cy.getCore());

      // Create window chrome WITHOUT shadow node
      const { windowElement, contentContainer } = createWindowChrome(
        this.cy.getCore(),
        {
          id: hoverId,
          component: 'MarkdownEditor',
          title: `⌘ ${nodeId}`,
          position: {
            x: nodePos.x + 50,
            y: nodePos.y
          },
          initialContent: content,
          onSave: async (newContent: string) => {
            console.log('[VoiceTreeGraphView] Saving hover editor content');
            if ((window as any).electronAPI?.saveFileContent) {
              const result = await (window as any).electronAPI.saveFileContent(filePath, newContent);
              if (!result.success) {
                throw new Error(result.error || 'Failed to save file');
              }
            } else {
              throw new Error('Save functionality not available');
            }
          }
        },
        undefined  // No shadow node!
      );

      // Add to overlay
      overlay.appendChild(windowElement);

      // Set position manually (no shadow node to sync with)
      windowElement.style.left = `${nodePos.x + 50}px`;
      windowElement.style.top = `${nodePos.y}px`;

      // Mount the component
      mountComponent(contentContainer, 'MarkdownEditor', hoverId, {
        id: hoverId,
        component: 'MarkdownEditor',
        title: `⌘ ${nodeId}`,
        initialContent: content,
        onSave: async (newContent: string) => {
          if ((window as any).electronAPI?.saveFileContent) {
            await (window as any).electronAPI.saveFileContent(filePath, newContent);
          }
        }
      });

      // Close on mouse-out
      windowElement.addEventListener('mouseleave', () => {
        this.closeHoverEditor();
      });

      // Store reference
      this.currentHoverEditor = windowElement;
    } catch (error) {
      console.error('[VoiceTreeGraphView] Error creating hover editor:', error);
    }
  }

  private closeHoverEditor(): void {
    if (!this.currentHoverEditor) return;

    console.log('[VoiceTreeGraphView] Closing command-hover editor');
    this.currentHoverEditor.remove();
    this.currentHoverEditor = null;
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

  private getSavedPositionForFile(filePath: string): Position | undefined {
    const filename = filePath.split('/').pop();

    if (this.savedPositions[filePath]) {
      return this.savedPositions[filePath];
    }

    if (filename && this.savedPositions[filename]) {
      return this.savedPositions[filename];
    }

    return undefined;
  }

  private getContentForNode(nodeId: string): string | undefined {
    // First check if node has content in its data (for test nodes)
    const node = this.cy.getCore().getElementById(nodeId);
    if (node.length > 0) {
      const nodeData = node.data();
      if (nodeData.content) {
        return nodeData.content;
      }
    }

    // Fall back to markdown files map (for real file-backed nodes)
    for (const [path, content] of this.markdownFiles) {
      if (normalizeFileId(path) === nodeId) {
        return content;
      }
    }
    return undefined;
  }

  private getFilePathForNode(nodeId: string): string | undefined {
    // First check if node has filePath in its data (for test nodes)
    const node = this.cy.getCore().getElementById(nodeId);
    if (node.length > 0) {
      const nodeData = node.data();
      if (nodeData.filePath) {
        return nodeData.filePath;
      }
    }

    // Fall back to markdown files map (for real file-backed nodes)
    for (const [path] of this.markdownFiles) {
      if (normalizeFileId(path) === nodeId) {
        return path;
      }
    }

    // For test nodes without filePath, generate a dummy path
    return `/test/${nodeId}.md`;
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
    const cy = this.cy.getCore();

    // Space to fit to last created node
    if (e.key === ' ') {
      e.preventDefault();

      if (this.lastCreatedNodeId) {
        const node = cy.getElementById(this.lastCreatedNodeId);
        if (node.length > 0) {
          cy.fit(node, 150);
        }
      }
      return;
    }

    // Command/Ctrl + [ or ] to cycle between terminals
    if ((e.metaKey || e.ctrlKey) && (e.key === '[' || e.key === ']')) {
      e.preventDefault();

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
