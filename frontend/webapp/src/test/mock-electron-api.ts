import type { ElectronAPI, FileEvent, ErrorEvent, WatchStatus } from '@/types/electron';

/**
 * Mock Electron API for testing the file-to-graph pipeline in browser environment
 * This mock allows tests to simulate file events without needing Electron
 */
export class MockElectronAPI implements ElectronAPI {
  private listeners: Map<string, Array<(data: any) => void>> = new Map();
  private watchStatus: WatchStatus = { isWatching: false };
  private watchDirectory?: string;

  constructor() {
    // Set up event listener for custom events from tests
    this.setupTestEventListeners();
  }

  // IPC Methods
  async startFileWatching(directoryPath?: string): Promise<{ success: boolean; directory?: string; error?: string }> {
    if (!directoryPath) {
      // Simulate user selecting a directory
      directoryPath = '/mock/test/directory';
    }

    this.watchDirectory = directoryPath;
    this.watchStatus = { isWatching: true, directory: directoryPath };

    // Simulate initial scan
    setTimeout(() => {
      this.emit('initial-scan-complete', { directory: directoryPath });
    }, 100);

    return { success: true, directory: directoryPath };
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
  private addListener(event: string, callback: (data: any) => void): void {
    console.log(`MockElectronAPI: Adding listener for event '${event}'`);
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
    console.log(`MockElectronAPI: Total listeners for '${event}': ${this.listeners.get(event)!.length}`);
  }

  private emit(event: string, data: any): void {
    console.log(`MockElectronAPI: Emitting event '${event}' with data:`, data);
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      console.log(`MockElectronAPI: Found ${callbacks.length} callback(s) for event '${event}'`);
      callbacks.forEach(callback => callback(data));
    } else {
      console.log(`MockElectronAPI: No callbacks registered for event '${event}'`);
    }
  }

  // Set up listeners for test events
  private setupTestEventListeners(): void {
    console.log('MockElectronAPI: Setting up test event listeners on window');
    // Listen for custom events dispatched by tests
    window.addEventListener('file-added', (event: CustomEvent) => {
      this.emit('file-added', {
        path: event.detail.path,
        fullPath: `/mock/test/directory/${event.detail.path}`,
        content: event.detail.content,
        size: event.detail.content?.length || 0,
        modified: new Date().toISOString()
      });
    });

    window.addEventListener('file-changed', (event: CustomEvent) => {
      this.emit('file-changed', {
        path: event.detail.path,
        fullPath: `/mock/test/directory/${event.detail.path}`,
        content: event.detail.content,
        size: event.detail.content?.length || 0,
        modified: new Date().toISOString()
      });
    });

    window.addEventListener('file-deleted', (event: CustomEvent) => {
      this.emit('file-deleted', {
        path: event.detail.path,
        fullPath: `/mock/test/directory/${event.detail.path}`
      });
    });

    window.addEventListener('directory-added', (event: CustomEvent) => {
      this.emit('directory-added', {
        path: event.detail.path,
        fullPath: `/mock/test/directory/${event.detail.path}`
      });
    });

    window.addEventListener('directory-deleted', (event: CustomEvent) => {
      this.emit('directory-deleted', {
        path: event.detail.path,
        fullPath: `/mock/test/directory/${event.detail.path}`
      });
    });
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