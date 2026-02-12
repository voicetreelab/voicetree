/**
 * Folder scanning functions for the folder selector UI.
 *
 * Shell layer functions that scan the filesystem and use pure transforms
 * to produce the final available folders list.
 */

import { promises as fs } from 'fs';
import type { Stats, Dirent } from 'fs';
import path from 'path';
import normalizePath from 'normalize-path';
import type { AbsolutePath, AvailableFolderItem } from '@/pure/folders/types';
import { toAbsolutePath } from '@/pure/folders/types';
import { getAvailableFolders, parseSearchQuery } from '@/pure/folders/transforms';
import type { ParsedQuery } from '@/pure/folders/transforms';
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
        const realProjectRoot: string = await fs.realpath(projectRoot);
        const realTargetPath: string = await fs.realpath(targetPath);

        // Must be within project root (prevents "../" escapes)
        if (
            !realTargetPath.startsWith(realProjectRoot + '/') &&
            realTargetPath !== realProjectRoot
        ) {
            return false;
        }

        // Must be a directory
        const stat: Stats = await fs.stat(realTargetPath);
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
        const rootStat: Stats = await fs.stat(projectRoot);
        results.push({
            path: projectRoot,
            modifiedAt: rootStat.mtime.getTime(),
        });

        // Read directory entries
        const entries: Dirent[] = await fs.readdir(projectRoot, { withFileTypes: true });

        // Filter for directories only and get their stats
        for (const entry of entries) {
            if (entry.isDirectory()) {
                // Skip hidden directories (starting with .)
                if (entry.name.startsWith('.')) continue;

                const fullPath: string = normalizePath(path.join(projectRoot, entry.name));
                try {
                    const stat: Stats = await fs.stat(fullPath);
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
 * Supports absolute paths: typing "/Users/bob/external/" scans that directory directly.
 *
 * Uses parseSearchQuery to determine:
 * - Which directory to scan (basePath or project root)
 * - What text to filter results by (filterText)
 * - Whether the path is absolute (isAbsolute)
 */
export async function getAvailableFoldersForSelector(
    searchQuery: string
): Promise<readonly AvailableFolderItem[]> {
    const projectRoot: string | null = getProjectRootWatchedDirectory();
    if (!projectRoot) return [];

    const vaultPaths: readonly string[] = await getVaultPaths();
    const loadedPaths: readonly AbsolutePath[] = vaultPaths.map((p: string) => toAbsolutePath(p));

    // Parse the search query to determine scan target
    const parsed: ParsedQuery = parseSearchQuery(searchQuery);

    // Absolute path: scan the directory directly (not relative to project root)
    if (parsed.isAbsolute && parsed.basePath) {
        try {
            const stat: Stats = await fs.stat(parsed.basePath);
            if (!stat.isDirectory()) return [];
        } catch {
            return []; // Path doesn't exist
        }

        const subfolders: readonly { path: AbsolutePath; modifiedAt: number }[] =
            await getSubfoldersWithModifiedAt(toAbsolutePath(parsed.basePath));
        return getAvailableFolders(
            toAbsolutePath(parsed.basePath),
            loadedPaths,
            subfolders,
            searchQuery,
            parsed.filterText
        );
    }

    // Relative path handling
    let scanRoot: AbsolutePath;
    let filterText: string;

    if (parsed.basePath) {
        // User typed a relative path - scan that subdirectory
        const targetPath: string = path.join(projectRoot, parsed.basePath);

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
    const subfolders: readonly { path: AbsolutePath; modifiedAt: number }[] =
        await getSubfoldersWithModifiedAt(scanRoot);

    // Filter and format results
    return getAvailableFolders(
        toAbsolutePath(projectRoot), // projectRoot for display paths
        loadedPaths,
        subfolders,
        searchQuery,
        filterText // Use filterText for actual filtering
    );
}
