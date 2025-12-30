import type {
  FileObserverApi,
  FileObserverConfig,
  FileObserverEventName,
  FileObserverEventCallback,
  FileObserverEventCallbacks,
  VFile
} from './api';
import { FileObserverError, FileObserverErrorCode } from './api';

/**
 * Mock implementation of FileObserverApi for testing or non-Electron environments
 *
 * This implementation simulates file watching behavior without actual filesystem interaction.
 * Useful for development, testing, and environments where Electron is not available.
 */
export class MockFileObserver implements FileObserverApi {
  private _isWatching: boolean = false;
  private _config: FileObserverConfig | undefined;
  private eventListeners: Map<FileObserverEventName, Set<FileObserverEventCallback<FileObserverEventName>>> = new Map();
  private simulationInterval: NodeJS.Timeout | null = null;
  private mockFileCounter: number = 0;

  constructor() {
    // Mock implementation - no actual setup needed
  }

  /**
   * Start watching the specified directory for file changes (mock)
   */
  async start(config: FileObserverConfig): Promise<void> {
    if (this._isWatching) {
      throw new FileObserverError(
        'File observer is already watching',
        FileObserverErrorCode.ALREADY_WATCHING
      );
    }

    // Validate config
    if (!config.watchDirectory) {
      throw new FileObserverError(
        'Watch directory is required',
        FileObserverErrorCode.INVALID_CONFIG
      );
    }

    // Simulate directory validation
    if (config.watchDirectory.includes('invalid')) {
      throw new FileObserverError(
        'Directory not found',
        FileObserverErrorCode.DIRECTORY_NOT_FOUND
      );
    }

    try {
      this._config = { ...config };
      this._isWatching = true;

      console.log(`Mock: Started watching directory: ${config.watchDirectory}`);

      // Simulate ready event after a short delay
      setTimeout(() => {
        this.emit('ready');
        this.startSimulation();
      }, 100);

    } catch (error) {
      throw new FileObserverError(
        `Failed to start mock file observer: ${error instanceof Error ? error.message : 'Unknown error'}`,
        FileObserverErrorCode.WATCHER_FAILED,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Stop watching for file changes and cleanup resources (mock)
   */
  async stop(): Promise<void> {
    if (!this._isWatching) {
      throw new FileObserverError(
        'File observer is not currently watching',
        FileObserverErrorCode.NOT_WATCHING
      );
    }

    try {
      this._isWatching = false;
      this._config = undefined;

      this.stopSimulation();
      console.log('Mock: Stopped file watching');

    } catch (error) {
      throw new FileObserverError(
        `Failed to stop mock file observer: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
   * Start simulating file changes for testing
   */
  private startSimulation(): void {
    if (this.simulationInterval || !this._config) {
      return;
    }

    const debounceMs: number = this._config.debounceMs ?? 1000;

    // Initial files
    this.simulateInitialFiles();

    // Simulate ongoing changes
    this.simulationInterval = setInterval(() => {
      if (!this._isWatching || !this._config) return;

      const changeType: number = Math.random();
      if (changeType < 0.4) {
        this.simulateFileAdd();
      } else if (changeType < 0.8) {
        this.simulateFileChange();
      } else {
        this.simulateFileDelete();
      }
    }, debounceMs * 5); // Emit changes every 5x debounce time
  }

  /**
   * Stop simulating file changes
   */
  private stopSimulation(): void {
    if (this.simulationInterval) {
      clearInterval(this.simulationInterval);
      this.simulationInterval = null;
    }
  }

  /**
   * Simulate initial files being discovered
   */
  private simulateInitialFiles(): void {
    if (!this._config) return;

    const extensions: string[] = this._config.extensions ?? ['.md'];
    const baseFiles: string[] = ['README', 'notes', 'document', 'config'];

    baseFiles.forEach((baseName, index) => {
      setTimeout(() => {
        const ext: string = extensions[index % extensions.length];
        const file: VFile = {
          path: `${this._config!.watchDirectory}/${baseName}${ext}`,
          content: `# ${baseName}\n\nThis is a mock file for testing.`,
          lastModified: Date.now() - Math.random() * 86400000 // Random time in last day
        };
        this.emit('add', file);
      }, index * 200); // Stagger the initial file discoveries
    });
  }

  /**
   * Simulate a new file being added
   */
  private simulateFileAdd(): void {
    if (!this._config) return;

    this.mockFileCounter++;
    const extensions: string[] = this._config.extensions ?? ['.md'];
    const ext: string = extensions[Math.floor(Math.random() * extensions.length)];

    const file: VFile = {
      path: `${this._config.watchDirectory}/mock-file-${this.mockFileCounter}${ext}`,
      content: `# Mock File ${this.mockFileCounter}\n\nThis file was created at ${new Date().toISOString()}.`,
      lastModified: Date.now()
    };

    this.emit('add', file);
  }

  /**
   * Simulate a file being modified
   */
  private simulateFileChange(): void {
    if (!this._config) return;

    // Pick a random mock file to modify
    const fileNumber: number = Math.max(1, Math.floor(Math.random() * this.mockFileCounter));
    const extensions: string[] = this._config.extensions ?? ['.md'];
    const ext: string = extensions[Math.floor(Math.random() * extensions.length)];

    const file: VFile = {
      path: `${this._config.watchDirectory}/mock-file-${fileNumber}${ext}`,
      content: `# Mock File ${fileNumber}\n\nThis file was modified at ${new Date().toISOString()}.`,
      lastModified: Date.now()
    };

    this.emit('change', file);
  }

  /**
   * Simulate a file being deleted
   */
  private simulateFileDelete(): void {
    if (!this._config || this.mockFileCounter === 0) return;

    // Pick a random mock file to delete
    const fileNumber: number = Math.max(1, Math.floor(Math.random() * this.mockFileCounter));
    const extensions: string[] = this._config.extensions ?? ['.md'];
    const ext: string = extensions[Math.floor(Math.random() * extensions.length)];

    const filePath: string = `${this._config.watchDirectory}/mock-file-${fileNumber}${ext}`;
    this.emit('delete', filePath);
  }

  /**
   * Clean up all event listeners and stop watching
   */
  async dispose(): Promise<void> {
    if (this._isWatching) {
      await this.stop();
    }
    this.eventListeners.clear();
    this.mockFileCounter = 0;
  }

  /**
   * Manually trigger events for testing purposes
   */
  triggerFileAdd(file: VFile): void {
    if (!this._isWatching) {
      console.warn('Cannot simulate file add - mock observer is not watching');
      return;
    }
    this.emit('add', file);
  }

  triggerFileChange(file: VFile): void {
    if (!this._isWatching) {
      console.warn('Cannot simulate file change - mock observer is not watching');
      return;
    }
    this.emit('change', file);
  }

  triggerFileDelete(filePath: string): void {
    if (!this._isWatching) {
      console.warn('Cannot simulate file delete - mock observer is not watching');
      return;
    }
    this.emit('delete', filePath);
  }

  triggerError(message: string, code: FileObserverErrorCode = FileObserverErrorCode.WATCHER_FAILED): void {
    if (!this._isWatching) {
      console.warn('Cannot simulate error - mock observer is not watching');
      return;
    }
    const error: FileObserverError = new FileObserverError(message, code);
    this.emit('error', error);
  }
}

/**
 * Factory function to create a MockFileObserver instance
 */
export function createMockFileObserver(): FileObserverApi {
  return new MockFileObserver();
}