/**
 * electron-trackpad-detect
 *
 * Native addon for detecting trackpad vs mouse wheel scroll on macOS.
 *
 * Usage in Electron main process:
 *   const { startMonitoring, isTrackpadScroll } = require('electron-trackpad-detect');
 *   startMonitoring();
 *   // In your input-event handler:
 *   const isTrackpad = isTrackpadScroll();
 */

const path = require('path');

// Only load native module on macOS
const isMac = process.platform === 'darwin';

let nativeModule = null;

if (isMac) {
    try {
        // Try to load the native addon
        nativeModule = require('./build/Release/trackpad_detect.node');
    } catch (e) {
        console.warn('[electron-trackpad-detect] Failed to load native addon:', e.message);
        console.warn('[electron-trackpad-detect] Falling back to stub implementation');
    }
}

/**
 * Start monitoring scroll wheel events.
 * Must be called from the main Electron process before any scroll detection.
 * @returns {boolean} true if monitoring started successfully
 */
function startMonitoring() {
    if (nativeModule) {
        return nativeModule.startMonitoring();
    }
    return false;
}

/**
 * Stop monitoring scroll wheel events.
 * Call this when the app is shutting down or monitoring is no longer needed.
 */
function stopMonitoring() {
    if (nativeModule) {
        nativeModule.stopMonitoring();
    }
}

/**
 * Check if the last scroll event was from a trackpad.
 * @returns {boolean} true for trackpad/Magic Mouse, false for traditional mouse wheel
 */
function isTrackpadScroll() {
    if (nativeModule) {
        return nativeModule.isTrackpadScroll();
    }
    // On non-macOS or if native module failed to load, default to false
    return false;
}

/**
 * Check if monitoring is currently active.
 * @returns {boolean} true if monitoring is active
 */
function isMonitoring() {
    if (nativeModule) {
        return nativeModule.isMonitoring();
    }
    return false;
}

module.exports = {
    startMonitoring,
    stopMonitoring,
    isTrackpadScroll,
    isMonitoring
};
