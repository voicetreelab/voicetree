/**
 * Pure transform functions for folder management.
 * These functions are used by the folder selector UI component.
 */

import type {
    AbsolutePath,
    AvailableFolderItem,
    FolderAction,
    FolderSelectorState,
    LoadedFolderItem,
} from './types';
import type { VaultConfig } from '@/pure/settings/types';

/**
 * Convert absolute path to display-friendly relative path.
 * Returns "." for project root, otherwise returns relative path.
 */
export function toDisplayPath(projectRoot: AbsolutePath, absolutePath: AbsolutePath): string {
    // Normalize paths to use forward slashes
    const normalizedAbsolutePath: string = absolutePath.replace(/\\/g, '/');
    const normalizedProjectRoot: string = (projectRoot as string).replace(/\\/g, '/');

    // Return "." if paths are equal (project root)
    if (normalizedAbsolutePath === normalizedProjectRoot) {
        return '.';
    }

    // Return relative path if absolutePath is inside project root
    if (normalizedAbsolutePath.startsWith(normalizedProjectRoot + '/')) {
        return normalizedAbsolutePath.slice(normalizedProjectRoot.length + 1);
    }

    // Fallback: return the absolute path as-is
    return absolutePath;
}

/**
 * Get available folders (not loaded), sorted by modification date.
 * - Filters out folders already in loadedPaths
 * - If searchQuery is empty: returns max 5 folders sorted by modifiedAt (desc), root "/" always first
 * - If searchQuery has text: filters by query (case-insensitive), no limit, sorted by modifiedAt
 */
export function getAvailableFolders(
    projectRoot: AbsolutePath,
    loadedPaths: readonly AbsolutePath[],
    allSubfolders: readonly { path: AbsolutePath; modifiedAt: number }[],
    searchQuery: string
): readonly AvailableFolderItem[] {
    // Filter out already loaded paths
    const loadedPathSet = new Set<string>(loadedPaths);
    let filtered: { path: AbsolutePath; modifiedAt: number }[] = allSubfolders.filter(
        (folder) => !loadedPathSet.has(folder.path)
    );

    // If searchQuery is provided, filter by query (case-insensitive)
    if (searchQuery.trim() !== '') {
        const lowerQuery: string = searchQuery.toLowerCase();
        filtered = filtered.filter((folder) => {
            const displayPath: string = toDisplayPath(projectRoot, folder.path);
            return displayPath.toLowerCase().includes(lowerQuery);
        });
    }

    // Sort by modifiedAt descending (most recent first)
    filtered.sort((a, b) => b.modifiedAt - a.modifiedAt);

    // If no search query, ensure root appears first and limit to 5
    if (searchQuery.trim() === '') {
        // Find root folder
        const rootIndex: number = filtered.findIndex(
            (folder) => folder.path === projectRoot
        );

        if (rootIndex > 0) {
            // Move root to front
            const [rootFolder] = filtered.splice(rootIndex, 1);
            filtered.unshift(rootFolder);
        }

        // Limit to 5 items
        filtered = filtered.slice(0, 5);
    }

    // Convert to AvailableFolderItem
    return filtered.map((folder) => ({
        absolutePath: folder.path,
        displayPath: toDisplayPath(projectRoot, folder.path),
        modifiedAt: folder.modifiedAt,
    }));
}

/**
 * Handle folder actions immutably. Returns new VaultConfig.
 * Only handles folder config actions; UI-only actions return original config.
 */
export function reduceFolderConfig(
    config: VaultConfig,
    action: FolderAction,
    projectRoot: AbsolutePath
): VaultConfig {
    switch (action.type) {
        case 'RESET_WRITE_TO_ROOT': {
            // Set writeFolder to projectRoot
            return {
                ...config,
                writePath: projectRoot,
            };
        }

        case 'REMOVE_READ_FOLDER': {
            // Remove from readPaths
            return {
                ...config,
                readPaths: config.readPaths.filter((path) => path !== action.path),
            };
        }

        case 'SET_AS_WRITE': {
            const newWritePath: string = action.path;
            const oldWritePath: string = config.writePath;

            // If same path, no change needed
            if (newWritePath === oldWritePath) {
                return config;
            }

            // Remove new write path from readPaths if it was there
            let newReadPaths: readonly string[] = config.readPaths.filter(
                (path) => path !== newWritePath
            );

            // Add old write path to readPaths (if different from new)
            newReadPaths = [...newReadPaths, oldWritePath];

            return {
                ...config,
                writePath: newWritePath,
                readPaths: newReadPaths,
            };
        }

        case 'ADD_AS_READ': {
            // Don't add duplicates
            if (config.readPaths.includes(action.path)) {
                return config;
            }

            return {
                ...config,
                readPaths: [...config.readPaths, action.path],
            };
        }

        // UI-only actions - return config unchanged
        case 'SET_SEARCH_QUERY':
        case 'BROWSE_EXTERNAL':
        case 'TOGGLE_DROPDOWN':
        case 'CLOSE_DROPDOWN':
            return config;
    }
}

/**
 * Convert raw data to UI state object (FolderSelectorState).
 */
export function toFolderSelectorState(
    projectRoot: AbsolutePath,
    writeFolder: AbsolutePath,
    readFolders: readonly AbsolutePath[],
    availableFolders: readonly AvailableFolderItem[],
    searchQuery: string,
    isOpen: boolean
): FolderSelectorState {
    // Convert writeFolder to LoadedFolderItem
    const writeFolderItem: LoadedFolderItem = {
        absolutePath: writeFolder,
        displayPath: toDisplayPath(projectRoot, writeFolder),
    };

    // Convert readFolders to LoadedFolderItem[]
    const readFolderItems: readonly LoadedFolderItem[] = readFolders.map((folder) => ({
        absolutePath: folder,
        displayPath: toDisplayPath(projectRoot, folder),
    }));

    return {
        projectRoot,
        writeFolder: writeFolderItem,
        readFolders: readFolderItems,
        searchQuery,
        availableFolders,
        isOpen,
        isLoading: false,
        error: null,
    };
}
