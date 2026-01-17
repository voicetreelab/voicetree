/**
 * File watcher setup and event handling.
 *
 * Handles:
 * - Creating and configuring the chokidar file watcher
 * - Setting up event listeners for file add/change/delete
 * - Retry logic for transient file system issues
 */

import path from "path";
import { promises as fs } from "fs";
import type { Stats } from "fs";
import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";
import type { FilePath, FSUpdate, FSDelete } from "@/pure/graph";
import { handleFSEventWithStateAndUISides } from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/handleFSEventWithStateAndUISides";
import { getMainWindow } from "@/shell/edge/main/state/app-electron-state";
import { getWatcher, setWatcher } from "@/shell/edge/main/state/watch-folder-store";

/**
 * Read file with retry logic for transient file system issues
 * Retries with exponential backoff if file read fails
 * @param filePath - Absolute path to file
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param delay - Initial delay in ms between retries (default: 100)
 * @returns Promise that resolves to file content
 */
export async function readFileWithRetry(filePath: string, maxRetries = 3, delay = 100): Promise<string> {
    const attemptRead: (attempt: number) => Promise<string> = (attempt: number): Promise<string> => {
        return fs.readFile(filePath, 'utf8')
            .catch((error: unknown) => {
                if (attempt === maxRetries) {
                    return Promise.reject(error);
                }
                // Wait before retry with exponential backoff
                return new Promise<string>(resolve => {
                    setTimeout(() => {
                        resolve(attemptRead(attempt + 1));
                    }, delay * attempt);
                });
            });
    };

    return attemptRead(1);
}

export async function setupWatcher(vaultPaths: readonly FilePath[], watchedDir: FilePath): Promise<void> {
    // Note: watcher is already closed in loadFolder before this is called

    // vaultPaths contains all paths in the allowlist (e.g., primary vault + openspec)
    // watchedDir is {loaded_dir} (base for node IDs)

    // Create new watcher - chokidar supports array of paths natively
    const newWatcher: FSWatcher = chokidar.watch([...vaultPaths], {
        ignored: [
            // Only watch .md files (directories must pass through for traversal)
            (filePath: string, stats?: Stats) => {
                // If stats available, use it to detect directories
                if (stats?.isDirectory()) {
                    return false;
                }
                // If stats unavailable and no extension, assume it's a directory
                if (!stats && !path.extname(filePath)) {
                    return false;
                }
                return !filePath.endsWith('.md');
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
        usePolling: false
    });
    setWatcher(newWatcher);

    // Setup event handlers for file changes
    setupWatcherListeners(watchedDir);
}

export function setupWatcherListeners(watchedDir: FilePath): void {
    const currentWatcher: FSWatcher | null = getWatcher();
    if (!currentWatcher) return;

    const mainWindow: Electron.CrossProcessExports.BrowserWindow | null = getMainWindow();
    if (!mainWindow) return;

    // File added
    currentWatcher.on('add', (filePath: string) => {
        void readFileWithRetry(filePath)
            .then(content => {
                const fsUpdate: FSUpdate = {
                    absolutePath: filePath,
                    content: content,
                    eventType: 'Added'
                };

                // Handle FS event: compute delta, update state, broadcast to UI-edge
                // Pass watchedDir so node IDs are relative to watched directory
                handleFSEventWithStateAndUISides(fsUpdate, watchedDir, mainWindow);
            })
            .catch(error => {
                console.error(`Error handling file add ${filePath}:`, error);
            });
    });

    // File changed
    currentWatcher.on('change', (filePath: string) => {
        void readFileWithRetry(filePath)
            .then(content => {
                const fsUpdate: FSUpdate = {
                    absolutePath: filePath,
                    content: content,
                    eventType: 'Changed'
                };

                // Handle FS event: compute delta, update state, broadcast to UI-edge
                handleFSEventWithStateAndUISides(fsUpdate, watchedDir, mainWindow);
            })
            .catch(error => {
                console.error(`Error handling file change ${filePath}:`, error);
            });
    });

    // File deleted
    currentWatcher.on('unlink', (filePath: string) => {
        const fsDelete: FSDelete = {
            type: 'Delete',
            absolutePath: filePath
        };

        // Handle FS event: compute delta, update state, broadcast to UI-edge
        handleFSEventWithStateAndUISides(fsDelete, watchedDir, mainWindow);
    });

    // Watch error
    currentWatcher.on('error', (error: unknown) => {
        console.error('File watcher error:', error);
    });
}
