/**
 * Broadcast current project state to renderer.
 * Called after any project path or starred folder mutation.
 */

import { getProjectPaths, getWriteFolderPath } from '@vt/graph-db-server/state/projectAllowlist';
import { getStarredFolders } from '../starred-folders';
import { broadcastFolderTreeImmediate } from './broadcast-folder-tree';
import * as O from 'fp-ts/lib/Option.js';
import type { FilePath } from '@vt/graph-model/graph';
import {getCallbacks} from '@vt/graph-model';

export async function broadcastProjectState(): Promise<void> {
    const projectPaths: readonly FilePath[] = await getProjectPaths();
    const writeFolderPathOption: O.Option<FilePath> = await getWriteFolderPath();
    const writeFolderPath: string | null = O.isSome(writeFolderPathOption) ? writeFolderPathOption.value : null;
    const starredFolders: readonly string[] = await getStarredFolders();

    getCallbacks().syncProjectState?.({ projectPaths, writeFolderPath, starredFolders });

    // Also refresh the folder tree sidebar (project path changes affect load indicators)
    await broadcastFolderTreeImmediate();
}
