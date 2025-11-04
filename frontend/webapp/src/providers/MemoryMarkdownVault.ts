/**
 * MemoryMarkdownVault - In-memory markdown vault for fast unit tests
 *
 * Provides a lightweight, deterministic vault implementation that:
 * - Runs entirely in-memory (no file system, no Electron IPC)
 * - Allows test control via simulate* methods
 * - Executes in < 1ms (vs 30+ seconds for Electron tests)
 *
 * Design Principle: Single Solution - tests use same interface as production
 */

import type {
  IMarkdownVaultProvider,
  FileData,
  Position,
  WatchingStartedEvent,
  Disposable,
} from './IMarkdownVaultProvider';

type EventCallback = (data: any) => void;

export class MemoryMarkdownVault implements IMarkdownVaultProvider {
  private files = new Map<string, FileData>();
  private positions: Record<string, Position> = {};
  private listeners = new Map<string, Set<EventCallback>>();
  private watchStatus = {
    isWatching: false,
    directory: null as string | null,
  };

  // ==========================================================================
  // PUBLIC TEST CONTROL API
  // ==========================================================================

  /**
   * Simulate initial bulk file load
   */
  simulateFilesLoaded(files: FileData[]): void {
    files.forEach((file) => this.files.set(file.fullPath, file));
    this.emit('filesLoaded', files);
  }

  /**
   * Simulate adding a new file to vault
   */
  simulateFileAdded(file: FileData): void {
    this.files.set(file.fullPath, file);
    this.emit('fileAdded', file);
  }

  /**
   * Simulate file content change
   */
  simulateFileChanged(file: FileData): void {
    this.files.set(file.fullPath, file);
    this.emit('fileChanged', file);
  }

  /**
   * Simulate file deletion
   */
  simulateFileDeleted(fullPath: string): void {
    this.files.delete(fullPath);
    this.emit('fileDeleted', fullPath);
  }

  /**
   * Simulate vault watching starting
   */
  simulateWatchingStarted(event: WatchingStartedEvent): void {
    this.watchStatus.isWatching = true;
    this.watchStatus.directory = event.directory;
    if (event.positions) {
      this.positions = { ...event.positions };
    }
    this.emit('watchingStarted', event);
  }

  /**
   * Simulate vault watching stopping
   */
  simulateWatchingStopped(): void {
    this.watchStatus.isWatching = false;
    this.watchStatus.directory = null;
    this.emit('watchingStopped', undefined);
  }

  /**
   * Get all files currently in memory (for test assertions)
   */
  getFiles(): FileData[] {
    return Array.from(this.files.values());
  }

  /**
   * Clear all state (useful for test cleanup)
   */
  reset(): void {
    this.files.clear();
    this.positions = {};
    this.listeners.clear();
    this.watchStatus = { isWatching: false, directory: null };
  }

  // ==========================================================================
  // IMarkdownVaultProvider IMPLEMENTATION
  // ==========================================================================

  onFilesLoaded(callback: (files: FileData[]) => void): Disposable {
    return this.addEventListener('filesLoaded', callback);
  }

  onFileAdded(callback: (file: FileData) => void): Disposable {
    return this.addEventListener('fileAdded', callback);
  }

  onFileChanged(callback: (file: FileData) => void): Disposable {
    return this.addEventListener('fileChanged', callback);
  }

  onFileDeleted(callback: (fullPath: string) => void): Disposable {
    return this.addEventListener('fileDeleted', callback);
  }

  onWatchingStarted(callback: (event: WatchingStartedEvent) => void): Disposable {
    return this.addEventListener('watchingStarted', callback);
  }

  onWatchingStopped(callback: () => void): Disposable {
    return this.addEventListener('watchingStopped', callback);
  }

  async loadPositions(directory: string): Promise<Record<string, Position>> {
    // Return positions for this directory
    // In memory, we just have one global position store
    return { ...this.positions };
  }

  async savePositions(
    directory: string,
    positions: Record<string, Position>
  ): Promise<{ success: boolean; error?: string }> {
    this.positions = { ...positions };
    return { success: true };
  }

  async getWatchStatus(): Promise<{
    isWatching: boolean;
    directory: string | null;
  }> {
    return { ...this.watchStatus };
  }

  /**
   * Get the currently watched directory (synchronous)
   */
  getWatchDirectory(): string | undefined {
    return this.watchStatus.directory ?? undefined;
  }

  // ==========================================================================
  // INTERNAL EVENT SYSTEM
  // ==========================================================================

  private addEventListener(event: string, callback: EventCallback): Disposable {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    return {
      dispose: () => {
        this.listeners.get(event)?.delete(callback);
      },
    };
  }

  private emit(event: string, data: any): void {
    this.listeners.get(event)?.forEach((callback) => {
      try {
        callback(data);
      } catch (error) {
        // Fail fast - let errors propagate in tests
        console.error(`Error in ${event} listener:`, error);
        throw error;
      }
    });
  }
}
