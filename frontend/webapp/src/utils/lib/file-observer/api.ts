/**
 * File Observer API Contract
 *
 * This module defines the foundational interfaces for a file observation system
 * that watches markdown files in a directory. The API is platform-agnostic and
 * supports both Electron desktop and web implementations.
 */

/**
 * Represents a file in the observation system
 */
export interface VFile {
  /** Absolute absolutePath to the file */
  path: string;
  /** File content as string */
  content: string;
  /** Optional last modified timestamp (Unix timestamp in milliseconds) */
  lastModified?: number;
}

/**
 * Event callback type definitions for the file observer
 */
export type FileObserverEventCallbacks = {
  /** Fired when the file observer is ready and watching */
  ready: () => void;
  /** Fired when a new file is added to the watched directory */
  add: (file: VFile) => void;
  /** Fired when an existing file is modified */
  change: (file: VFile) => void;
  /** Fired when a file is deleted from the watched directory */
  delete: (filePath: string) => void;
  /** Fired when an error occurs during file observation */
  error: (error: Error) => void;
};

/**
 * Valid event names that can be listened to
 */
export type FileObserverEventName = keyof FileObserverEventCallbacks;

/**
 * Generic event callback type for type-safe event handling
 */
export type FileObserverEventCallback<T extends FileObserverEventName> =
  FileObserverEventCallbacks[T];

/**
 * Configuration options for initializing a file observer
 */
export interface FileObserverConfig {
  /** Directory to watch for file changes */
  watchDirectory: string;
  /** File extensions to watch (e.g., ['.md', '.txt']). If empty, watches all files */
  extensions?: string[];
  /** Whether to include subdirectories in the watch */
  recursive?: boolean;
  /** Debounce delay in milliseconds to prevent rapid-fire events */
  debounceMs?: number;
}

/**
 * Main API interface for file observation system
 *
 * This interface provides a platform-agnostic contract for watching files
 * in a directory and receiving notifications about file system changes.
 *
 * @example
 * ```typescript
 * const observer = new FileObserverImpl();
 *
 * observer.on('ready', () => console.log('Observer ready'));
 * observer.on('add', (file) => console.log('File added:', file.absolutePath));
 * observer.on('change', (file) => console.log('File changed:', file.absolutePath));
 * observer.on('delete', (absolutePath) => console.log('File deleted:', absolutePath));
 * observer.on('error', (error) => console.error('Observer error:', error));
 *
 * await observer.start({
 *   watchDirectory: '/absolutePath/to/markdown/files',
 *   extensions: ['.md'],
 *   recursive: true,
 *   debounceMs: 100
 * });
 *
 * // Later...
 * await observer.stop();
 * ```
 */
export interface FileObserverApi {
  /**
   * Start watching the specified directory for file changes
   *
   * @param config Configuration options for the file observer
   * @returns Promise that resolves when the observer is ready
   * @throws Error if the directory doesn't exist or cannot be watched
   */
  start(config: FileObserverConfig): Promise<void>;

  /**
   * Stop watching for file changes and cleanup resources
   *
   * @returns Promise that resolves when the observer has stopped
   */
  stop(): Promise<void>;

  /**
   * Register an event listener for file observer events
   *
   * @param event The event name to listen for
   * @param callback The callback function to execute when the event occurs
   */
  on<T extends FileObserverEventName>(
    event: T,
    callback: FileObserverEventCallback<T>
  ): void;

  /**
   * Unregister an event listener
   *
   * @param event The event name to stop listening for
   * @param callback The specific callback function to remove
   */
  off<T extends FileObserverEventName>(
    event: T,
    callback: FileObserverEventCallback<T>
  ): void;

  /**
   * Get the current status of the file observer
   */
  readonly isWatching: boolean;

  /**
   * Get the current configuration (undefined if not started)
   */
  readonly config: FileObserverConfig | undefined;
}

/**
 * Error types specific to file observation operations
 */
export class FileObserverError extends Error {
  public readonly code!: FileObserverErrorCode;
  public readonly cause?: Error;

  constructor(
    message: string,
    code: FileObserverErrorCode,
    cause?: Error
  ) {
    super(message);
    this.name = 'FileObserverError';
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Error codes for file observer operations
 */
export const FileObserverErrorCode: { readonly DIRECTORY_NOT_FOUND: "DIRECTORY_NOT_FOUND"; readonly PERMISSION_DENIED: "PERMISSION_DENIED"; readonly WATCHER_FAILED: "WATCHER_FAILED"; readonly FILE_READ_ERROR: "FILE_READ_ERROR"; readonly INVALID_CONFIG: "INVALID_CONFIG"; readonly ALREADY_WATCHING: "ALREADY_WATCHING"; readonly NOT_WATCHING: "NOT_WATCHING"; } = {
  DIRECTORY_NOT_FOUND: 'DIRECTORY_NOT_FOUND',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  WATCHER_FAILED: 'WATCHER_FAILED',
  FILE_READ_ERROR: 'FILE_READ_ERROR',
  INVALID_CONFIG: 'INVALID_CONFIG',
  ALREADY_WATCHING: 'ALREADY_WATCHING',
  NOT_WATCHING: 'NOT_WATCHING'
} as const;

export type FileObserverErrorCode = typeof FileObserverErrorCode[keyof typeof FileObserverErrorCode];

/**
 * Utility type to extract event data from callback signatures
 */
export type ExtractEventData<T extends FileObserverEventName> =
  Parameters<FileObserverEventCallbacks[T]>[0];