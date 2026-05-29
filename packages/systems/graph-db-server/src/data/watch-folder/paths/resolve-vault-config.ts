/**
 * Vault config resolution utilities.
 *
 * - resolveWriteFolderPath: Normalize a write path to an absolute, forward-slash path.
 * - resolveAllowlistForProject: Resolve the full vault path configuration for a project,
 *   filtering out stale paths that no longer exist on disk.
 */

import path from "path";
import { promises as fs } from "fs";
import normalizePath from "normalize-path";
import type { VaultConfig } from '@vt/graph-model/settings';
import { getExpandedFolderPathsForVault } from "../folder-visibility-active-view";
import {
    getVaultConfigForDirectory,
    hasLegacyReadPathsForDirectory,
} from "@vt/app-config/vault-config";

/**
 * Resolve a writeFolderPath to an absolute path with normalized separators.
 * If writeFolderPath is relative, it's resolved against watchedFolder.
 * If writeFolderPath is absolute, it's returned unchanged.
 * Always normalizes to forward slashes for cross-platform consistency.
 */
export function resolveWriteFolderPath(watchedFolder: string, writeFolderPath: string): string {
    const resolved: string = path.isAbsolute(writeFolderPath)
        ? writeFolderPath
        : path.join(watchedFolder, writeFolderPath);
    return normalizePath(resolved);
}

/**
 * Resolved vault configuration for loading.
 */
export interface ResolvedVaultConfig {
    /** Combined watch roots: writeFolderPath plus active-view expanded folder paths. */
    readonly allowlist: readonly string[];
    /** Main vault path for writing new nodes */
    readonly writeFolderPath: string;
}

export interface ResolveAllowlistOptions {
    readonly includeActiveViewExpandedPaths?: boolean;
}

export interface LegacyReadPathLogger {
    debug(message?: unknown, ...optionalParams: unknown[]): void
}

const defaultLegacyReadPathLogger: LegacyReadPathLogger = {
    debug(message?: unknown, ...optionalParams: unknown[]): void {
        console.debug(message, ...optionalParams);
    },
}

export async function logIgnoredLegacyReadPathsIfPresent(
    watchedDir: string,
    logger: LegacyReadPathLogger = defaultLegacyReadPathLogger,
): Promise<void> {
    if (await hasLegacyReadPathsForDirectory(watchedDir)) {
        logger.debug('[resolveAllowlistForProject] ignoring legacy readPaths from voicetree-config.json');
    }
}

/**
 * Resolve the vault path configuration for a project.
 *
 * If saved vault config exists, it is authoritative - use it directly.
 * This ensures user changes persist across reloads.
 *
 * If no saved config, return null so caller can attempt loading directly.
 */
export async function resolveAllowlistForProject(
    watchedDir: string,
    options: ResolveAllowlistOptions = {},
): Promise<ResolvedVaultConfig | null> {
    const savedVaultConfig: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);
    await logIgnoredLegacyReadPathsIfPresent(watchedDir);

    // If no saved config exists, return null so caller can attempt loading directly
    if (!savedVaultConfig?.writeFolderPath) {
        return null;
    }

    // Resolve writeFolderPath to absolute
    const absoluteWriteFolderPath: string = resolveWriteFolderPath(watchedDir, savedVaultConfig.writeFolderPath);

    // Check if writeFolderPath still exists on disk
    try {
        await fs.access(absoluteWriteFolderPath);
    } catch {
        // Write path no longer exists, return null to retry fresh
        return null;
    }

    if (options.includeActiveViewExpandedPaths === false) {
        return {
            allowlist: [absoluteWriteFolderPath],
            writeFolderPath: absoluteWriteFolderPath,
        };
    }

    // Filter expanded folder paths to those that still exist on disk
    // Normalize all paths to forward slashes for cross-platform consistency
    const validExpandedPaths: string[] = [];
    for (const expandedPath of await getExpandedFolderPathsForVault(watchedDir)) {
        const absolutePath: string = normalizePath(
            path.isAbsolute(expandedPath)
                ? expandedPath
                : path.join(watchedDir, expandedPath)
        );
        // Skip if same as writeFolderPath (deduplicate)
        if (absolutePath === absoluteWriteFolderPath) continue;
        try {
            await fs.access(absolutePath);
            validExpandedPaths.push(absolutePath);
        } catch {
            // Path no longer exists on disk, skip
        }
    }

    return {
        allowlist: [absoluteWriteFolderPath, ...validExpandedPaths],
        writeFolderPath: absoluteWriteFolderPath,
    };
}
