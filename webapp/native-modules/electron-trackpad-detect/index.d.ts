/**
 * electron-trackpad-detect
 *
 * Native addon for detecting trackpad vs mouse wheel scroll on macOS.
 */

/**
 * Start monitoring scroll wheel events.
 * Must be called from the main Electron process before any scroll detection.
 * @returns true if monitoring started successfully
 */
export function startMonitoring(): boolean;

/**
 * Stop monitoring scroll wheel events.
 * Call this when the app is shutting down or monitoring is no longer needed.
 */
export function stopMonitoring(): void;

/**
 * Check if the last scroll event was from a trackpad.
 * Uses macOS NSEvent.hasPreciseScrollingDeltas under the hood.
 * @returns true for trackpad/Magic Mouse (continuous), false for traditional mouse wheel (discrete)
 */
export function isTrackpadScroll(): boolean;

/**
 * Check if monitoring is currently active.
 * @returns true if monitoring is active
 */
export function isMonitoring(): boolean;
