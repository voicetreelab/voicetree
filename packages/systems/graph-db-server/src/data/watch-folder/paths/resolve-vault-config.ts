/**
 * Vault config resolution utilities.
 *
 * - resolveWriteFolder: Normalize a write path to an absolute, forward-slash path.
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
import { getAppSupportPath } from "@vt/graph-db-server/state/app-support-store";

/**
 * Resolve a writeFolder to an absolute path with normalized separators.
 * If writeFolder is relative, it's resolved against watchedFolder.
 * If writeFolder is absolute, it's returned unchanged.
 * Always normalizes to forward slashes for cross-platform consistency.
 */
export function resolveWriteFolder(watchedFolder: string, writeFolder: string): string {
    const resolved: string = path.isAbsolute(writeFolder)
        ? writeFolder
        : path.join(watchedFolder, writeFolder);
    return normalizePath(resolved);
}

/**
 * Resolved vault configuration for loading.
 */
export interface ResolvedVaultConfig {
    /** Combined watch roots: writeFolder plus active-view expanded folder paths. */
    readonly allowlist: readonly string[];
    /** Main vault path for writing new nodes */
    readonly writeFolder: string;
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
    if (await hasLegacyReadPathsForDirectory(getAppSupportPath(), watchedDir)) {
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
    const savedVaultConfig: VaultConfig | undefined = await getVaultConfigForDirectory(getAppSupportPath(), watchedDir);
    await logIgnoredLegacyReadPathsIfPresent(watchedDir);

    // If no saved config exists, return null so caller can attempt loading directly
    if (!savedVaultConfig?.writeFolder) {
        return null;
    }

    // Resolve writeFolder to absolute
    const absoluteWriteFolder: string = resolveWriteFolder(watchedDir, savedVaultConfig.writeFolder);

    // Check if writeFolder still exists on disk
    try {
        await fs.access(absoluteWriteFolder);
    } catch {
        // Write path no longer exists, return null to retry fresh
        return null;
    }

    if (options.includeActiveViewExpandedPaths === false) {
        return {
            allowlist: [absoluteWriteFolder],
            writeFolder: absoluteWriteFolder,
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
        // Skip if same as writeFolder (deduplicate)
        if (absolutePath === absoluteWriteFolder) continue;
        try {
            await fs.access(absolutePath);
            validExpandedPaths.push(absolutePath);
        } catch {
            // Path no longer exists on disk, skip
        }
    }

    return {
        allowlist: [absoluteWriteFolder, ...validExpandedPaths],
        writeFolder: absoluteWriteFolder,
    };
}
