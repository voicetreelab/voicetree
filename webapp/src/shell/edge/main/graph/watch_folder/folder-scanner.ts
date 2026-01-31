/**
 * Folder scanning functions for the folder selector UI.
 *
 * Shell layer functions that scan the filesystem and use pure transforms
 * to produce the final available folders list.
 */

import { promises as fs } from 'fs';
import path from 'path';
import normalizePath from 'normalize-path';
import type { AbsolutePath, AvailableFolderItem } from '@/pure/folders/types';
import { toAbsolutePath } from '@/pure/folders/types';
import { getAvailableFolders, parseSearchQuery } from '@/pure/folders/transforms';
import { getProjectRootWatchedDirectory } from '@/shell/edge/main/state/watch-folder-store';
import { getVaultPaths } from './vault-allowlist';

/**
 * Security validation: ensure target path is within project root.
 * Prevents directory traversal attacks (../ escapes) and symlink escapes.
 *
 * @param projectRoot - The trusted root directory
 * @param targetPath - The path to validate
 * @returns true if targetPath is a valid subdirectory of projectRoot
 */
export async function isValidSubdirectory(
    projectRoot: string,
    targetPath: string
): Promise<boolean> {
    try {
        const realProjectRoot = await fs.realpath(projectRoot);
        const realTargetPath = await fs.realpath(targetPath);

        // Must be within project root (prevents "../" escapes)
        if (
            !realTargetPath.startsWith(realProjectRoot + '/') &&
            realTargetPath !== realProjectRoot
        ) {
            return false;
        }

        // Must be a directory
        const stat = await fs.stat(realTargetPath);
        return stat.isDirectory();
    } catch {
        return false; // Path doesn't exist or can't access
    }
}

/**
 * Scan project root for immediate subfolders with modification timestamps.
 * Returns folders sorted by modifiedAt descending (most recent first).
 * Includes the root folder itself.
 */
export async function getSubfoldersWithModifiedAt(
    projectRoot: AbsolutePath
): Promise<readonly { path: AbsolutePath; modifiedAt: number }[]> {
    const results: { path: AbsolutePath; modifiedAt: number }[] = [];

    try {
        // Include the root folder itself
        const rootStat = await fs.stat(projectRoot);
        results.push({
            path: projectRoot,
            modifiedAt: rootStat.mtime.getTime(),
        });

        // Read directory entries
        const entries = await fs.readdir(projectRoot, { withFileTypes: true });

        // Filter for directories only and get their stats
        for (const entry of entries) {
            if (entry.isDirectory()) {
                // Skip hidden directories (starting with .)
                if (entry.name.startsWith('.')) continue;

                const fullPath = normalizePath(path.join(projectRoot, entry.name));
                try {
                    const stat = await fs.stat(fullPath);
                    results.push({
                        path: toAbsolutePath(fullPath),
                        modifiedAt: stat.mtime.getTime(),
                    });
                } catch {
                    // Skip folders we can't stat (permission issues, etc.)
                }
            }
        }

        // Sort by modifiedAt descending (most recent first)
        results.sort((a, b) => b.modifiedAt - a.modifiedAt);
    } catch {
        // On any error, return empty array
        return [];
    }

    return results;
}

/**
 * IPC-exposed function for getting available folders.
 * Supports lazy path expansion: typing "docs/" scans the docs subdirectory.
 *
 * Uses parseSearchQuery to determine:
 * - Which directory to scan (basePath or project root)
 * - What text to filter results by (filterText)
 */
export async function getAvailableFoldersForSelector(
    searchQuery: string
): Promise<readonly AvailableFolderItem[]> {
    const projectRoot = getProjectRootWatchedDirectory();
    if (!projectRoot) return [];

    const vaultPaths = await getVaultPaths();
    const loadedPaths = vaultPaths.map(p => toAbsolutePath(p));

    // Parse the search query to determine scan target
    const parsed = parseSearchQuery(searchQuery);

    let scanRoot: AbsolutePath;
    let filterText: string;

    if (parsed.basePath) {
        // User typed a path - scan that subdirectory
        const targetPath = path.join(projectRoot, parsed.basePath);

        // Security: validate path is within project
        if (!(await isValidSubdirectory(projectRoot, targetPath))) {
            return []; // Invalid or non-existent path
        }

        scanRoot = toAbsolutePath(targetPath);
        filterText = parsed.filterText;
    } else {
        // No path separator - scan project root
        scanRoot = toAbsolutePath(projectRoot);
        filterText = searchQuery;
    }

    // Scan the determined directory
    const subfolders = await getSubfoldersWithModifiedAt(scanRoot);

    // Filter and format results
    return getAvailableFolders(
        toAbsolutePath(projectRoot), // projectRoot for display paths
        loadedPaths,
        subfolders,
        searchQuery,
        filterText // Use filterText for actual filtering
    );
}
