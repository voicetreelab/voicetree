/**
 * Vault config resolution utilities.
 *
 * - resolveWritePath: Normalize a write path to an absolute, forward-slash path.
 * - resolveAllowlistForProject: Resolve the full vault path configuration for a project,
 *   filtering out stale paths that no longer exist on disk.
 */

import path from "path";
import { promises as fs } from "fs";
import normalizePath from "normalize-path";
import type { VaultConfig } from "@/pure/settings/types";
import { getVaultConfigForDirectory } from "./voicetree-config-io";

/**
 * Resolve a writePath to an absolute path with normalized separators.
 * If writePath is relative, it's resolved against watchedFolder.
 * If writePath is absolute, it's returned unchanged.
 * Always normalizes to forward slashes for cross-platform consistency.
 */
export function resolveWritePath(watchedFolder: string, writePath: string): string {
    const resolved: string = path.isAbsolute(writePath)
        ? writePath
        : path.join(watchedFolder, writePath);
    return normalizePath(resolved);
}

/**
 * Resolved vault configuration for loading.
 */
export interface ResolvedVaultConfig {
    /** Combined allowlist (writePath + readPaths) for backwards compatibility */
    readonly allowlist: readonly string[];
    /** Main vault path for writing new nodes */
    readonly writePath: string;
    /** readPaths (excluding writePath) */
    readonly readPaths: readonly string[];
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
    watchedDir: string
): Promise<ResolvedVaultConfig | null> {
    const savedVaultConfig: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);

    // If no saved config exists, return null so caller can attempt loading directly
    if (!savedVaultConfig?.writePath) {
        return null;
    }

    // Resolve writePath to absolute
    const absoluteWritePath: string = resolveWritePath(watchedDir, savedVaultConfig.writePath);

    // Check if writePath still exists on disk
    try {
        await fs.access(absoluteWritePath);
    } catch {
        // Write path no longer exists, return null to retry fresh
        return null;
    }

    // Filter readPaths to those that still exist on disk
    // Normalize all paths to forward slashes for cross-platform consistency
    const validReadPaths: string[] = [];
    for (const savedPath of savedVaultConfig.readPaths) {
        const absolutePath: string = normalizePath(
            path.isAbsolute(savedPath)
                ? savedPath
                : path.join(watchedDir, savedPath)
        );
        // Skip if same as writePath (deduplicate)
        if (absolutePath === absoluteWritePath) continue;
        try {
            await fs.access(absolutePath);
            validReadPaths.push(absolutePath);
        } catch {
            // Path no longer exists on disk, skip
        }
    }

    return {
        allowlist: [absoluteWritePath, ...validReadPaths],
        writePath: absoluteWritePath,
        readPaths: validReadPaths
    };
}
