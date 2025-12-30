import type {
  FileObserverApi,
  FileObserverConfig,
  FileObserverEventName,
  FileObserverEventCallback,
  FileObserverEventCallbacks,
  VFile
} from './api';
import { FileObserverError, FileObserverErrorCode } from './api';
import type { ElectronAPI } from '@/shell/electron';

// IPC channel constants for file observer communication
const IPC_CHANNELS: { readonly START_WATCHING: "file-observer:start-watching"; readonly STOP_WATCHING: "file-observer:stop-watching"; readonly FILE_ADDED: "file-observer:file-added"; readonly FILE_CHANGED: "file-observer:file-changed"; readonly FILE_DELETED: "file-observer:file-deleted"; readonly ERROR: "file-observer:error"; readonly READY: "file-observer:ready"; } = {
  START_WATCHING: 'file-observer:start-watching',
  STOP_WATCHING: 'file-observer:stop-watching',
  FILE_ADDED: 'file-observer:file-added',
  FILE_CHANGED: 'file-observer:file-changed',
  FILE_DELETED: 'file-observer:file-deleted',
  ERROR: 'file-observer:error',
  READY: 'file-observer:ready'
} as const;

/**
 * Electron-specific implementation of FileObserverApi
 *
 * This implementation uses Electron's IPC system to communicate with the main process
 * which handles the actual file system watching using chokidar.
 */
export class ElectronFileObserver implements FileObserverApi {
  private _isWatching: boolean = false;
  private _config: FileObserverConfig | undefined;
  private eventListeners: Map<FileObserverEventName, Set<FileObserverEventCallback<FileObserverEventName>>> = new Map();
  private ipcRenderer: ElectronAPI | undefined;

  constructor() {
    this.ipcRenderer = window.electronAPI;

    if (!this.ipcRenderer) {
      console.warn('Electron API not available. Make sure preload script is properly configured.');
    }

    this.setupIpcListeners();
  }

  /**
   * Set up IPC listeners for events from main process
   */
  private setupIpcListeners(): void {
    if (!this.ipcRenderer) return;

    // Listen for ready event from main process
    this.ipcRenderer.on(IPC_CHANNELS.READY, (() => {
      this.emit('ready');
    }) as (...args: unknown[]) => void);

    // Listen for file added events
    this.ipcRenderer.on(IPC_CHANNELS.FILE_ADDED, ((file: VFile) => {
      this.emit('add', file);
    }) as (...args: unknown[]) => void);

    // Listen for file changed events
    this.ipcRenderer.on(IPC_CHANNELS.FILE_CHANGED, ((file: VFile) => {
      this.emit('change', file);
    }) as (...args: unknown[]) => void);

    // Listen for file deleted events
    this.ipcRenderer.on(IPC_CHANNELS.FILE_DELETED, ((filePath: string) => {
      this.emit('delete', filePath);
    }) as (...args: unknown[]) => void);

    // Listen for error events
    this.ipcRenderer.on(IPC_CHANNELS.ERROR, ((error: { message: string; code: FileObserverErrorCode; cause?: Error }) => {
      const fileObserverError: FileObserverError = new FileObserverError(error.message, error.code, error.cause);
      this.emit('error', fileObserverError);
    }) as (...args: unknown[]) => void);
  }

  /**
   * Start watching the specified directory for file changes
   */
  async start(config: FileObserverConfig): Promise<void> {
    if (this._isWatching) {
      throw new FileObserverError(
        'File observer is already watching',
        FileObserverErrorCode.ALREADY_WATCHING
      );
    }

    if (!this.ipcRenderer) {
      throw new FileObserverError(
        'Electron API not available',
        FileObserverErrorCode.WATCHER_FAILED
      );
    }

    // Validate config
    if (!config.watchDirectory) {
      throw new FileObserverError(
        'Watch directory is required',
        FileObserverErrorCode.INVALID_CONFIG
      );
    }

    try {
      // Send config to main process to start watching
      await this.ipcRenderer.invoke(IPC_CHANNELS.START_WATCHING, config);

      this._config = config;
      this._isWatching = true;

      console.log(`Started watching directory: ${config.watchDirectory}`);

    } catch (error) {
      throw new FileObserverError(
        `Failed to start file observer: ${error instanceof Error ? error.message : 'Unknown error'}`,
        FileObserverErrorCode.WATCHER_FAILED,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Stop watching for file changes and cleanup resources
   */
  async stop(): Promise<void> {
    if (!this._isWatching) {
      throw new FileObserverError(
        'File observer is not currently watching',
        FileObserverErrorCode.NOT_WATCHING
      );
    }

    if (!this.ipcRenderer) {
      throw new FileObserverError(
        'Electron API not available',
        FileObserverErrorCode.WATCHER_FAILED
      );
    }

    try {
      await this.ipcRenderer.invoke(IPC_CHANNELS.STOP_WATCHING);

      this._isWatching = false;
      this._config = undefined;

      console.log('Stopped file watching');

    } catch (error) {
      throw new FileObserverError(
        `Failed to stop file observer: ${error instanceof Error ? error.message : 'Unknown error'}`,
        FileObserverErrorCode.WATCHER_FAILED,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Register an event listener for file observer events
   */
  on<T extends FileObserverEventName>(
    event: T,
    callback: FileObserverEventCallback<T>
  ): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback as FileObserverEventCallback<FileObserverEventName>);
  }

  /**
   * Unregister an event listener
   */
  off<T extends FileObserverEventName>(
    event: T,
    callback: FileObserverEventCallback<T>
  ): void {
    const listeners: Set<FileObserverEventCallback<keyof FileObserverEventCallbacks>> | undefined = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback as FileObserverEventCallback<FileObserverEventName>);
      if (listeners.size === 0) {
        this.eventListeners.delete(event);
      }
    }
  }

  /**
   * Get the current status of the file observer
   */
  get isWatching(): boolean {
    return this._isWatching;
  }

  /**
   * Get the current configuration
   */
  get config(): FileObserverConfig | undefined {
    return this._config;
  }

  /**
   * Emit event to registered listeners
   */
  private emit<T extends FileObserverEventName>(
    event: T,
    ...args: Parameters<FileObserverEventCallback<T>>
  ): void {
    const listeners: Set<FileObserverEventCallback<keyof FileObserverEventCallbacks>> | undefined = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (listener as any)(...args);
        } catch (error) {
          console.error(`Error in ${event} listener:`, error);
        }
      });
    }
  }

  /**
   * Clean up all event listeners and stop watching
   */
  async dispose(): Promise<void> {
    if (this._isWatching) {
      await this.stop();
    }
    this.eventListeners.clear();
  }
}

/**
 * Factory function to create an ElectronFileObserver instance
 */
export function createElectronFileObserver(): FileObserverApi {
  return new ElectronFileObserver();
}

/**
 * Type guard to check if running in Electron environment
 */
export function isElectronEnvironment(): boolean {
  return typeof window !== 'undefined' && !!(window as typeof window & { electronAPI?: unknown }).electronAPI;
}