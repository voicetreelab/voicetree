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
    FolderTreeNode,
    FileTreeNode,
} from './types';
import type { VaultConfig } from '../settings/types';

/**
 * Result of parsing a search query for folder navigation.
 */
export interface ParsedQuery {
    readonly basePath: string | null;   // Directory to scan (e.g., "docs/projects")
    readonly filterText: string;         // Text after last slash (e.g., "au")
    readonly endsWithSlash: boolean;     // Whether query ends with "/"
    readonly isAbsolute: boolean;        // Whether the original query was an absolute path (started with /)
}

/**
 * Parse a search query to extract directory path and filter text.
 * Used for lazy path expansion in folder navigation.
 *
 * Examples:
 * - "" → { basePath: null, filterText: "", endsWithSlash: false, isAbsolute: false }
 * - "docs" → { basePath: null, filterText: "docs", endsWithSlash: false, isAbsolute: false }
 * - "docs/" → { basePath: "docs", filterText: "", endsWithSlash: true, isAbsolute: false }
 * - "/Users/bob/docs/" → { basePath: "/Users/bob/docs", filterText: "", endsWithSlash: true, isAbsolute: true }
 */
export function parseSearchQuery(query: string): ParsedQuery {
    // Detect absolute paths before normalization
    const isAbsolute: boolean = query.trimStart().startsWith('/');

    // Normalize: convert backslashes to forward slashes
    const withForwardSlashes: string = query.replace(/\\/g, '/');

    // For absolute paths, preserve the leading slash; for relative, strip it
    const withoutLeadingSlash: string = isAbsolute
        ? withForwardSlashes
        : withForwardSlashes.replace(/^\/+/, '');

    // Collapse multiple consecutive slashes into one
    const normalized: string = withoutLeadingSlash.replace(/\/+/g, '/');

    // Check if ends with slash
    const endsWithSlash: boolean = normalized.endsWith('/');

    // Remove trailing slash for parsing
    const trimmed: string = endsWithSlash ? normalized.slice(0, -1) : normalized;

    // If ends with slash, the entire normalized path is the basePath
    if (endsWithSlash) {
        return {
            basePath: trimmed || null,
            filterText: '',
            endsWithSlash: true,
            isAbsolute,
        };
    }

    // Find last slash to split basePath and filterText
    const lastSlashIndex: number = trimmed.lastIndexOf('/');

    if (lastSlashIndex === -1) {
        return {
            basePath: null,
            filterText: trimmed,
            endsWithSlash: false,
            isAbsolute,
        };
    }

    // Has slash: split into basePath and filterText
    const basePath: string = trimmed.slice(0, lastSlashIndex);
    const filterText: string = trimmed.slice(lastSlashIndex + 1);

    return {
        basePath: basePath || null,
        filterText,
        endsWithSlash: false,
        isAbsolute,
    };
}

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
 * - If searchQuery is empty: returns all folders sorted by modifiedAt (desc), root "/" always first
 * - If searchQuery has text: filters by query (case-insensitive), no limit, sorted by modifiedAt
 * - filterText: optional filter text to use instead of searchQuery for filtering (for nested path scanning)
 */
export function getAvailableFolders(
    projectRoot: AbsolutePath,
    loadedPaths: readonly AbsolutePath[],
    allSubfolders: readonly { readonly path: AbsolutePath; readonly modifiedAt: number }[],
    searchQuery: string,
    filterText?: string  // If provided, use this for filtering instead of searchQuery
): readonly AvailableFolderItem[] {
    // Filter out already loaded paths
    const loadedPathSet: ReadonlySet<string> = new Set<string>(loadedPaths);
    const notLoaded: readonly { readonly path: AbsolutePath; readonly modifiedAt: number }[] = allSubfolders.filter(
        (folder) => !loadedPathSet.has(folder.path)
    );

    // Determine the actual filter to use
    // If filterText is provided explicitly, use it; otherwise fall back to searchQuery
    const actualFilter: string = filterText ?? searchQuery;

    // If actualFilter is provided, filter by it (case-insensitive)
    const filtered: readonly { readonly path: AbsolutePath; readonly modifiedAt: number }[] = actualFilter.trim() !== ''
        ? notLoaded.filter((folder) => {
            const displayPath: string = toDisplayPath(projectRoot, folder.path);
            return displayPath.toLowerCase().includes(actualFilter.toLowerCase());
        })
        : notLoaded;

    // Sort by modifiedAt descending (most recent first)
    const sorted: readonly { readonly path: AbsolutePath; readonly modifiedAt: number }[] =
        [...filtered].sort((a: { readonly modifiedAt: number }, b: { readonly modifiedAt: number }) => b.modifiedAt - a.modifiedAt);

    // If no search query, ensure root appears first (UI handles display limiting)
    const result: readonly { readonly path: AbsolutePath; readonly modifiedAt: number }[] = searchQuery.trim() === ''
        ? (() => {
            const rootIndex: number = sorted.findIndex(
                (folder) => folder.path === projectRoot
            );
            return rootIndex > 0
                ? [sorted[rootIndex], ...sorted.slice(0, rootIndex), ...sorted.slice(rootIndex + 1)]
                : sorted;
        })()
        : sorted;

    // Convert to AvailableFolderItem
    return result.map((folder) => ({
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

            // Remove new write path from readPaths, then add old write path
            const newReadPaths: readonly string[] = [
                ...config.readPaths.filter((path) => path !== newWritePath),
                oldWritePath,
            ];

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

/**
 * Filter readPaths to those NOT under projectRoot. PURE.
 */
export function getExternalReadPaths(
    readPaths: readonly string[],
    projectRoot: string
): readonly string[] {
    const normalizedRoot: string = projectRoot.endsWith('/') ? projectRoot : projectRoot + '/';
    return readPaths.filter((p: string) => !p.startsWith(normalizedRoot) && p !== projectRoot);
}

// ============================================================
// FOLDER TREE TRANSFORMS
// ============================================================

/**
 * A flat directory entry from the recursive scanner.
 * Used as input to buildFolderTree.
 */
export interface DirectoryEntry {
    readonly absolutePath: AbsolutePath;
    readonly name: string;
    readonly isDirectory: boolean;
    readonly children?: readonly DirectoryEntry[];
}

/**
 * Build a hierarchical FolderTreeNode from a recursive directory listing.
 *
 * Pure function: takes flat scan data + state, produces tree with UI annotations
 * (loadState, isWriteTarget, isInGraph).
 */
export function buildFolderTree(
    entry: DirectoryEntry,
    loadedPaths: ReadonlySet<string>,
    writePath: AbsolutePath | null,
    graphFilePaths: ReadonlySet<string>,
): FolderTreeNode {
    const children: readonly (FolderTreeNode | FileTreeNode)[] = (entry.children ?? []).map(
        (child: DirectoryEntry): FolderTreeNode | FileTreeNode => {
            if (child.isDirectory) {
                return buildFolderTree(child, loadedPaths, writePath, graphFilePaths);
            }
            return {
                name: child.name,
                absolutePath: child.absolutePath,
                isInGraph: graphFilePaths.has(child.absolutePath),
            } satisfies FileTreeNode;
        }
    );

    // Sort: folders first (loaded folders before non-loaded), then files — alphabetical within each group
    const sorted: readonly (FolderTreeNode | FileTreeNode)[] = [...children].sort(
        (a: FolderTreeNode | FileTreeNode, b: FolderTreeNode | FileTreeNode): number => {
            const aIsDir: boolean = 'children' in a;
            const bIsDir: boolean = 'children' in b;
            if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
            // Among directories, loaded folders come first
            if (aIsDir && bIsDir) {
                const aLoaded: boolean = (a as FolderTreeNode).loadState === 'loaded';
                const bLoaded: boolean = (b as FolderTreeNode).loadState === 'loaded';
                if (aLoaded !== bLoaded) return aLoaded ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        }
    );

    return {
        name: entry.name,
        absolutePath: entry.absolutePath,
        children: sorted,
        loadState: loadedPaths.has(entry.absolutePath) ? 'loaded' : 'not-loaded',
        isWriteTarget: writePath === entry.absolutePath,
    };
}
