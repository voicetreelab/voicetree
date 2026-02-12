/**
 * Starred folders CRUD operations.
 * Starred folders persist globally in VTSettings (not per-project)
 * so they appear as recommendations across all projects.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { loadSettings, saveSettings } from '@/shell/edge/main/settings/settings_IO';
import { getNode } from '@/shell/edge/main/state/graph-store';
import { nodeIdToFilePathWithExtension } from '@/pure/graph/markdown-parsing';
import { broadcastVaultState } from './broadcast-vault-state';
import type { VTSettings } from '@/pure/settings/types';
import type { GraphNode } from '@/pure/graph';

export async function getStarredFolders(): Promise<readonly string[]> {
    const settings: VTSettings = await loadSettings();
    return settings.starredFolders ?? [];
}

export async function addStarredFolder(folderPath: string): Promise<void> {
    const settings: VTSettings = await loadSettings();
    const current: readonly string[] = settings.starredFolders ?? [];
    // Idempotent — no-op if already starred
    if (current.includes(folderPath)) return;
    await saveSettings({ ...settings, starredFolders: [...current, folderPath] });
    void broadcastVaultState();
}

export async function removeStarredFolder(folderPath: string): Promise<void> {
    const settings: VTSettings = await loadSettings();
    const current: readonly string[] = settings.starredFolders ?? [];
    await saveSettings({ ...settings, starredFolders: current.filter((p: string) => p !== folderPath) });
    void broadcastVaultState();
}

export async function isStarred(folderPath: string): Promise<boolean> {
    const settings: VTSettings = await loadSettings();
    return (settings.starredFolders ?? []).includes(folderPath);
}

/**
 * Copy a node's .md file to a target folder.
 * The target folder's file watcher (if loaded) will pick up the new file automatically.
 */
export async function copyNodeToFolder(
    nodeId: string,
    targetFolderPath: string
): Promise<{ success: boolean; targetPath: string; error?: string }> {
    const node: GraphNode | undefined = getNode(nodeId);
    if (!node) {
        return { success: false, targetPath: '', error: `Node not found: ${nodeId}` };
    }

    const sourceFilePath: string = nodeIdToFilePathWithExtension(nodeId);
    const fileName: string = path.basename(sourceFilePath);
    const targetPath: string = path.join(targetFolderPath, fileName);

    try {
        // Verify target folder exists
        await fs.access(targetFolderPath);
        // Copy the file
        await fs.copyFile(sourceFilePath, targetPath);
        return { success: true, targetPath };
    } catch (error) {
        const message: string = error instanceof Error ? error.message : String(error);
        return { success: false, targetPath, error: message };
    }
}
