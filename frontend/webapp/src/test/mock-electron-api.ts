import type { ElectronAPI, FileEvent, ErrorEvent, WatchStatus } from '@/types/electron';
import { EXAMPLE_FILES, EXAMPLE_DIRECTORY } from './example-files';

/**
 * Mock Electron API for testing the file-to-graph pipeline in browser environment
 * This mock allows tests to simulate file events without needing Electron
 */
export class MockElectronAPI implements ElectronAPI {
  private listeners: Map<string, Array<(data: unknown) => void>> = new Map();
  private watchStatus: WatchStatus = { isWatching: false };
  private watchDirectory?: string;
  private hasLoadedExampleFiles = false;

  constructor() {
    // Set up event listener for custom events from tests
    this.setupTestEventListeners();
  }

  // IPC Methods
  async startFileWatching(directoryPath?: string): Promise<{ success: boolean; directory?: string; error?: string }> {
    if (!directoryPath) {
      // Use example directory by default
      directoryPath = EXAMPLE_DIRECTORY;
    }

    this.watchDirectory = directoryPath;
    this.watchStatus = { isWatching: true, directory: directoryPath };

    // Load example files automatically on first watch
    if (!this.hasLoadedExampleFiles) {
      this.loadExampleFiles();
      this.hasLoadedExampleFiles = true;
    }

    // Simulate initial scan complete
    setTimeout(() => {
      this.emit('initial-scan-complete', { directory: directoryPath });
    }, 100);

    return { success: true, directory: directoryPath };
  }

  private loadExampleFiles(): void {
    // console.log('MockElectronAPI: Loading example files...');

    // Emit file-added events for each example file with a small delay
    EXAMPLE_FILES.forEach((file, index) => {
      setTimeout(() => {
        // console.log(`MockElectronAPI: Loading example file: ${file.path}`);
        this.emit('file-added', {
          path: file.path,
          fullPath: `${this.watchDirectory}/${file.path}`,
          content: file.content,
          size: file.content.length,
          modified: new Date().toISOString()
        });
      }, 100 + (index * 50)); // Stagger the file additions
    });
  }

  async stopFileWatching(): Promise<{ success: boolean; error?: string }> {
    this.watchStatus = { isWatching: false };
    this.watchDirectory = undefined;

    this.emit('file-watching-stopped', {});

    return { success: true };
  }

  async getWatchStatus(): Promise<WatchStatus> {
    return this.watchStatus;
  }

  // File operations
  async saveFileContent(filePath: string, content: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Extract filename from path
      const fileName = filePath.split('/').pop() || filePath;

      // Emit a file-changed event to simulate the file watcher detecting the change
      // This maintains the same data flow as real Electron
      setTimeout(() => {
        this.emit('file-changed', {
          path: fileName,
          fullPath: filePath,
          content: content,
          size: content.length,
          modified: new Date().toISOString()
        });
      }, 50);

      // console.log(`MockElectronAPI: Saved file ${filePath} (simulated)`);
      return { success: true };
    } catch (error) {
      console.error(`MockElectronAPI: Failed to save file ${filePath}:`, error);
      return { success: false, error: (error as Error).message };
    }
  }

  async openDirectoryDialog(): Promise<{ canceled: boolean; filePaths: string[] }> {
    // Simulate selecting the example directory in browser mode
    // console.log('MockElectronAPI: Opening directory dialog (simulated)');
    return { canceled: false, filePaths: [EXAMPLE_DIRECTORY] };
  }

  // General IPC methods for compatibility
  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    // console.log(`MockElectronAPI: invoke(${channel}, ${JSON.stringify(args)})`)
    // Handle common invoke patterns
    switch (channel) {
      case 'save-file-content':
        return this.saveFileContent(args[0] as string, args[1] as string);
      default:
        console.warn(`MockElectronAPI: Unhandled invoke channel: ${channel}`);
        return Promise.resolve();
    }
  }

  on(channel: string, listener: (...args: unknown[]) => void): void {
    this.addListener(channel, listener as (data: unknown) => void);
  }

  off(channel: string, listener: (...args: unknown[]) => void): void {
    const listeners = this.listeners.get(channel);
    if (listeners) {
      const index = listeners.indexOf(listener as (data: unknown) => void);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  // Event Listeners
  onFileAdded(callback: (data: FileEvent) => void): void {
    this.addListener('file-added', callback);
  }

  onFileChanged(callback: (data: FileEvent) => void): void {
    this.addListener('file-changed', callback);
  }

  onFileDeleted(callback: (data: FileEvent) => void): void {
    this.addListener('file-deleted', callback);
  }

  onDirectoryAdded(callback: (data: FileEvent) => void): void {
    this.addListener('directory-added', callback);
  }

  onDirectoryDeleted(callback: (data: FileEvent) => void): void {
    this.addListener('directory-deleted', callback);
  }

  onInitialScanComplete(callback: (data: { directory: string }) => void): void {
    this.addListener('initial-scan-complete', callback);
  }

  onFileWatchError(callback: (data: ErrorEvent) => void): void {
    this.addListener('file-watch-error', callback);
  }

  onFileWatchInfo(callback: (data: { type: string; message: string }) => void): void {
    this.addListener('file-watch-info', callback);
  }

  onFileWatchingStopped(callback: () => void): void {
    this.addListener('file-watching-stopped', callback);
  }

  removeAllListeners(event: string): void {
    this.listeners.delete(event);
  }

  // Helper methods for testing
  private addListener(event: string, callback: (data: unknown) => void): void {
    // console.log(`MockElectronAPI: Adding listener for event '${event}'`);
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
    // console.log(`MockElectronAPI: Total listeners for '${event}': ${this.listeners.get(event)!.length}`);
  }

  private emit(event: string, data: unknown): void {
    // console.log(`MockElectronAPI: Emitting event '${event}' with data:`, data);
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      // console.log(`MockElectronAPI: Found ${callbacks.length} callback(s) for event '${event}'`);
      callbacks.forEach(callback => callback(data));
    } else {
      // console.log(`MockElectronAPI: No callbacks registered for event '${event}'`);
    }
  }

  // Set up listeners for test events
  private setupTestEventListeners(): void {
    // console.log('MockElectronAPI: Setting up test event listeners on window');
    // Listen for custom events dispatched by tests
    window.addEventListener('file-added', ((event: CustomEvent) => {
      // console.log('MockElectronAPI: Received file-added CustomEvent from window:', event.detail);
      this.emit('file-added', {
        path: event.detail.path,
        fullPath: `/mock/test/directory/${event.detail.path}`,
        content: event.detail.content,
        size: event.detail.content?.length || 0,
        modified: new Date().toISOString()
      });
    }) as EventListener);

    window.addEventListener('file-changed', ((event: CustomEvent) => {
      this.emit('file-changed', {
        path: event.detail.path,
        fullPath: `/mock/test/directory/${event.detail.path}`,
        content: event.detail.content,
        size: event.detail.content?.length || 0,
        modified: new Date().toISOString()
      });
    }) as EventListener);

    window.addEventListener('file-deleted', ((event: CustomEvent) => {
      this.emit('file-deleted', {
        path: event.detail.path,
        fullPath: `/mock/test/directory/${event.detail.path}`
      });
    }) as EventListener);

    window.addEventListener('directory-added', ((event: CustomEvent) => {
      this.emit('directory-added', {
        path: event.detail.path,
        fullPath: `/mock/test/directory/${event.detail.path}`
      });
    }) as EventListener);

    window.addEventListener('directory-deleted', ((event: CustomEvent) => {
      this.emit('directory-deleted', {
        path: event.detail.path,
        fullPath: `/mock/test/directory/${event.detail.path}`
      });
    }) as EventListener);
  }

  // Method to simulate file events for testing (can be called directly)
  simulateFileEvent(type: 'add' | 'change' | 'delete', path: string, content?: string): void {
    switch (type) {
      case 'add':
        this.emit('file-added', {
          path,
          fullPath: `/mock/test/directory/${path}`,
          content: content || '',
          size: content?.length || 0,
          modified: new Date().toISOString()
        });
        break;
      case 'change':
        this.emit('file-changed', {
          path,
          fullPath: `/mock/test/directory/${path}`,
          content: content || '',
          size: content?.length || 0,
          modified: new Date().toISOString()
        });
        break;
      case 'delete':
        this.emit('file-deleted', {
          path,
          fullPath: `/mock/test/directory/${path}`
        });
        break;
    }
  }
}