/**
 * File watcher setup and event handling.
 *
 * Handles:
 * - Creating and configuring the chokidar file watcher
 * - Setting up event listeners for file add/change/delete
 * - Retry logic for transient file system issues
 */

import { promises as fs } from "fs";
import type { Stats } from "fs";
import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";
import type { FilePath, FSUpdate, FSDelete } from '@vt/graph-model/graph';
import { isImageNode } from '@vt/graph-model/graph';
import { handleFSEventWithStateAndUISides } from "@vt/graph-db-server/graph/handleFSEvent";
import { getWatcher, setWatcher } from "@vt/graph-db-server/state/watch-folder-store";
import { broadcastFolderTree } from "../broadcast/broadcast-folder-tree";
import { clearPendingWrite, consumeBroadcastSuppression, isPendingWrite } from "../pending-writes";

export interface FileWatcherLogger {
    error(message?: unknown, ...optionalParams: unknown[]): void
}

export interface ReadFileWithRetryDependencies {
    readonly readTextFile: (filePath: string) => Promise<string>
    readonly wait: (delayMs: number) => Promise<void>
}

const defaultReadFileWithRetryDependencies: ReadFileWithRetryDependencies = {
    readTextFile: (filePath: string): Promise<string> => fs.readFile(filePath, 'utf8'),
    wait: (delayMs: number): Promise<void> => new Promise(resolve => {
        setTimeout(resolve, delayMs);
    }),
}

export interface WatcherListenerDependencies {
    readonly readFileWithRetry: typeof readFileWithRetry
    readonly handleFSEvent: typeof handleFSEventWithStateAndUISides
    readonly broadcastFolderTree: typeof broadcastFolderTree
    readonly logger: FileWatcherLogger
}

const defaultWatcherListenerDependencies: WatcherListenerDependencies = {
    readFileWithRetry,
    handleFSEvent: handleFSEventWithStateAndUISides,
    broadcastFolderTree,
    logger: {
        error(message?: unknown, ...optionalParams: unknown[]): void {
            console.error(message, ...optionalParams);
        },
    },
}

/**
 * Read file with retry logic for transient file system issues
 * Retries with exponential backoff if file read fails
 * @param filePath - Absolute path to file
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param delay - Initial delay in ms between retries (default: 100)
 * @returns Promise that resolves to file content
 */
export async function readFileWithRetry(
    filePath: string,
    maxRetries = 3,
    delay = 100,
    dependencies: ReadFileWithRetryDependencies = defaultReadFileWithRetryDependencies,
): Promise<string> {
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        try {
            return await dependencies.readTextFile(filePath);
        } catch (error) {
            if (attempt === maxRetries) {
                throw error;
            }
            await dependencies.wait(delay * attempt);
        }
    }
    return dependencies.readTextFile(filePath);
}

export interface WatcherOptions {
    /** Use polling instead of native fs events (needed for Electron test harness). */
    readonly usePolling?: boolean
}

export async function setupWatcher(
    vaultPaths: readonly FilePath[],
    watchedDir: FilePath,
    options?: WatcherOptions,
    dependencies: WatcherListenerDependencies = defaultWatcherListenerDependencies,
): Promise<void> {
    // Note: watcher is already closed in loadFolder before this is called

    // vaultPaths contains all paths in the allowlist (e.g., primary vault + openspec)
    // watchedDir is {loaded_dir} (base for node IDs)
    const usePolling: boolean = options?.usePolling ?? false;

    // Create new watcher - chokidar supports array of paths natively
    const newWatcher: FSWatcher = chokidar.watch([...vaultPaths], {
        // Only watch .md and image files (directories must pass through for traversal).
        // KEEP IN SYNC WITH packages/systems/graph-db-server/src/data/graph/watching/daemonWatcher.ts.
        //
        // When chokidar invokes this predicate WITHOUT stats (notably from
        // FsEventsHandler._watchWithFsEvents — the gate that decides whether
        // to set up the macOS fsevents listener), it must NOT use
        // `path.extname()` as a "this is a file" heuristic: extname returns
        // a non-empty string for any directory whose basename contains a
        // dot (`My Vault.notes`, `mktemp -d /tmp/vault.XXXX`, …). Treating
        // such a directory as a file and ignoring it causes chokidar to
        // skip the fsevents subscription — which leaves _readyCount
        // half-decremented, so the watcher's `ready` promise never resolves.
        // The safe default when stats are unavailable is "don't ignore";
        // chokidar reinvokes the predicate during the readdirp scan with
        // stats populated, where the real file/dir filtering happens.
        ignored: [
            (filePath: string, stats?: Stats) => {
                if (!stats) {
                    return false;
                }
                if (stats.isDirectory()) {
                    return false;
                }
                return !filePath.endsWith('.md') && !isImageNode(filePath);
            },
        ],
        persistent: true,
        ignoreInitial: true, // Skip initial scan (we already loaded the graph)
        followSymlinks: false,
        depth: 99,
        awaitWriteFinish: {
            stabilityThreshold: 100,
            pollInterval: 50
        },
        // Caller may request polling when native fs events are unreliable
        // (e.g. Electron test harness).
        usePolling,
        interval: usePolling ? 100 : undefined,
        binaryInterval: usePolling ? 300 : undefined
    });
    setWatcher(newWatcher);

    // Setup event handlers for file changes
    setupWatcherListeners(watchedDir, dependencies);
}

export function setupWatcherListeners(
    watchedDir: FilePath,
    dependencies: WatcherListenerDependencies = defaultWatcherListenerDependencies,
): void {
    const currentWatcher: FSWatcher | null = getWatcher();
    if (!currentWatcher) return;

    // File added
    currentWatcher.on('add', (filePath: string) => {
        if (isPendingWrite(filePath)) {
            clearPendingWrite(filePath);
            return;
        }

        // Image files have empty content (don't read binary as UTF-8)
        const contentPromise: Promise<string> = isImageNode(filePath)
            ? Promise.resolve('')
            : dependencies.readFileWithRetry(filePath);

        void contentPromise
            .then(content => {
                const fsUpdate: FSUpdate = {
                    absolutePath: filePath,
                    content: content,
                    eventType: 'Added'
                };

                // Handle FS event: compute delta, update state, broadcast to UI-edge
                // Pass watchedDir so node IDs are relative to watched directory
                dependencies.handleFSEvent(fsUpdate, watchedDir);

                // Refresh folder tree sidebar (new file added)
                dependencies.broadcastFolderTree();
            })
            .catch(error => {
                dependencies.logger.error(`Error handling file add ${filePath}:`, error);
            });
    });

    // File changed
    currentWatcher.on('change', (filePath: string) => {
        const suppressBroadcastTo: ReadonlySet<string> = consumeBroadcastSuppression(filePath);

        // Skip image file changes - their content is always empty in the graph
        if (isImageNode(filePath)) {
            return;
        }

        void dependencies.readFileWithRetry(filePath)
            .then(content => {
                const fsUpdate: FSUpdate = {
                    absolutePath: filePath,
                    content: content,
                    eventType: 'Changed'
                };

                // Handle FS event: compute delta, update state, broadcast to UI-edge
                dependencies.handleFSEvent(fsUpdate, watchedDir, suppressBroadcastTo);
            })
            .catch(error => {
                dependencies.logger.error(`Error handling file change ${filePath}:`, error);
            });
    });

    // File deleted
    currentWatcher.on('unlink', (filePath: string) => {
        if (isPendingWrite(filePath)) {
            clearPendingWrite(filePath);
            return;
        }

        const fsDelete: FSDelete = {
            type: 'Delete',
            absolutePath: filePath
        };

        // Handle FS event: compute delta, update state, broadcast to UI-edge
        dependencies.handleFSEvent(fsDelete, watchedDir);

        // Refresh folder tree sidebar (file removed)
        dependencies.broadcastFolderTree();
    });

    // Watch error
    currentWatcher.on('error', (error: unknown) => {
        dependencies.logger.error('File watcher error:', error);
    });
}
