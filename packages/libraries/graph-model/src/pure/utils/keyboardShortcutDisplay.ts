/**
 * Utility functions for displaying keyboard shortcuts with platform-specific symbols
 */

export type ShortcutPlatform = 'mac' | 'non-mac';

export function platformFromRuntimePlatform(platform: string | undefined): ShortcutPlatform {
    return /darwin|mac|iphone|ipad|ipod/i.test(platform ?? '') ? 'mac' : 'non-mac';
}

/**
 * Detects if the explicit shortcut platform is macOS
 */
export function isMacPlatform(platform: ShortcutPlatform): boolean {
    return platform === 'mac';
}

/**
 * Returns the appropriate modifier key symbol for the provided platform
 * @returns '⌘' for Mac, 'Ctrl' for Windows/Linux
 */
export function getModifierSymbol(platform: ShortcutPlatform): string {
    return isMacPlatform(platform) ? '⌘' : 'Ctrl';
}

/**
 * Formats a keyboard shortcut for display with special key handling
 * @param key - The key (e.g., 'N', 'Enter', 'Backspace', '1', '[', ']')
 * @param platform - The runtime platform supplied by the UI shell
 * @param modifier - Whether to include the modifier key (default: true)
 * @returns Formatted shortcut string (e.g., '⌘N' on Mac, 'Ctrl+N' on Windows)
 */
export function formatShortcut(key: string, platform: ShortcutPlatform, modifier: boolean = true): string {
    const isMac = isMacPlatform(platform);
    const modifierSymbol = getModifierSymbol(platform);
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
export function getSpecialKeySymbol(key: 'backspace' | 'enter' | 'option', platform: ShortcutPlatform): string {
    const isMac = isMacPlatform(platform);

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
