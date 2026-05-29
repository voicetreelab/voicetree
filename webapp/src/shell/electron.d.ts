// Electron API type definitions
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ProjectedGraph } from '@vt/graph-state/contract';
import type { mainAPI } from '@/shell/edge/main/runtime/api';
import type { ConnectionState, EventFrame, GapFrame, TopicName } from '@vt/vt-daemon/transport/eventTypes';
import type { RelayConnectionStatus } from '@/shell/edge/main/runtime/electron/daemon/terminals/vtTerminalAttachTypes';

// Re-export TerminalData for use in terminal API

// Utility type to transform all functions in an object to return Promises
// Uses Awaited<R> to handle both sync and async functions correctly:
// - For sync functions returning T: Promise<Awaited<T>> = Promise<T>
// - For async functions returning Promise<T>: Promise<Awaited<Promise<T>>> = Promise<T>
export type Promisify<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : T[K] extends object
      ? Promisify<T[K]>
      : T[K];
};

export interface WatchStatus {
  isWatching: boolean;
  directory?: string;
}


export interface ElectronAPI {
  // Zero-boilerplate RPC pattern - automatic type inference from mainAPI
  // All RPC calls are async, so we promisify the mainAPI type
  main: Promisify<typeof mainAPI>;

  // File system event listeners (returns cleanup function)
  onWatchingStarted?: (callback: (data: { directory: string; timestamp: string; positions?: Record<string, { x: number; y: number }> }) => void) => () => void;
  onProjectSwitching: (callback: (data: { path: string }) => void) => () => void;
  onProjectReady: (callback: (data: { path: string }) => void) => () => void;
  onProjectLost: (callback: (data: { path?: string; error?: string; pid?: number | null }) => void) => () => void;
  onViewSwitched: (callback: (data: { activeViewId: string }) => void) => () => void;
  removeAllListeners: (channel: string) => void;

  // Terminal operations (Phase 0 / BF-367+368). Tmux-backed terminals:
  // `attach` opens a Main-owned `/terminals/:id/attach` WebSocket and
  // returns an opaque handle id. Renderer-side I/O flows over IPC; the
  // bearer token never enters the renderer. Text injection from
  // non-TerminalVanilla callers goes through `main.sendTextToTerminal`.
  // Spawn moved to vt-daemon-client RPC + terminal-registry SSE in
  // Phase 2 BF-376; the renderer no longer initiates spawn here.
  terminal: {
    attach: (terminalId: string) => Promise<string>;
    onData: (handle: string, listener: (data: string) => void) => () => void;
    onStatus: (handle: string, listener: (status: RelayConnectionStatus) => void) => () => void;
    write: (handle: string, data: string) => Promise<boolean>;
    resize: (handle: string, cols: number, rows: number) => Promise<boolean>;
    scroll: (handle: string, direction: 'up' | 'down', lines: number) => Promise<boolean>;
    detach: (handle: string) => Promise<boolean>;
    /** Re-launch floating panels for every live terminal in the registry. Called on mount + project:ready. */
    rehydrate: () => Promise<void>;
  };

  // VTD /events stream — Main holds the WebSocket; renderer receives frames
  // via IPC. `on(topic, …)` filters per-topic in the preload wrapper.
  events: {
    on: (topic: TopicName, listener: (frame: EventFrame | GapFrame) => void) => () => void;
    onConnectionState: (listener: (state: ConnectionState) => void) => () => void;
    resnapshot: (topic: TopicName) => Promise<void>;
  };

  // Backend log streaming
  onBackendLog: (callback: (log: string) => void) => void;

  // Functional graph API
  graph: {
    // Pull the current projected graph after installing live update handlers
    getCurrentProjectedGraph: () => Promise<ProjectedGraph>;

    // Subscribe to projected graph updates from daemon SSE (returns unsubscribe function)
    onProjectedGraphUpdate: (callback: (graph: ProjectedGraph) => void) => () => void;

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
    electronAPI?: ElectronAPI;
    // Graph-related properties exposed for testing
    cy: CytoscapeCore | null;
  }
}
export type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
