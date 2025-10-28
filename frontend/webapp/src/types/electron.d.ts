// Electron API type definitions
import type { Core as CytoscapeCore } from 'cytoscape';
import type { CytoscapeCore as VoiceTreeCytoscapeCore } from '@/graph-core/graphviz/CytoscapeCore';
import type { LayoutManager } from '@/graph-core/graphviz/layout';

// Re-export NodeMetadata for use in terminal API
export type { NodeMetadata } from '@/components/floating-windows/types';

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
  saveFileContent: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>;
  deleteFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  createChildNode: (parentNodeId: string) => Promise<{ success: boolean; nodeId?: number; filePath?: string; error?: string }>;
  createStandaloneNode: (position?: { x: number; y: number }) => Promise<{ success: boolean; nodeId?: number; filePath?: string; error?: string }>;

  // File watching methods
  startFileWatching: (directoryPath?: string) => Promise<{ success: boolean; directory?: string; error?: string }>;
  stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
  getWatchStatus: () => Promise<WatchStatus>;

  // File system event listeners
  onWatchingStarted?: (callback: (data: { directory: string; timestamp: string }) => void) => void;
  onInitialFilesLoaded: (callback: (data: { files: FileEvent[]; directory: string }) => void) => void;
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

  // Terminal operations
  terminal: {
    spawn: (nodeMetadata?: NodeMetadata) => Promise<{ success: boolean; terminalId?: string; error?: string }>;
    write: (terminalId: string, data: string) => Promise<{ success: boolean; error?: string }>;
    resize: (terminalId: string, cols: number, rows: number) => Promise<{ success: boolean; error?: string }>;
    kill: (terminalId: string) => Promise<{ success: boolean; error?: string }>;
    onData: (callback: (terminalId: string, data: string) => void) => void;
    onExit: (callback: (terminalId: string, code: number) => void) => void;
  };

  // Position management operations
  positions: {
    save: (directoryPath: string, positions: Record<string, { x: number; y: number }>) => Promise<{ success: boolean; error?: string }>;
    load: (directoryPath: string) => Promise<{ success: boolean; positions: Record<string, { x: number; y: number }>; error?: string }>;
  };

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