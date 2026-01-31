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
import { getAvailableFolders } from '@/pure/folders/transforms';
import { getProjectRootWatchedDirectory } from '@/shell/edge/main/state/watch-folder-store';
import { getVaultPaths } from './vault-allowlist';

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
 * Get available folders for the folder selector dropdown.
 * Returns folders not in loadedPaths, filtered by searchQuery.
 *
 * Internal function that combines:
 * 1. Filesystem scanning (shell layer)
 * 2. Pure filtering/sorting logic (from transforms)
 */
async function getAvailableFoldersForSelectorCore(
    projectRoot: AbsolutePath,
    loadedPaths: readonly AbsolutePath[],
    searchQuery: string
): Promise<readonly AvailableFolderItem[]> {
    // 1. Scan filesystem for subfolders with modification timestamps
    const allSubfolders = await getSubfoldersWithModifiedAt(projectRoot);

    // 2. Use pure transform to filter and sort
    return getAvailableFolders(projectRoot, loadedPaths, allSubfolders, searchQuery);
}

/**
 * IPC-exposed function for getting available folders.
 * Gets project root and loaded paths from state, then delegates to core function.
 */
export async function getAvailableFoldersForSelector(
    searchQuery: string
): Promise<readonly AvailableFolderItem[]> {
    const projectRoot = getProjectRootWatchedDirectory();
    if (!projectRoot) return [];

    const vaultPaths = await getVaultPaths();
    const loadedPaths = vaultPaths.map(p => toAbsolutePath(p));

    return getAvailableFoldersForSelectorCore(
        toAbsolutePath(projectRoot),
        loadedPaths,
        searchQuery
    );
}
