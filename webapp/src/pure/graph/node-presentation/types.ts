export type NodeState = 'PLAIN' | 'CARD' | 'HOVER' | 'INLINE_EDIT' | 'ANCHORED';

export type NodePresentation = {
    readonly nodeId: string;
    readonly element: HTMLElement;
    // eslint-disable-next-line functional/prefer-readonly-type -- intentionally mutable: state machine transitions update this
    state: NodeState;
    // eslint-disable-next-line functional/prefer-readonly-type -- intentionally mutable: pin/unpin toggles this
    isPinned: boolean;
};

// Zoom thresholds for state transitions
export const ZOOM_THRESHOLD_MIN: number = 0.35;
export const ZOOM_THRESHOLD_MAX: number = 0.525;
export const MORPH_RANGE: number = ZOOM_THRESHOLD_MAX - ZOOM_THRESHOLD_MIN;
export const CIRCLE_SIZE: number = 30; // px — native Cy circle size when zoomed out
export const CARD_WIDTH: number = 200;

// Dimensions for each state — Cy node dimensions must match for Cola layout
export const STATE_DIMENSIONS: Record<NodeState, { readonly width: number; readonly height: number }> = {
    PLAIN:    { width: CIRCLE_SIZE, height: CIRCLE_SIZE },
    CARD:     { width: 200, height: 80 },
    HOVER:       { width: 340, height: 400 },
    INLINE_EDIT: { width: 300, height: 200 },
    ANCHORED:    { width: 440, height: 800 },
};
