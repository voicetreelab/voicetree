// Electron API type definitions
import type { Core as CytoscapeCore } from 'cytoscape';
import type { CytoscapeCore as VoiceTreeCytoscapeCore } from '@/graph-core/graphviz/CytoscapeCore';
import type { LayoutManager } from '@/graph-core/graphviz/layout';

export interface FileEvent {
  path: string;
  fullPath: string;
  content?: string;
  size?: number;
  modified?: string;
}

export interface WatchStatus {
  isWatching: boolean;
  directory?: string;
}

export interface ErrorEvent {
  type: string;
  message: string;
  directory?: string;
  filePath?: string;
}

export interface ElectronAPI {
  // Directory selection
  openDirectoryDialog: () => Promise<{ canceled: boolean; filePaths: string[] }>;

  // File operations
  saveFileContent: (filePath: string, content: string) => Promise<void>;

  // File watching methods
  startFileWatching: (directoryPath?: string) => Promise<{ success: boolean; directory?: string; error?: string }>;
  stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
  getWatchStatus: () => Promise<WatchStatus>;

  // File system event listeners
  onWatchingStarted?: (callback: (data: { directory: string; timestamp: string }) => void) => void;
  onFileAdded: (callback: (data: FileEvent) => void) => void;
  onFileChanged: (callback: (data: FileEvent) => void) => void;
  onFileDeleted: (callback: (data: FileEvent) => void) => void;
  onDirectoryAdded: (callback: (data: FileEvent) => void) => void;
  onDirectoryDeleted: (callback: (data: FileEvent) => void) => void;
  onInitialScanComplete: (callback: (data: { directory: string }) => void) => void;
  onFileWatchError: (callback: (data: ErrorEvent) => void) => void;
  onFileWatchInfo: (callback: (data: { type: string; message: string }) => void) => void;
  onFileWatchingStopped: (callback: (data?: unknown) => void) => void;
  removeAllListeners: (channel: string) => void;

  // General IPC communication methods
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (...args: unknown[]) => void): void;
  off(channel: string, listener: (...args: unknown[]) => void): void;
}

// Extend the Window interface to include all global properties
declare global {
  interface Window {
    electronAPI?: ElectronAPI;
    // Graph-related properties exposed for testing
    cy: CytoscapeCore | null;
    cytoscapeCore: VoiceTreeCytoscapeCore | null;
    layoutManager: LayoutManager | null;
    // Test helper functions
    loadTestData: () => void;
    simulateFileLoad: (files: File[]) => void;
  }
}

// File observer specific IPC interfaces
export interface DirectoryPickerResult {
  canceled: boolean;
  directoryPath?: string;
}

export interface FileWatcherStartResult {
  success: boolean;
  error?: string;
}

export interface FileWatcherStopResult {
  success: boolean;
  error?: string;
}