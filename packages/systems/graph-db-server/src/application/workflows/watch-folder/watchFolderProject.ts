import type { FilePath } from '@vt/graph-model/graph';
import * as O from "fp-ts/lib/Option.js";
import { getLastDirectory } from "@vt/app-config/vault-config";
import {resolveAppSupportPath} from '@vt/app-config/app-support-path'
import {
    getProjectRoot,
} from "@vt/graph-db-server/state/watch-folder-store";
import { setActiveViewFolderState } from "@vt/graph-db-server/watch-folder/folder-visibility-active-view";
import { broadcastVaultState } from "@vt/graph-db-server/watch-folder/broadcast/broadcast-vault-state";
import {
    defaultWatchFolderEnv,
    type WatchFolderEnv,
} from "./watchFolderEnv";
import {
    loadFolder,
    stopFileWatching,
    validateDirectoryForWatching,
    type WatchFolderLoadOptions,
} from "./watchFolderLoad";
import type { FolderAction } from "../state/projectState";

export type ProjectStatus =
    | {
        readonly open: true;
        readonly root: FilePath;
        readonly writeFolder: FilePath | null;
        readonly directory: string;
    }
    | { readonly open: false };

/**
 * Open the project rooted at `path`. When `path` is undefined, resolves to
 * the last directory the daemon was bound to (per
 * `vault-config.getLastDirectory`). Returns `{ success: false }` when no
 * directory is available.
 */
export async function openProject(
    path?: FilePath,
    options: WatchFolderLoadOptions = {},
): Promise<{ readonly success: boolean; readonly directory?: string; readonly error?: string }> {
    if (path !== undefined) {
        const env: WatchFolderEnv = defaultWatchFolderEnv;
        const error: string | null = validateDirectoryForWatching(env, path);
        if (error !== null) {
            return { success: false, error };
        }
        const outcome = await loadFolder(path, options);
        return outcome.success
            ? { success: true, directory: path }
            : { success: false, error: 'Failed to load folder' };
    }

    if (getProjectRoot() !== null) {
        return { success: true, directory: getProjectRoot() ?? undefined };
    }

    const lastDirectory: O.Option<string> = await getLastDirectory(resolveAppSupportPath());
    if (O.isSome(lastDirectory)) {
        const outcome = await loadFolder(lastDirectory.value, options);
        return outcome.success
            ? { success: true, directory: lastDirectory.value }
            : { success: false, error: 'Failed to load last directory' };
    }
    return { success: false, error: 'No previous folder found' };
}

/**
 * Close the project: stop the watcher and clear the project state. After
 * this call `getProjectStatus().open` is `false`.
 */
export async function closeProject(): Promise<{ readonly success: boolean; readonly error?: string }> {
    return stopFileWatching();
}

/**
 * Set a folder's ternary state relative to the project. See design D6 for
 * the full semantics matrix.
 */
export async function setFolderState(
    folderPath: FilePath,
    action: FolderAction,
): Promise<{ readonly success: boolean; readonly error?: string }> {
    const watchedDir: FilePath | null = getProjectRoot();
    if (!watchedDir) {
        return { success: false, error: 'No directory is being watched' };
    }

    const { addReadPath, removeReadPath, getWriteFolder } = await import("@vt/graph-db-server/state/vaultAllowlist");
    const writeFolderOpt = await getWriteFolder();
    const currentWriteFolder: string | null = O.isSome(writeFolderOpt) ? writeFolderOpt.value : null;

    if (folderPath === currentWriteFolder) {
        if (action === 'unloaded') {
            return { success: false, error: 'cannot-unload-writefolder' };
        }
        return { success: true };
    }

    if (action === 'unloaded') {
        return removeReadPath(folderPath);
    }

    const addResult: { success: boolean; error?: string } = await addReadPath(folderPath);
    if (!addResult.success && addResult.error !== 'Path already expanded') {
        return addResult;
    }

    if (action === 'collapsed') {
        await setActiveViewFolderState(watchedDir, folderPath, 'collapsed');
        await broadcastVaultState();
    }

    return { success: true };
}

/**
 * Set the writeFolder, atomically loading the new path if it was unloaded and
 * demoting the previous writeFolder to `collapsed`. Per design D5.
 */
export async function setWriteFolder(
    newWriteFolder: FilePath,
): Promise<{ readonly success: boolean; readonly error?: string }> {
    const watchedDir: FilePath | null = getProjectRoot();
    if (!watchedDir) {
        return { success: false, error: 'No directory is being watched' };
    }

    const { setWriteFolder: setWriteFolderLegacy, getWriteFolder } = await import("@vt/graph-db-server/state/vaultAllowlist");
    const previousOpt = await getWriteFolder();
    const previous: string | null = O.isSome(previousOpt) ? previousOpt.value : null;

    const result = await setWriteFolderLegacy(newWriteFolder);
    if (!result.success) {
        return result;
    }

    if (previous !== null && previous !== newWriteFolder) {
        await setActiveViewFolderState(watchedDir, previous, 'collapsed');
        await broadcastVaultState();
    }

    return { success: true };
}

/**
 * Return the current project's open/closed status. Consumers must check
 * `open` before reading project fields.
 */
export function getProjectStatus(): ProjectStatus {
    const root: FilePath | null = getProjectRoot();
    if (!root) return { open: false };
    return {
        open: true,
        root,
        writeFolder: null,
        directory: root,
    };
}
