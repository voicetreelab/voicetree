/**
 * Broadcast current vault state to renderer.
 * Called after any vault path or starred folder mutation.
 */

import { getVaultPaths, getWriteFolderPath } from '@vt/graph-db-server/state/vaultAllowlist';
import { getStarredFolders } from '../starred-folders';
import { broadcastFolderTreeImmediate } from './broadcast-folder-tree';
import * as O from 'fp-ts/lib/Option.js';
import type { FilePath } from '@vt/graph-model/graph';
import {getCallbacks} from '@vt/graph-model';

export async function broadcastVaultState(): Promise<void> {
    const vaultPaths: readonly FilePath[] = await getVaultPaths();
    const writeFolderPathOption: O.Option<FilePath> = await getWriteFolderPath();
    const writeFolderPath: string | null = O.isSome(writeFolderPathOption) ? writeFolderPathOption.value : null;
    const starredFolders: readonly string[] = await getStarredFolders();

    getCallbacks().syncVaultState?.({ vaultPaths, writeFolderPath, starredFolders });

    // Also refresh the folder tree sidebar (vault path changes affect load indicators)
    await broadcastFolderTreeImmediate();
}
