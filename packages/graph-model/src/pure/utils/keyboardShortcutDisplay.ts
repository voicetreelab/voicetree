/**
 * Utility functions for displaying keyboard shortcuts with platform-specific symbols
 */

/**
 * Detects if the current platform is macOS
 */
export function isMacPlatform(): boolean {
    if (typeof navigator !== 'undefined' && typeof navigator.platform === 'string') {
        return navigator.platform.toLowerCase().includes('mac');
    }
    if (typeof process !== 'undefined' && process.platform) {
        return process.platform === 'darwin';
    }
    return false;
}

/**
 * Returns the appropriate modifier key symbol for the current platform
 * @returns '⌘' for Mac, 'Ctrl' for Windows/Linux
 */
export function getModifierSymbol(): string {
    return isMacPlatform() ? '⌘' : 'Ctrl';
}

/**
 * Formats a keyboard shortcut for display with special key handling
 * @param key - The key (e.g., 'N', 'Enter', 'Backspace', '1', '[', ']')
 * @param modifier - Whether to include the modifier key (default: true)
 * @returns Formatted shortcut string (e.g., '⌘N' on Mac, 'Ctrl+N' on Windows)
 */
export function formatShortcut(key: string, modifier: boolean = true): string {
    const isMac = isMacPlatform();
    const modifierSymbol = getModifierSymbol();
    const separator = isMac ? '' : '+';

    // Convert special key names to platform-specific symbols
    let displayKey: string;
    switch (key.toLowerCase()) {
        case 'backspace':
            displayKey = isMac ? '⌫' : 'Backspace';
            break;
        case 'enter':
        case 'return':
            displayKey = isMac ? '⏎' : 'Enter';
            break;
        case 'option':
        case 'alt':
            displayKey = isMac ? '⌥' : 'Alt';
            break;
        default:
            displayKey = key;
    }

    if (!modifier) {
        return displayKey;
    }

    return `${modifierSymbol}${separator}${displayKey}`;
}

/**
 * Gets platform-specific symbols for special keys
 */
export function getSpecialKeySymbol(key: 'backspace' | 'enter' | 'option'): string {
    const isMac = isMacPlatform();

    switch (key) {
        case 'backspace':
            return isMac ? '⌫' : 'Backspace';
        case 'enter':
            return isMac ? '⏎' : 'Enter';
        case 'option':
            return isMac ? '⌥' : 'Alt';
        default:
            return key;
    }
}
