/**
 * DarkModeManager - Manages dark mode state with settings persistence
 *
 * This module handles:
 * 1. Dark mode state management (singleton pattern)
 * 2. Settings persistence via hostAPI
 * 3. Document class toggling
 * 4. Callbacks for UI components that need to react to mode changes
 *
 * Following the project's "push impurity to edge" pattern - settings access is impure.
 */

import type {VTSettings} from '@vt/graph-model/settings';
// Import for Window.hostAPI type augmentation
import type {} from '@/shell/hostApi';

// Module-level state (singleton)
let currentDarkMode: boolean = false;
let storedCallbacks: DarkModeCallbacks | null = null;

/**
 * Callbacks that UI components provide to react to dark mode changes
 */
export interface DarkModeCallbacks {
    /** Called when dark mode state changes - use for updating graph styles */
    updateGraphStyles: () => void;
    /** Optional: Update speed dial menu icon */
    updateSpeedDialMenu?: (isDark: boolean) => void;
    /** Optional: Update search service theme */
    updateSearchTheme?: (isDark: boolean) => void;
}

/**
 * Apply dark mode to document
 */
function applyDarkModeToDocument(isDark: boolean): void {
    if (isDark) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
}

/**
 * Save dark mode setting to persistent storage
 */
async function saveDarkModeToSettings(): Promise<void> {
    const settings: VTSettings | null = await window.hostAPI?.main.loadSettings() ?? null;
    if (settings && window.hostAPI) {
        const updatedSettings: VTSettings = {...settings, darkMode: currentDarkMode};
        await window.hostAPI.main.saveSettings(updatedSettings);
    }
}

/**
 * Load dark mode from settings (async)
 * Returns the loaded value
 */
async function loadDarkModeFromSettings(): Promise<boolean | undefined> {
    const settings: VTSettings | null = await window.hostAPI?.main.loadSettings() ?? null;
    return settings?.darkMode;
}

/**
 * Initialize dark mode state
 *
 * @param initialValue - Optional initial value from options
 * @param callbacks - UI update callbacks
 * @returns Promise that resolves when settings have been loaded
 */
export async function initializeDarkMode(
    initialValue: boolean | undefined,
    callbacks: DarkModeCallbacks
): Promise<boolean> {
    storedCallbacks = callbacks;

    // Set initial value from options
    if (initialValue !== undefined) {
        currentDarkMode = initialValue;
    }

    // Apply initial state to document
    applyDarkModeToDocument(currentDarkMode);

    // Async load from settings (source of truth)
    const settingsValue: boolean | undefined = await loadDarkModeFromSettings();
    if (settingsValue !== undefined && settingsValue !== currentDarkMode) {
        currentDarkMode = settingsValue;
        applyDarkModeToDocument(currentDarkMode);

        // Trigger callbacks for UI updates
        callbacks.updateGraphStyles();
        callbacks.updateSpeedDialMenu?.(currentDarkMode);
    }

    return currentDarkMode;
}

/**
 * Toggle dark mode and persist to settings
 *
 * @param callbacks - UI update callbacks
 * @returns The new dark mode state
 */
export function toggleDarkMode(callbacks: DarkModeCallbacks): boolean {
    currentDarkMode = !currentDarkMode;

    // Apply to document
    applyDarkModeToDocument(currentDarkMode);

    // Save to settings (fire and forget)
    void saveDarkModeToSettings();

    // Trigger callbacks for UI updates
    callbacks.updateGraphStyles();
    callbacks.updateSearchTheme?.(currentDarkMode);
    callbacks.updateSpeedDialMenu?.(currentDarkMode);

    return currentDarkMode;
}

/**
 * Set dark mode to a specific value (no-op if already at that value).
 * Uses callbacks stored during initializeDarkMode. Does not persist to settings
 * — caller is responsible for saving if needed.
 */
export function setDarkMode(isDark: boolean): void {
    if (isDark === currentDarkMode) return;
    currentDarkMode = isDark;
    applyDarkModeToDocument(isDark);
    storedCallbacks?.updateGraphStyles();
    storedCallbacks?.updateSearchTheme?.(isDark);
    storedCallbacks?.updateSpeedDialMenu?.(isDark);
}

/**
 * Get current dark mode state
 */
export function isDarkMode(): boolean {
    return currentDarkMode;
}
