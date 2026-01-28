/**
 * Pure functions for floating window scaling calculations.
 *
 * Centralizes all the logic for converting between graph coordinates and screen coordinates,
 * and for determining which scaling strategy to use (CSS transform vs dimension scaling).
 *
 * Background: xterm.js has a known bug where CSS transform: scale() breaks text selection
 * because getBoundingClientRect() returns post-transform coords but internal coords are pre-transform.
 * The workaround is to scale dimensions/font-size directly instead of using CSS transform.
 * However, at very low zoom levels (<0.5), we switch back to CSS transform since text selection
 * isn't practical anyway and dimension scaling produces unusably small fonts.
 */

// =============================================================================
// Types
// =============================================================================

export type ScalingStrategy = 'css-transform' | 'dimension-scaling';
export type WindowType = 'Terminal' | 'Editor';

export interface Position {
    readonly x: number;
    readonly y: number;
}

export interface Dimensions {
    readonly width: number;
    readonly height: number;
}

// =============================================================================
// Constants
// =============================================================================

/** Zoom threshold below which terminals switch to CSS transform scaling */
export const TERMINAL_CSS_TRANSFORM_THRESHOLD: number = 0.5;

/** Base font size for terminal text (scaled by zoom in dimension-scaling mode) */
export const TERMINAL_BASE_FONT_SIZE: number = 10;

// =============================================================================
// Core Strategy Function
// =============================================================================

/**
 * Determine which scaling strategy to use for a floating window.
 *
 * - Editors: Always use CSS transform (CodeMirror doesn't have the selection bug)
 * - Terminals at zoom >= 0.5: Use dimension scaling (fixes xterm text selection)
 * - Terminals at zoom < 0.5: Use CSS transform (text selection impractical at this zoom)
 */
export function getScalingStrategy(windowType: WindowType, zoom: number): ScalingStrategy {
    if (windowType === 'Editor') {
        return 'css-transform';
    }
    // Terminal
    return zoom >= TERMINAL_CSS_TRANSFORM_THRESHOLD ? 'dimension-scaling' : 'css-transform';
}

// =============================================================================
// Position Conversions
// =============================================================================

/**
 * Convert graph coordinates to screen coordinates (for positioning in overlay).
 * Screen position = graph position * zoom
 */
export function graphToScreenPosition(graphPos: Position, zoom: number): Position {
    return {
        x: graphPos.x * zoom,
        y: graphPos.y * zoom,
    };
}

/**
 * Convert screen coordinates to graph coordinates.
 * Graph position = screen position / zoom
 */
export function screenToGraphPosition(screenPos: Position, zoom: number): Position {
    return {
        x: screenPos.x / zoom,
        y: screenPos.y / zoom,
    };
}

// =============================================================================
// Dimension Calculations
// =============================================================================

/**
 * Get the CSS dimensions to apply to a floating window element.
 *
 * CSS transform mode: Use base dimensions (CSS transform handles visual scaling)
 * Dimension scaling mode: Multiply base by zoom
 */
export function getScreenDimensions(
    baseDimensions: Dimensions,
    zoom: number,
    strategy: ScalingStrategy
): Dimensions {
    if (strategy === 'css-transform') {
        return baseDimensions;
    }
    // dimension-scaling
    return {
        width: baseDimensions.width * zoom,
        height: baseDimensions.height * zoom,
    };
}

/**
 * Convert screen dimensions (from offsetWidth/offsetHeight) to graph dimensions.
 * Used for shadow node sizing.
 *
 * CSS transform mode: Screen dims ARE graph dims (no conversion needed)
 * Dimension scaling mode: Divide by zoom to get graph dims
 */
export function screenToGraphDimensions(
    screenDimensions: Dimensions,
    zoom: number,
    strategy: ScalingStrategy
): Dimensions {
    if (strategy === 'css-transform') {
        return screenDimensions;
    }
    // dimension-scaling
    return {
        width: screenDimensions.width / zoom,
        height: screenDimensions.height / zoom,
    };
}

// =============================================================================
// Font Size Calculations
// =============================================================================

/**
 * Get the font size for terminal text based on zoom and scaling strategy.
 *
 * Dimension scaling mode: Scale font with zoom
 * CSS transform mode: Use base font (CSS transform handles visual scaling)
 */
export function getTerminalFontSize(zoom: number, strategy: ScalingStrategy): number {
    if (strategy === 'css-transform') {
        return TERMINAL_BASE_FONT_SIZE;
    }
    return Math.round(TERMINAL_BASE_FONT_SIZE * zoom);
}

// =============================================================================
// CSS Transform String Generation
// =============================================================================

export type TransformOrigin = 'center' | 'top-center';

/**
 * Generate the CSS transform string for a floating window.
 *
 * @param strategy - Which scaling mode is active
 * @param zoom - Current graph zoom level
 * @param origin - Where to anchor the transform ('center' for anchored windows, 'top-center' for hover editors)
 */
export function getWindowTransform(
    strategy: ScalingStrategy,
    zoom: number,
    origin: TransformOrigin = 'center'
): string {
    const translate: string = origin === 'top-center' ? 'translateX(-50%)' : 'translate(-50%, -50%)';

    if (strategy === 'css-transform') {
        return `${translate} scale(${zoom})`;
    }
    // dimension-scaling: no scale, just translate for centering
    return translate;
}

/**
 * Get the CSS transform-origin value for a given origin type.
 */
export function getTransformOrigin(origin: TransformOrigin): string {
    return origin === 'top-center' ? 'top center' : 'center center';
}

// =============================================================================
// Terminal Scroll Preservation (pure calculations)
// =============================================================================

/**
 * Terminal buffer state needed for scroll calculations
 */
export interface TerminalBufferState {
    readonly baseY: number;
    readonly viewportY: number;
}

/**
 * Calculate scroll offset from buffer state.
 * This represents how many lines the user has scrolled up from the bottom.
 */
export function getScrollOffset(buffer: TerminalBufferState): number {
    return buffer.baseY - buffer.viewportY;
}

/**
 * Calculate the target line to scroll to after a resize/fit operation.
 * Returns the line that maintains the same relative scroll position.
 */
export function getScrollTargetLine(newBaseY: number, scrollOffset: number): number {
    const targetLine: number = newBaseY - scrollOffset;
    return targetLine >= 0 ? targetLine : 0;
}

// =============================================================================
// Viewport/Mouse Coordinate Conversions (for drag handling)
// =============================================================================

/**
 * Convert viewport (client) coordinates to graph coordinates.
 * Used when handling mouse events during dragging.
 */
export function viewportToGraphPosition(
    clientX: number,
    clientY: number,
    pan: Position,
    zoom: number
): Position {
    return {
        x: (clientX - pan.x) / zoom,
        y: (clientY - pan.y) / zoom,
    };
}

/**
 * Convert graph coordinates to viewport (client) coordinates.
 * Used when calculating drag offsets.
 */
export function graphToViewportPosition(
    graphPos: Position,
    pan: Position,
    zoom: number
): Position {
    return {
        x: (graphPos.x * zoom) + pan.x,
        y: (graphPos.y * zoom) + pan.y,
    };
}
