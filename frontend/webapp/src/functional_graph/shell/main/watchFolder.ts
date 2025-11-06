import {loadGraphFromDisk} from "@/functional_graph/shell/main/loadGraphFromDisk.ts";
import type {FilePath, Graph, GraphDelta} from "@/functional_graph/pure/types.ts";
import {setGraph, setVaultPath} from "@/functional_graph/shell/state/graph-store.ts";
import {app} from "electron";
import path from "path";
import * as O from "fp-ts/Option";
import {promises as fs} from "fs";
import chokidar, {type FSWatcher} from "chokidar";
import type {FSUpdate} from "@/functional_graph/pure/types.ts";
import {handleFSEventWithStateAndUISides} from "@/functional_graph/shell/main/handleFSEventWithStateAndUISides.ts";
import {mapNewGraphToDelta} from "@/functional_graph/pure/graphDelta/mapNewGraphtoDelta.ts";
import {applyGraphDeltaToStateAndUI} from "@/functional_graph/shell/main/applyGraphDeltaToStateAndUI.ts";
import {getMainWindow} from "@/functional_graph/shell/state/app-electron-state.ts";
import {notifyTextToTreeServerOfDirectory} from "@/functional_graph/shell/main/notifyTextToTreeServerOfDirectory.ts";

// THIS FUNCTION takes absolutePath
// returns graph
// has side effects of sending to UI
// setting up file watchers
// closing old watchers

// eslint-disable-next-line functional/no-let
let watcher: FSWatcher | null = null;

// eslint-disable-next-line functional/no-let
let watchedDirectory: FilePath | null = null;

export async function initialLoad(): Promise<void>  {
    const lastDirectory = await loadLastDirectory();
    if (O.isSome(lastDirectory)) {
        await loadFolder(lastDirectory.value)
    }
}

function getConfigPath(): string {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'voicetree-config.json');
}

// Load last watched directory from config
async function loadLastDirectory(): Promise<O.Option<FilePath>> {
    const configPath = getConfigPath();
    return fs.readFile(configPath, 'utf8')
        .then(data => {
            const config = JSON.parse(data);
            return O.fromNullable(config.lastDirectory);
        })
        .catch((error) => {
            console.error("loadLastDirectory", error);
            // Config file doesn't exist yet (first run) - return None
            return O.none;
        });
}

// Save last watched directory to config
async function saveLastDirectory(directoryPath: string): Promise<void> {
    const configPath = getConfigPath();
    const config = { lastDirectory: directoryPath };
    return fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8')
        .catch((error) => {
            console.error('Failed to save last directory:', error);
        });
}

export async function loadFolder(vaultPath: FilePath): Promise<void>  {
    // Load graph from disk (IO operation)
    const currentGraph: Graph = await loadGraphFromDisk(O.some(vaultPath));

    // Update graph store
    setVaultPath(vaultPath);
    setGraph(currentGraph);

    // Broadcast initial graph to UI (different event from incremental updates)
    const graphDelta : GraphDelta = mapNewGraphToDelta(currentGraph)

    const mainWindow = getMainWindow();
    if (!mainWindow) {
        console.error('No main window available to broadcast graph delta');
        return;
    }

    applyGraphDeltaToStateAndUI(graphDelta, mainWindow)

    // Setup file watcher
    await setupWatcher(vaultPath);

    // Save as last directory for auto-start on next launch
    await saveLastDirectory(vaultPath);

    notifyTextToTreeServerOfDirectory(vaultPath);
}

/**
 * Read file with retry logic for transient file system issues
 * Retries with exponential backoff if file read fails
 * @param filePath - Absolute path to file
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param delay - Initial delay in ms between retries (default: 100)
 * @returns Promise that resolves to file content
 */
async function readFileWithRetry(filePath: string, maxRetries = 3, delay = 100): Promise<string> {
    const attemptRead = (attempt: number): Promise<string> => {
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

async function setupWatcher(vaultPath: FilePath): Promise<void> {
    // Close old watcher if it exists
    if (watcher) {
        await watcher.close();
        watcher = null;
    }

    // Set the watched directory
    watchedDirectory = vaultPath;

    // Create new watcher
    watcher = chokidar.watch(vaultPath, {
        ignored: [
            // Only watch .md files
            (filePath: string) => !filePath.endsWith('.md'),
            // and ignore common hidden
            '**/node_modules/**',
            '**/.git/**',
            '**/.*', // Hidden files
            '**/*.tmp',
            '**/*.temp'
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

    // Setup event handlers for file changes
    setupWatcherListeners(vaultPath);
}

function setupWatcherListeners(vaultPath: FilePath): void {
    if (!watcher) return;

    const mainWindow = getMainWindow();
    if (!mainWindow) return;

    // File added
    watcher.on('add', async (filePath: string) => {
        readFileWithRetry(filePath)
            .then(content => {
                const fsUpdate: FSUpdate = {
                    absolutePath: filePath,
                    content: content,
                    eventType: 'Added'
                };

                // Handle FS event: compute delta, update state, broadcast to UI
                handleFSEventWithStateAndUISides(fsUpdate, vaultPath, mainWindow);
            })
            .catch(error => {
                console.error(`Error handling file add ${filePath}:`, error);
            });
    });

    // File changed
    watcher.on('change', async (filePath: string) => {
        readFileWithRetry(filePath)
            .then(content => {
                const fsUpdate: FSUpdate = {
                    absolutePath: filePath,
                    content: content,
                    eventType: 'Changed'
                };

                // Handle FS event: compute delta, update state, broadcast to UI
                handleFSEventWithStateAndUISides(fsUpdate, vaultPath, mainWindow);
            })
            .catch(error => {
                console.error(`Error handling file change ${filePath}:`, error);
            });
    });

    // File deleted
    watcher.on('unlink', (filePath: string) => {
        const fsUpdate: FSUpdate = {
            absolutePath: filePath,
            content: '',
            eventType: 'Deleted'
        };

        // Handle FS event: compute delta, update state, broadcast to UI
        handleFSEventWithStateAndUISides(fsUpdate, vaultPath, mainWindow);
    });

    // Watch error
    watcher.on('error', (error: unknown) => {
        console.error('File watcher error:', error);
    });
}

export async function stopWatching(): Promise<void> {
    if (watcher) {
        await watcher.close();
        watcher = null;
        watchedDirectory = null;
    }
}

export function isWatching(): boolean {
    return watcher !== null;
}

export function getWatchedDirectory(): FilePath | null {
    return watchedDirectory;
}
