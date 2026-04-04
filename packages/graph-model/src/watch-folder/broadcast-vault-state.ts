/**
 * Broadcast current vault state (readPaths, writePath, starredFolders) to renderer.
 * Called after any vault path or starred folder mutation.
 */

import { getVaultPaths, getWritePath } from './vault-allowlist';
import { getStarredFolders } from './starred-folders';
import { broadcastFolderTreeImmediate } from './broadcast-folder-tree';
import * as O from 'fp-ts/lib/Option.js';
import type { FilePath } from '@/pure/graph';
import {getCallbacks} from '../types';

export async function broadcastVaultState(): Promise<void> {
    const readPaths: readonly FilePath[] = await getVaultPaths();
    const writePathOption: O.Option<FilePath> = await getWritePath();
    const writePath: string | null = O.isSome(writePathOption) ? writePathOption.value : null;
    const starredFolders: readonly string[] = await getStarredFolders();

    getCallbacks().syncVaultState?.({ readPaths, writePath, starredFolders });

    // Also refresh the folder tree sidebar (vault path changes affect load indicators)
    broadcastFolderTreeImmediate();
}
