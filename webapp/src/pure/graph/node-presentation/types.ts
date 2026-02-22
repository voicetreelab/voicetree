export type NodeState = 'PLAIN' | 'CARD' | 'HOVER' | 'ANCHORED';

export type NodeKind = 'regular' | 'folder';

export type FolderMeta = {
    // eslint-disable-next-line functional/prefer-readonly-type -- intentionally mutable: updated on folder content change
    childCount: number;
    // eslint-disable-next-line functional/prefer-readonly-type -- intentionally mutable: user toggle
    manuallyCollapsed: boolean;
};

export type NodePresentation = {
    readonly nodeId: string;
    readonly element: HTMLElement;
    readonly kind: NodeKind;
    // eslint-disable-next-line functional/prefer-readonly-type -- intentionally mutable: state machine transitions update this
    state: NodeState;
    // eslint-disable-next-line functional/prefer-readonly-type -- intentionally mutable: pin/unpin toggles this
    isPinned: boolean;
    // eslint-disable-next-line functional/prefer-readonly-type -- intentionally mutable: folder-specific metadata
    folderMeta?: FolderMeta;
};

// Zoom thresholds for state transitions
export const ZOOM_THRESHOLD_MIN: number = 0.7;
export const ZOOM_THRESHOLD_MAX: number = 1.05;
export const MORPH_RANGE: number = ZOOM_THRESHOLD_MAX - ZOOM_THRESHOLD_MIN;
export const CIRCLE_SIZE: number = 30; // px — native Cy circle size when zoomed out
export const CARD_WIDTH: number = 260;
export const FOLDER_CARD_WIDTH: number = 300;

// Dimensions for regular nodes
const REGULAR_DIMENSIONS: Record<NodeState, { readonly width: number; readonly height: number }> = {
    PLAIN:    { width: CIRCLE_SIZE, height: CIRCLE_SIZE },
    CARD:     { width: 260, height: 80 },
    HOVER:    { width: 340, height: 400 },
    ANCHORED: { width: 440, height: 800 },
};

// Dimensions for folder nodes
const FOLDER_DIMENSIONS: Record<NodeState, { readonly width: number; readonly height: number }> = {
    PLAIN:    { width: 40, height: 40 },
    CARD:     { width: 300, height: 100 },
    HOVER:    { width: 380, height: 300 },
    ANCHORED: { width: 440, height: 500 },
};

/**
 * Get the target dimensions for a given state and node kind.
 * Replaces the old static STATE_DIMENSIONS Record to support folder nodes.
 */
export function getStateDimensions(
    state: NodeState,
    kind: NodeKind = 'regular'
): { readonly width: number; readonly height: number } {
    return kind === 'folder' ? FOLDER_DIMENSIONS[state] : REGULAR_DIMENSIONS[state];
}

// Backwards-compatible alias for consumers that don't need kind awareness yet
export const STATE_DIMENSIONS: Record<NodeState, { readonly width: number; readonly height: number }> = REGULAR_DIMENSIONS;
