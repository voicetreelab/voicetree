export const DEFAULT_TEXT_WIDTH: 180 = 180 as const;  // Default text-max-width for nodes without degree data

// Zoom constants
export const MIN_ZOOM: 0.001 = 0.001 as const;
export const MAX_ZOOM: 500 = 500 as const;

// CSS class names for node states
export const CLASS_HOVER: "hover" = 'hover' as const;
export const CLASS_CONNECTED_HOVER: "connected-hover" = 'connected-hover' as const;

// CSS class names for context node highlighting
export const CONTEXT_CONTAINED_CLASS: "context-contained" = 'context-contained' as const;
export const CONTEXT_EDGE_CLASS: "context-edge" = 'context-edge' as const;

// CSS class name for active terminal highlighting
export const TERMINAL_ACTIVE_CLASS: "terminal-active" = 'terminal-active' as const;