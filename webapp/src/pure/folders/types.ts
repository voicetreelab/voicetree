/**
 * Folder management types for the VoiceTree UI folder selector component.
 * These types support the three-section design: WRITING TO, ALSO READING, ADD FOLDER.
 */

// ============================================================
// BRANDED TYPES
// ============================================================

/**
 * A branded type for absolute filesystem paths.
 * Provides compile-time safety to distinguish absolute paths from relative paths.
 */
export type AbsolutePath = string & { readonly __brand: 'AbsolutePath' };

/**
 * Type guard and constructor for AbsolutePath.
 * In runtime, this is just the identity function with a type assertion.
 */
export function toAbsolutePath(path: string): AbsolutePath {
    return path as AbsolutePath;
}

// ============================================================
// FOLDER ITEM TYPES
// ============================================================

/**
 * A folder that is currently loaded (either as write target or read source).
 * Displayed in WRITING TO or ALSO READING sections of the UI.
 */
export interface LoadedFolderItem {
    /** Absolute filesystem path to the folder */
    readonly absolutePath: AbsolutePath;
    /** Display path shown in UI (e.g., "notes" or "." for project root) */
    readonly displayPath: string;
}

/**
 * A folder available in project root but not currently loaded.
 * Displayed in ADD FOLDER section of the UI with [✎ Write] and [+ Read] buttons.
 */
export interface AvailableFolderItem {
    /** Absolute filesystem path to the folder */
    readonly absolutePath: AbsolutePath;
    /** Display path shown in UI (relative to project root) */
    readonly displayPath: string;
    /** Unix timestamp (ms) of last modification, used for sorting by recency */
    readonly modifiedAt: number;
}

// ============================================================
// UI STATE
// ============================================================

/**
 * Complete state for folder selector UI component.
 * Matches the 3-section design in ASCII Design V2:
 * - WRITING TO: Single write folder
 * - ALSO READING: List of read folders
 * - ADD FOLDER: Available folders with search
 */
export interface FolderSelectorState {
    /** Absolute path to the project root directory, or null if not set */
    readonly projectRoot: AbsolutePath | null;

    // === WRITING TO section ===
    /** The currently selected write folder, or null if using project root */
    readonly writeFolder: LoadedFolderItem | null;

    // === ALSO READING section ===
    /** List of additional folders being read (not including the write folder) */
    readonly readFolders: readonly LoadedFolderItem[];

    // === ADD FOLDER section ===
    /** Current search query for filtering available folders */
    readonly searchQuery: string;
    /** Available folders not currently loaded, sorted by modification date */
    readonly availableFolders: readonly AvailableFolderItem[];

    // === UI state ===
    /** Whether the folder selector dropdown is open */
    readonly isOpen: boolean;
    /** Whether folder data is currently being loaded */
    readonly isLoading: boolean;
    /** Error message if folder operation failed, or null */
    readonly error: string | null;
}

// ============================================================
// ACTION TYPES
// ============================================================

/**
 * All possible user interactions from the folder selector UI.
 * Explicit union type instead of conditional boolean flags.
 */
export type FolderAction =
    | { readonly type: 'RESET_WRITE_TO_ROOT' }                          // [−] on write folder
    | { readonly type: 'REMOVE_READ_FOLDER'; readonly path: AbsolutePath }  // [−] on read folder
    | { readonly type: 'SET_AS_WRITE'; readonly path: AbsolutePath }        // [✎ Write] or click read folder
    | { readonly type: 'ADD_AS_READ'; readonly path: AbsolutePath }         // [+ Read] button
    | { readonly type: 'SET_SEARCH_QUERY'; readonly query: string }         // Search input
    | { readonly type: 'BROWSE_EXTERNAL' }                              // [Browse external folder...]
    | { readonly type: 'TOGGLE_DROPDOWN' }                              // Toggle dropdown open/closed
    | { readonly type: 'CLOSE_DROPDOWN' };                              // Close dropdown
