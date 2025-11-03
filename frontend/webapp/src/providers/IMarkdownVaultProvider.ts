/**
 * IMarkdownVaultProvider - Interface for markdown vault data sources
 *
 * Abstracts away file system and Electron IPC coupling from graph logic.
 * Implementations:
 * - ElectronMarkdownVault: Wraps Electron IPC for production
 * - MemoryMarkdownVault: In-memory implementation for fast unit tests
 *
 * Design Principle: Single Solution - graph doesn't know about file systems or IPC
 */

export interface FileData {
  path: string;          // Relative path (e.g., "concepts/introduction.md")
  fullPath: string;      // Absolute path
  content: string;       // File content
  size: number;          // File size in bytes
  modified: string;      // ISO timestamp
}

export interface Position {
  x: number;
  y: number;
}

export interface WatchingStartedEvent {
  directory: string;
  timestamp?: string;
  positions?: Record<string, Position>;
}

/**
 * Disposable pattern for cleanup
 */
export interface Disposable {
  dispose(): void;
}

/**
 * Main vault provider interface
 */
export interface IMarkdownVaultProvider {
  // ============================================================================
  // FILE EVENTS
  // ============================================================================

  /**
   * Called when initial bulk file load completes
   * @param callback - Receives array of all files in vault
   * @returns Disposable to remove listener
   */
  onFilesLoaded(callback: (files: FileData[]) => void): Disposable;

  /**
   * Called when a new file is added to vault
   * @param callback - Receives the new file data
   * @returns Disposable to remove listener
   */
  onFileAdded(callback: (file: FileData) => void): Disposable;

  /**
   * Called when an existing file's content changes
   * @param callback - Receives updated file data
   * @returns Disposable to remove listener
   */
  onFileChanged(callback: (file: FileData) => void): Disposable;

  /**
   * Called when a file is deleted from vault
   * @param callback - Receives the deleted file's path
   * @returns Disposable to remove listener
   */
  onFileDeleted(callback: (fullPath: string) => void): Disposable;

  /**
   * Called when vault watching starts
   * @param callback - Receives watching started event with positions
   * @returns Disposable to remove listener
   */
  onWatchingStarted(callback: (event: WatchingStartedEvent) => void): Disposable;

  /**
   * Called when vault watching stops
   * @param callback - Receives no data
   * @returns Disposable to remove listener
   */
  onWatchingStopped(callback: () => void): Disposable;

  // ============================================================================
  // POSITION PERSISTENCE
  // ============================================================================

  /**
   * Load saved node positions for a directory
   * @param directory - Vault directory path
   * @returns Promise resolving to position map (filename -> {x, y})
   */
  loadPositions(directory: string): Promise<Record<string, Position>>;

  /**
   * Save node positions for a directory
   * @param directory - Vault directory path
   * @param positions - Position map to save
   * @returns Promise resolving to success status
   */
  savePositions(directory: string, positions: Record<string, Position>): Promise<{
    success: boolean;
    error?: string;
  }>;

  // ============================================================================
  // VAULT STATUS
  // ============================================================================

  /**
   * Get current watching status
   * @returns Promise resolving to watch status
   */
  getWatchStatus(): Promise<{
    isWatching: boolean;
    directory: string | null;
  }>;
}
