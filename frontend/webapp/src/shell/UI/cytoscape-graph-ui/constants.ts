// Core graph visualization constants
export const MIN_NODE_SIZE: 30 = 30;
export const MAX_NODE_SIZE: 80 = 80;
export const MIN_FONT_SIZE: 12 = 12;
export const MAX_FONT_SIZE: 20 = 20;
export const MIN_TEXT_WIDTH: 60 = 60;
export const MAX_TEXT_WIDTH: 180 = 180;
export const DEFAULT_TEXT_WIDTH: 180 = 180;  // Default text-max-width for nodes without degree data

// Layout constants
export const DEFAULT_DISTANCE: 143 = 143;

// Zoom constants
export const MIN_ZOOM: 0.1 = 0.1;
export const MAX_ZOOM: 3 = 3;

// Color constants
export const DEFAULT_NODE_COLOR: "#3498db" = '#3498db';
export const DEFAULT_EDGE_COLOR: "#95a5a6" = '#95a5a6';
export const HOVER_COLOR: "#e74c3c" = '#e74c3c';

// CSS class names for node states
export const CLASS_HOVER: "hover" = 'hover';
export const CLASS_UNHOVER: "unhover" = 'unhover';
export const CLASS_CONNECTED_HOVER: "connected-hover" = 'connected-hover';
export const CLASS_PINNED: "pinned" = 'pinned';
export const CLASS_EXPANDED: "expanded" = 'expanded';
export const CLASS_DANGLING: "dangling" = 'dangling';
export const CLASS_FILTERED: "filtered" = 'filtered';