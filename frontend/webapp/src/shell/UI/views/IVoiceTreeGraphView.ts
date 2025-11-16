/**
 * VoiceTreeGraphView Interface Contract
 *
 * This interface defines the public API for the VoiceTreeGraphView class,
 * which wraps Cytoscape.js and handles file watching, node updates, and user interactions.
 *
 * This contract is the source of truth for:
 * - Hugo (test writer): Write e2e-tests against this interface
 * - Iris (implementer): Implement this interface exactly
 * - Diana (integrator): Use this interface to wire up VoiceTreeApp
 */

/**
 * File event data structure from FileWatcherService
 */
export interface FileEvent {
  /** Full absolutePath to the file */
  fullPath: string;
  /** File content (markdown) */
  content: string;
  /** Relative absolutePath from watch directory */
  relativePath?: string;
}

/**
 * Bulk file event for initial load
 */
export interface BulkFileEvent {
  files: FileEvent[];
}

/**
 * Watching started event with loaded positions
 */
export interface WatchingStartedEvent {
  directory: string;
  positions?: Record<string, { x: number; y: number }>;
}

/**
 * Position data structure for graph coordinates
 */
export interface Position {
  x: number;
  y: number;
}

/**
 * Configuration options for VoiceTreeGraphView
 */
export interface VoiceTreeGraphViewOptions {
  /** Callback for error events */
  onError?: (error: string) => void;
  /** Callback for loading state changes */
  onLoading?: (isLoading: boolean) => void;
  /** Initial dark mode state (default: false) */
  initialDarkMode?: boolean;
}

// FileWatcherService interface removed - VoiceTreeGraphView uses window.electronAPI directly

/**
 * Event emitter for typed events
 *
 * Simple event system with unsubscribe support
 */
export interface EventEmitter<T> {
  /** Subscribe to event, returns unsubscribe function */
  on(callback: (data: T) => void): () => void;
  /** Emit event to all subscribers */
  emit(data: T): void;
}

/**
 * Main interface for VoiceTreeGraphView
 *
 * This class is responsible for:
 * 1. Rendering and managing the Cytoscape.js graph visualization
 * 2. Handling file watcher events and updating the graph
 * 3. Managing floating windows (editors, terminals)
 * 4. Providing context menu interactions
 * 5. Managing dark mode and themes
 * 6. Saving and loading node positions
 */
export interface IVoiceTreeGraphView {
  // ============================================================================
  // PUBLIC API - Graph Control
  // ============================================================================

  /**
   * Focus the viewport on a specific node
   *
   * Behavior:
   * - Finds node by ID in the graph
   * - Animates viewport to center on node (600ms duration)
   * - If node doesn't exist, does nothing (fail silently)
   *
   * @param nodeId - The ID of the node to focus on
   *
   * @example
   * graphView.focusNode('introduction');
   */
  focusNode(nodeId: string): void;

  /**
   * Get IDs of currently selected nodes
   *
   * Behavior:
   * - Returns array of node IDs that are currently selected
   * - Returns empty array if no nodes selected
   * - Does NOT include floating window shadow nodes
   *
   * @returns Array of selected node IDs
   *
   * @example
   * const selected = graphView.getSelectedNodes();
   * console.log(selected); // ['introduction', 'overview']
   */
  getSelectedNodes(): string[];

  /**
   * Trigger a layout refresh
   *
   * Behavior:
   * - Re-runs the Cola layout algorithm
   * - Maintains pinned node positions
   * - Saves positions after layout completes
   * - Used after bulk graph changes
   *
   * @example
   * graphView.refreshLayout();
   */
  refreshLayout(): void;

  /**
   * Fit the viewport to show all nodes
   *
   * Behavior:
   * - Adjusts zoom and pan to show entire graph
   * - Includes padding around outgoingEdges
   * - Animated transition (600ms)
   *
   * @param padding - Padding in pixels (default: 50)
   *
   * @example
   * graphView.fit(100);
   */
  fit(padding?: number): void;

  /**
   * Toggle dark mode theme
   *
   * Behavior:
   * - Toggles isDarkMode state
   * - Updates document.documentElement classList ('dark')
   * - Saves preference to localStorage
   * - Applies new styles to Cytoscape graph
   * - Updates all floating windows
   *
   * Side effects:
   * - Modifies document.documentElement.classList
   * - Writes to localStorage ('darkMode')
   *
   * @example
   * graphView.toggleDarkMode();
   */
  toggleDarkMode(): void;

  /**
   * Get current dark mode state
   *
   * @returns true if dark mode is enabled
   */
  isDarkMode(): boolean;

  /**
   * Get current node and edge counts
   *
   * Behavior:
   * - Returns counts excluding floating window shadow nodes
   *
   * @returns Object with nodeCount and edgeCount
   */
  getStats(): { nodeCount: number; edgeCount: number };

  // ============================================================================
  // EVENT EMITTERS
  // ============================================================================

  /**
   * Subscribe to node selection events
   *
   * Behavior:
   * - Fires when user clicks/taps on a node
   * - Provides the node ID
   * - Multiple subscribers allowed
   *
   * @param callback - Function to call when node selected
   * @returns Unsubscribe function
   *
   * @example
   * const unsubscribe = graphView.onNodeSelected((nodeId) => {
   *   console.log('Selected:', nodeId);
   * });
   * // Later:
   * unsubscribe();
   */
  onNodeSelected(callback: (nodeId: string) => void): () => void;

  /**
   * Subscribe to node double-click events
   *
   * Behavior:
   * - Fires when user double-clicks on a node
   * - Provides the node ID
   * - Multiple subscribers allowed
   *
   * @param callback - Function to call when node double-clicked
   * @returns Unsubscribe function
   *
   * @example
   * graphView.onNodeDoubleClick((nodeId) => {
   *   console.log('Double-clicked:', nodeId);
   * });
   */
  onNodeDoubleClick(callback: (nodeId: string) => void): () => void;

  /**
   * Subscribe to edge selection events
   *
   * Behavior:
   * - Fires when user clicks/taps on an edge
   * - Provides source and target node IDs
   *
   * @param callback - Function to call when edge selected
   * @returns Unsubscribe function
   */
  onEdgeSelected(callback: (sourceId: string, targetId: string) => void): () => void;

  /**
   * Subscribe to layout completion events
   *
   * Behavior:
   * - Fires after any layout algorithm completes
   * - Useful for triggering position saves or UI-edge updates
   *
   * @param callback - Function to call when layout completes
   * @returns Unsubscribe function
   */
  onLayoutComplete(callback: () => void): () => void;

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  /**
   * Clean up all resources
   *
   * Behavior:
   * - Removes all event listeners (window, keyboard, file watcher)
   * - Destroys Cytoscape instance
   * - Disposes all floating windows
   * - Disposes file watcher service
   * - Clears all internal maps and caches
   *
   * MUST be called when component is destroyed to prevent memory leaks.
   *
   * @example
   * graphView.dispose();
   */
  dispose(): void;
}

/**
 * Constructor signature for VoiceTreeGraphView
 *
 * @param container - HTMLElement where graph will be rendered
 * @param options - Optional configuration
 *
 * Behavior:
 * 1. Stores container reference
 * 2. Sets up dark mode from localStorage or options.initialDarkMode
 * 3. Renders DOM structure (cytoscape container, overlays, hamburger menu)
 * 4. Initializes Cytoscape instance with extensions
 * 5. Sets up event listeners (window resize, keyboard shortcuts)
 * 6. Sets up file event handlers via window.electronAPI
 * 7. Sets up context menu with callbacks
 *
 * Side effects:
 * - Clears and populates container.innerHTML
 * - Reads from localStorage ('darkMode')
 * - Adds window event listeners
 * - Subscribes to window.electronAPI file events
 *
 * @example
 * const container = document.getElementById('graph-container');
 * const graphView = new VoiceTreeGraphView(container, {
 *   onError: (err) => console.error(err),
 *   initialDarkMode: true
 * });
 */
// Constructor is not part of the interface, but documented here for reference
