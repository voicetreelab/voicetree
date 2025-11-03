/**
 * ElectronMarkdownVault - Production vault provider wrapping Electron IPC
 *
 * Adapts window.electronAPI to IMarkdownVaultProvider interface.
 * This is the production implementation used when running in Electron.
 *
 * Design Principle: Single Solution - graph uses same interface regardless of environment
 */

import type {
  IMarkdownVaultProvider,
  FileData,
  Position,
  WatchingStartedEvent,
  Disposable,
} from './IMarkdownVaultProvider';
import type { ElectronAPI, FileEvent } from '@/types/electron.d';

export class ElectronMarkdownVault implements IMarkdownVaultProvider {
  private electronAPI: ElectronAPI;

  constructor() {
    if (!window.electronAPI) {
      throw new Error(
        'ElectronMarkdownVault requires window.electronAPI to be available. ' +
          'Use MemoryMarkdownVault for tests instead.'
      );
    }
    this.electronAPI = window.electronAPI;
  }

  // ==========================================================================
  // FILE EVENTS
  // ==========================================================================

  onFilesLoaded(callback: (files: FileData[]) => void): Disposable {
    const handler = (data: { files: FileEvent[]; directory: string }) => {
      // Convert FileEvent[] to FileData[]
      const fileData = data.files.map(this.toFileData);
      callback(fileData);
    };

    this.electronAPI.onInitialFilesLoaded(handler);

    return {
      dispose: () => {
        this.electronAPI.removeAllListeners('initial-files-loaded');
      },
    };
  }

  onFileAdded(callback: (file: FileData) => void): Disposable {
    const handler = (event: FileEvent) => {
      callback(this.toFileData(event));
    };

    this.electronAPI.onFileAdded(handler);

    return {
      dispose: () => {
        this.electronAPI.removeAllListeners('file-added');
      },
    };
  }

  onFileChanged(callback: (file: FileData) => void): Disposable {
    const handler = (event: FileEvent) => {
      callback(this.toFileData(event));
    };

    this.electronAPI.onFileChanged(handler);

    return {
      dispose: () => {
        this.electronAPI.removeAllListeners('file-changed');
      },
    };
  }

  onFileDeleted(callback: (fullPath: string) => void): Disposable {
    const handler = (event: FileEvent) => {
      callback(event.fullPath);
    };

    this.electronAPI.onFileDeleted(handler);

    return {
      dispose: () => {
        this.electronAPI.removeAllListeners('file-deleted');
      },
    };
  }

  onWatchingStarted(callback: (event: WatchingStartedEvent) => void): Disposable {
    const handler = (data: {
      directory: string;
      timestamp: string;
      positions?: Record<string, { x: number; y: number }>;
    }) => {
      callback({
        directory: data.directory,
        timestamp: data.timestamp,
        positions: data.positions,
      });
    };

    // onWatchingStarted is optional in ElectronAPI, fail fast if not available
    if (!this.electronAPI.onWatchingStarted) {
      throw new Error('onWatchingStarted not available in electronAPI');
    }

    this.electronAPI.onWatchingStarted(handler);

    return {
      dispose: () => {
        this.electronAPI.removeAllListeners('watching-started');
      },
    };
  }

  onWatchingStopped(callback: () => void): Disposable {
    this.electronAPI.onFileWatchingStopped(callback);

    return {
      dispose: () => {
        this.electronAPI.removeAllListeners('file-watching-stopped');
      },
    };
  }

  // ==========================================================================
  // POSITION PERSISTENCE
  // ==========================================================================

  async loadPositions(directory: string): Promise<Record<string, Position>> {
    const result = await this.electronAPI.positions.load(directory);

    if (!result.success) {
      console.error('Failed to load positions:', result.error);
      return {};
    }

    return result.positions || {};
  }

  async savePositions(
    directory: string,
    positions: Record<string, Position>
  ): Promise<{ success: boolean; error?: string }> {
    return await this.electronAPI.positions.save(directory, positions);
  }

  // ==========================================================================
  // VAULT STATUS
  // ==========================================================================

  async getWatchStatus(): Promise<{
    isWatching: boolean;
    directory: string | null;
  }> {
    const status = await this.electronAPI.getWatchStatus();
    return {
      isWatching: status.isWatching,
      directory: status.directory || null,
    };
  }

  // ==========================================================================
  // INTERNAL HELPERS
  // ==========================================================================

  /**
   * Convert Electron FileEvent to FileData
   * Fails fast if required fields are missing
   */
  private toFileData(event: FileEvent): FileData {
    if (!event.content || event.size === undefined || !event.modified) {
      throw new Error(
        `FileEvent missing required fields: ${JSON.stringify(event)}`
      );
    }

    return {
      path: event.path,
      fullPath: event.fullPath,
      content: event.content,
      size: event.size,
      modified: event.modified,
    };
  }
}
