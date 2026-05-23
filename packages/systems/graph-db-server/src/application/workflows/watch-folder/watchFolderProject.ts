import type { FilePath } from '@vt/graph-model/graph';
import * as O from "fp-ts/lib/Option.js";
import { getLastDirectory } from "@vt/app-config/vault-config";
import {
    getProjectRootWatchedDirectory,
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
import type { FolderAction } from "./projectState";

export type ProjectStatus =
    | {
        readonly open: true;
        readonly root: FilePath;
        readonly writePath: FilePath | null;
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

    if (getProjectRootWatchedDirectory() !== null) {
        return { success: true, directory: getProjectRootWatchedDirectory() ?? undefined };
    }

    const lastDirectory: O.Option<string> = await getLastDirectory();
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
    const watchedDir: FilePath | null = getProjectRootWatchedDirectory();
    if (!watchedDir) {
        return { success: false, error: 'No directory is being watched' };
    }

    const { addReadPath, removeReadPath, getWritePath } = await import("@vt/graph-db-server/state/vaultAllowlist");
    const writePathOpt = await getWritePath();
    const currentWritePath: string | null = O.isSome(writePathOpt) ? writePathOpt.value : null;

    if (folderPath === currentWritePath) {
        if (action === 'unloaded') {
            return { success: false, error: 'cannot-unload-writepath' };
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
 * Set the writePath, atomically loading the new path if it was unloaded and
 * demoting the previous writePath to `collapsed`. Per design D5.
 */
export async function setWritePath(
    newWritePath: FilePath,
): Promise<{ readonly success: boolean; readonly error?: string }> {
    const watchedDir: FilePath | null = getProjectRootWatchedDirectory();
    if (!watchedDir) {
        return { success: false, error: 'No directory is being watched' };
    }

    const { setWritePath: setWritePathLegacy, getWritePath } = await import("@vt/graph-db-server/state/vaultAllowlist");
    const previousOpt = await getWritePath();
    const previous: string | null = O.isSome(previousOpt) ? previousOpt.value : null;

    const result = await setWritePathLegacy(newWritePath);
    if (!result.success) {
        return result;
    }

    if (previous !== null && previous !== newWritePath) {
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
    const root: FilePath | null = getProjectRootWatchedDirectory();
    if (!root) return { open: false };
    return {
        open: true,
        root,
        writePath: null,
        directory: root,
    };
}
