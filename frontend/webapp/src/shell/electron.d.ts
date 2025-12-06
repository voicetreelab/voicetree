// Electron API type definitions
import type { Core as CytoscapeCore } from 'cytoscape';
import type { GraphDelta } from '@/pure/graph';
import type { mainAPI } from '@/shell/edge/main/api';

// Re-export TerminalData for use in terminal API
export type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/types';

// Utility type to transform all functions in an object to return Promises
// Uses Awaited<R> to handle both sync and async functions correctly:
// - For sync functions returning T: Promise<Awaited<T>> = Promise<T>
// - For async functions returning Promise<T>: Promise<Awaited<Promise<T>>> = Promise<T>
export type Promisify<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : T[K];
};

export interface WatchStatus {
  isWatching: boolean;
  directory?: string;
  vaultSuffix?: string;
}


export interface ElectronAPI {
  // Zero-boilerplate RPC pattern - automatic type inference from mainAPI
  // All RPC calls are async, so we promisify the mainAPI type
  main: Promisify<typeof mainAPI>;

  // File system event listeners
  onWatchingStarted?: (callback: (data: { directory: string; timestamp: string; positions?: Record<string, { x: number; y: number }> }) => void) => void;
  onFileWatchingStopped: (callback: (data?: unknown) => void) => void;
  removeAllListeners: (channel: string) => void;

  // Terminal operations
  terminal: {
    spawn: (nodeMetadata?: TerminalData) => Promise<{ success: boolean; terminalId?: string; error?: string }>;
    write: (terminalId: string, data: string) => Promise<{ success: boolean; error?: string }>;
    resize: (terminalId: string, cols: number, rows: number) => Promise<{ success: boolean; error?: string }>;
    kill: (terminalId: string) => Promise<{ success: boolean; error?: string }>;
    onData: (callback: (terminalId: string, data: string) => void) => void;
    onExit: (callback: (terminalId: string, code: number) => void) => void;
  };

  // Backend log streaming
  onBackendLog: (callback: (log: string) => void) => void;

  // Functional graph API - event listeners only
  graph: {
    // Subscribe to graph delta updates (returns unsubscribe function)
    onGraphUpdate: (callback: (delta: GraphDelta) => void) => () => void;

    // Subscribe to graph clear events (returns unsubscribe function)
    onGraphClear: (callback: () => void) => () => void;
  };

  // General IPC communication methods
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (...args: unknown[]) => void): void;
  off(channel: string, listener: (...args: unknown[]) => void): void;
}

// Extend the Window interface to include all global properties
declare global {
  interface Window {
    electronAPI: ElectronAPI;
    // Graph-related properties exposed for testing
    cy: CytoscapeCore | null;
  }
}
